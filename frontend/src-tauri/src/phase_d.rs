use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    sync::{oneshot, Mutex},
};

type HmacSha256 = Hmac<Sha256>;
pub const BRIDGE_PORT: u16 = 18765;
pub const CUA_PIPE: &str = r"\\.\pipe\hermes-phase-d-cua";
const PHASE_D_KDF_CONTEXT: &[u8] = b"hermes-desktop/phase-d-bridge/v1";
const MAX_HANDSHAKE: usize = 4096;
const CLOCK_SKEW_MS: i64 = 30_000;
const MANIFEST: &str = r#"version: 3
expires_after: 24h
idle_timeout: 30m
allow:
  tools:
    - start_session
    - end_session
    - list_sessions
    - get_session
    - health_report
    - check_permissions
    - list_apps
    - list_windows
    - get_window_state
    - get_accessibility_tree
    - get_desktop_state
    - get_screen_size
    - get_cursor_position
    - click
    - double_click
    - right_click
    - scroll
    - drag
    - type_text
    - press_key
    - hotkey
    - set_value
    - verify_state
    - move_cursor
    - get_agent_cursor_state
    - set_agent_cursor_enabled
resources:
  apps: []
  desktop:
    display: true
"#;

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PhaseDState {
    #[default]
    Disabled,
    StartingCua,
    StartingProxy,
    ConnectingTunnel,
    Ready,
    Degraded,
    Stopping,
    Error,
}
#[derive(Clone, Debug, Serialize)]
pub struct PhaseDStatus {
    pub enabled: bool,
    pub state: PhaseDState,
    pub cua_version: Option<String>,
    pub session_id: Option<u32>,
    pub daemon_reachable: bool,
    pub tunnel_alive: bool,
    pub adapter_connected: bool,
    pub last_heartbeat_ms: Option<u64>,
    pub last_error: Option<String>,
    pub manifest_digest: String,
    pub audit_bytes: u64,
}
impl Default for PhaseDStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            state: PhaseDState::Disabled,
            cua_version: None,
            session_id: None,
            daemon_reachable: false,
            tunnel_alive: false,
            adapter_connected: false,
            last_heartbeat_ms: None,
            last_error: None,
            manifest_digest: hex::encode(Sha256::digest(MANIFEST.as_bytes())),
            audit_bytes: 0,
        }
    }
}
pub struct PhaseDManager {
    pub status: PhaseDStatus,
    cancel: Option<oneshot::Sender<()>>,
    cua: Option<Child>,
}
impl Default for PhaseDManager {
    fn default() -> Self {
        Self {
            status: PhaseDStatus::default(),
            cancel: None,
            cua: None,
        }
    }
}
pub type SharedPhaseD = Arc<Mutex<PhaseDManager>>;

#[derive(Deserialize, Serialize)]
struct Handshake {
    version: u8,
    device_id: String,
    timestamp: i64,
    nonce: String,
    adapter_pid: u32,
    mac: String,
}
fn canonical(h: &Handshake) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}",
        h.version, h.device_id, h.timestamp, h.nonce, h.adapter_pid
    )
}
fn verify_handshake(
    line: &str,
    secret: &[u8],
    now: i64,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    if line.len() > MAX_HANDSHAKE {
        return Err("handshake_too_large".into());
    }
    let h: Handshake = serde_json::from_str(line).map_err(|_| "invalid_handshake")?;
    if h.version != 1 || h.device_id.len() > 128 || h.nonce.len() < 16 || h.nonce.len() > 128 {
        return Err("invalid_handshake".into());
    }
    if (now - h.timestamp).abs() > CLOCK_SKEW_MS {
        return Err("expired_handshake".into());
    }
    if seen.contains(&h.nonce) {
        return Err("replayed_nonce".into());
    }
    let supplied = hex::decode(&h.mac).map_err(|_| "bad_mac")?;
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|_| "bad_secret")?;
    mac.update(canonical(&h).as_bytes());
    mac.verify_slice(&supplied).map_err(|_| "bad_mac")?;
    seen.insert(h.nonce);
    Ok(())
}
fn loopback_addr(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)
}
fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| "app_data_unavailable".into())
}
fn enabled_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("phase-d.enabled"))
}
fn audit_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("phase-d-audit.jsonl"))
}
fn secret() -> Result<Vec<u8>, String> {
    let mut key = crate::hermes_transport::api_key_bytes()?;
    let mut mac = HmacSha256::new_from_slice(&key).map_err(|_| "invalid_api_key")?;
    mac.update(PHASE_D_KDF_CONTEXT);
    key.fill(0);
    Ok(mac.finalize().into_bytes().to_vec())
}
fn write_audit(app: &AppHandle, event: &str, result: &str) {
    if let Ok(path) = audit_path(app) {
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        if std::fs::metadata(&path)
            .map(|m| m.len() > 2_000_000)
            .unwrap_or(false)
        {
            let _ = std::fs::rename(&path, path.with_extension("jsonl.1"));
        }
        let row = serde_json::json!({"timestamp_ms":now_ms(),"event":event,"result":result});
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            use std::io::Write;
            let _ = writeln!(f, "{}", row);
        }
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[cfg(target_os = "windows")]
fn session_id() -> Result<u32, String> {
    use windows_sys::Win32::System::RemoteDesktop::{
        ProcessIdToSessionId, WTSGetActiveConsoleSessionId,
    };
    let mut id = 0;
    let ok = unsafe { ProcessIdToSessionId(std::process::id(), &mut id) };
    if ok == 0 || id == 0 || id == u32::MAX || unsafe { WTSGetActiveConsoleSessionId() } == u32::MAX
    {
        Err("interactive_session_required".into())
    } else {
        Ok(id)
    }
}
#[cfg(not(target_os = "windows"))]
fn session_id() -> Result<u32, String> {
    Err("windows_only".into())
}
fn cua_exe() -> PathBuf {
    std::env::var_os("HERMES_CUA_DRIVER_EXE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("cua-driver.exe"))
}

fn hidden_cua_command() -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(cua_exe());
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

/// Prefer the release-pinned driver bundled by Windows CI. The environment
/// override remains available for development and emergency replacement.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn configure_bundled_driver(app: &AppHandle) {
    if std::env::var_os("HERMES_CUA_DRIVER_EXE").is_some() {
        return;
    }
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("cua-driver").join("cua-driver.exe");
        if bundled.is_file() {
            std::env::set_var("HERMES_CUA_DRIVER_EXE", bundled);
        }
    }
}
async fn proxy_connection(
    stream: TcpStream,
    secret: Vec<u8>,
    seen: Arc<Mutex<HashSet<String>>>,
    app: AppHandle,
    state: SharedPhaseD,
) -> Result<(), String> {
    let (read, mut write) = stream.into_split();
    let mut reader = BufReader::new(read);
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut line))
        .await
        .map_err(|_| "auth_timeout")?
        .map_err(|_| "auth_io")?;
    {
        let mut seen = seen.lock().await;
        verify_handshake(line.trim_end(), &secret, now_ms() as i64, &mut seen)?;
    }
    write.write_all(b"OK\n").await.map_err(|_| "auth_io")?;
    write_audit(&app, "adapter_authenticated", "allowed");
    {
        let mut manager = state.lock().await;
        manager.status.adapter_connected = true;
        manager.status.last_heartbeat_ms = Some(now_ms());
        manager.status.state = PhaseDState::Ready;
    }
    let mut child = hidden_cua_command()
        .args(["mcp", "--socket", CUA_PIPE])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| "cua_mcp_start")?;
    let mut cin = child.stdin.take().ok_or("cua_stdin")?;
    let mut cout = child.stdout.take().ok_or("cua_stdout")?;
    let mut inbound = reader;
    let a = tokio::io::copy(&mut inbound, &mut cin);
    let b = tokio::io::copy(&mut cout, &mut write);
    let _ = tokio::try_join!(a, b);
    let _ = child.kill().await;
    {
        let mut manager = state.lock().await;
        manager.status.adapter_connected = false;
        if manager.status.enabled {
            manager.status.state = PhaseDState::Degraded;
        }
    }
    Ok(())
}
async fn run_proxy(
    app: AppHandle,
    secret: Vec<u8>,
    state: SharedPhaseD,
    mut cancel: oneshot::Receiver<()>,
) -> Result<(), String> {
    let listener = TcpListener::bind(loopback_addr(BRIDGE_PORT))
        .await
        .map_err(|_| "proxy_bind")?;
    let seen = Arc::new(Mutex::new(HashSet::new()));
    loop {
        tokio::select! {_=&mut cancel=>return Ok(()), accepted=listener.accept()=>{let (stream,peer)=accepted.map_err(|_|"proxy_accept")?;if !peer.ip().is_loopback(){continue}let s=secret.clone();let n=seen.clone();let a=app.clone();let state=state.clone();tauri::async_runtime::spawn(async move{if let Err(code)=proxy_connection(stream,s,n,a.clone(),state).await{write_audit(&a,"adapter_auth",&code);}});}}
    }
}

async fn wait_for_cua() -> bool {
    for _ in 0..20 {
        if hidden_cua_command()
            .args(["status", "--socket", CUA_PIPE])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    false
}
async fn kill_cua(manager: &mut PhaseDManager) {
    let _ = hidden_cua_command()
        .args(["revoke", "--all", "--socket", CUA_PIPE])
        .output()
        .await;
    let _ = hidden_cua_command()
        .args(["stop", "--socket", CUA_PIPE])
        .output()
        .await;
    if let Some(child) = manager.cua.as_mut() {
        let _ = child.kill().await;
    }
    manager.cua = None;
}

#[tauri::command]
pub async fn phase_d_status(
    app: AppHandle,
    state: tauri::State<'_, SharedPhaseD>,
) -> Result<PhaseDStatus, String> {
    let mut s = state.lock().await.status.clone();
    s.audit_bytes = audit_path(&app)
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(s)
}
#[tauri::command]
pub async fn phase_d_enable(
    app: AppHandle,
    state: tauri::State<'_, SharedPhaseD>,
    tunnel: tauri::State<'_, crate::ssh_tunnel::SharedSshTunnel>,
) -> Result<PhaseDStatus, String> {
    if !cfg!(target_os = "windows") {
        return Err("windows_only".into());
    }
    let sid = session_id()?;
    let dir = app_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|_| "app_data_write")?;
    std::fs::write(dir.join("phase-d-capabilities.yaml"), MANIFEST)
        .map_err(|_| "manifest_write")?;
    let sec = secret()?;
    {
        let mut m = state.lock().await;
        if m.status.enabled {
            return Ok(m.status.clone());
        }
        m.status.enabled = true;
        m.status.state = PhaseDState::StartingCua;
        m.status.session_id = Some(sid);
        let child = hidden_cua_command()
            .args([
                "serve",
                "--permission-mode",
                "bounded",
                "--capability-manifest",
                dir.join("phase-d-capabilities.yaml")
                    .to_string_lossy()
                    .as_ref(),
                "--approve-capability-manifest",
                "--socket",
                CUA_PIPE,
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "cua_start")?;
        m.cua = Some(child);
    }
    if !wait_for_cua().await {
        let mut m = state.lock().await;
        kill_cua(&mut m).await;
        m.status.state = PhaseDState::Error;
        m.status.last_error = Some("cua_daemon_not_ready".into());
        return Err("cua_daemon_not_ready".into());
    }
    {
        let mut m = state.lock().await;
        m.status.daemon_reachable = true;
        m.status.state = PhaseDState::StartingProxy;
        let (tx, rx) = oneshot::channel();
        m.cancel = Some(tx);
        tauri::async_runtime::spawn(run_proxy(app.clone(), sec, state.inner().clone(), rx));
        m.status.state = PhaseDState::ConnectingTunnel;
    }
    std::fs::write(enabled_path(&app)?, b"1").map_err(|_| "state_write")?;
    crate::ssh_tunnel::restart_with_phase_d(tunnel.inner(), true).await?;
    write_audit(&app, "enable", "allowed");
    Ok(state.lock().await.status.clone())
}
#[tauri::command]
pub async fn phase_d_disable(
    app: AppHandle,
    state: tauri::State<'_, SharedPhaseD>,
    tunnel: tauri::State<'_, crate::ssh_tunnel::SharedSshTunnel>,
    forget: bool,
) -> Result<PhaseDStatus, String> {
    let mut m = state.lock().await;
    m.status.state = PhaseDState::Stopping;
    if let Some(c) = m.cancel.take() {
        let _ = c.send(());
    }
    kill_cua(&mut m).await;
    let _ = std::fs::remove_file(enabled_path(&app)?);
    let _ = crate::ssh_tunnel::restart_with_phase_d(tunnel.inner(), false).await;

    m.status = PhaseDStatus::default();
    write_audit(
        &app,
        if forget { "disable_forget" } else { "disable" },
        "allowed",
    );
    Ok(m.status.clone())
}
#[tauri::command]
pub async fn phase_d_rotate_credentials() -> Result<(), String> {
    Err("Phase D credentials are derived from the Hermes API key; rotate that key instead".into())
}
#[tauri::command]
pub async fn phase_d_test() -> Result<String, String> {
    let out = hidden_cua_command()
        .args(["doctor", "--json"])
        .output()
        .await
        .map_err(|_| "cua_missing")?;
    if out.status.success() {
        Ok("doctor_ok".into())
    } else {
        Err("doctor_failed".into())
    }
}
#[tauri::command]
pub fn phase_d_export_audit(app: AppHandle) -> Result<String, String> {
    std::fs::read_to_string(audit_path(&app)?).map_err(|_| "audit_read".into())
}
#[tauri::command]
pub fn phase_d_clear_audit(app: AppHandle) -> Result<(), String> {
    match std::fs::remove_file(audit_path(&app)?) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("audit_clear".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signed(secret: &[u8], ts: i64, nonce: &str) -> String {
        let mut h = Handshake {
            version: 1,
            device_id: "d".into(),
            timestamp: ts,
            nonce: nonce.into(),
            adapter_pid: 7,
            mac: String::new(),
        };
        let mut m = HmacSha256::new_from_slice(secret).unwrap();
        m.update(canonical(&h).as_bytes());
        h.mac = hex::encode(m.finalize().into_bytes());
        serde_json::to_string(&h).unwrap()
    }
    #[test]
    fn loopback_is_fixed() {
        assert_eq!(loopback_addr(BRIDGE_PORT).to_string(), "127.0.0.1:18765")
    }
    #[test]
    fn hmac_expiry_and_replay() {
        let s = b"01234567890123456789012345678901";
        let mut seen = HashSet::new();
        let line = signed(s, 1000, "0123456789abcdef");
        assert!(verify_handshake(&line, s, 1000, &mut seen).is_ok());
        assert_eq!(
            verify_handshake(&line, s, 1000, &mut seen).unwrap_err(),
            "replayed_nonce"
        );
        assert_eq!(
            verify_handshake(&signed(s, 1, "fedcba9876543210"), s, 40000, &mut seen).unwrap_err(),
            "expired_handshake"
        );
        assert_eq!(
            verify_handshake(
                &signed(
                    b"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    1000,
                    "aaaaaaaaaaaaaaaa"
                ),
                s,
                1000,
                &mut seen
            )
            .unwrap_err(),
            "bad_mac"
        )
    }
    #[test]
    fn manifest_is_bounded() {
        assert!(MANIFEST.contains("version: 3"));
        assert!(MANIFEST.contains("expires_after: 24h"));
        assert!(MANIFEST.contains("display: true"));
        assert!(!MANIFEST.contains("display: false"));
        assert!(!MANIFEST.contains("launch_app"));
        assert!(!MANIFEST.contains("clipboard"));
    }
}
