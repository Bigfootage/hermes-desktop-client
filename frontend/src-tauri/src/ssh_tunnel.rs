use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

const LOCAL_ENDPOINT: &str = "http://127.0.0.1:8642";
const PROFILE_FILE: &str = "hermes-ssh-tunnel.json";
const MAX_ERROR_LENGTH: usize = 2_000;
const CANONICAL_HOST: &str = "195.200.6.50";
const CANONICAL_HOST_KEY: &str = "195.200.6.50 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFr4vexvkvfZH9QV1msUdHkBKGwpK4H0NDbLbPhO2z3y\n";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelProfile {
    pub username: String,
    pub host: String,
    pub private_key_path: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TunnelPhase {
    Unsupported,
    Unconfigured,
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub supported: bool,
    pub configured: bool,
    pub phase: TunnelPhase,
    pub endpoint: String,
    pub attempt: u32,
    pub error_code: Option<String>,
    pub message: Option<String>,
    pub profile: Option<SshTunnelProfile>,
}

impl Default for TunnelStatus {
    fn default() -> Self {
        Self {
            supported: cfg!(target_os = "windows"),
            configured: false,
            phase: if cfg!(target_os = "windows") {
                TunnelPhase::Unconfigured
            } else {
                TunnelPhase::Unsupported
            },
            endpoint: LOCAL_ENDPOINT.into(),
            attempt: 0,
            error_code: None,
            message: None,
            profile: None,
        }
    }
}

#[derive(Default)]
pub struct SshTunnelManager {
    status: TunnelStatus,
    cancel: Option<oneshot::Sender<()>>,
    supervisor: Option<JoinHandle<()>>,
    generation: u64,
}

pub type SharedSshTunnel = Arc<Mutex<SshTunnelManager>>;

fn validate_profile(profile: SshTunnelProfile) -> Result<SshTunnelProfile, String> {
    let profile = SshTunnelProfile {
        username: profile.username.trim().to_string(),
        host: profile.host.trim().to_string(),
        private_key_path: profile.private_key_path.trim().to_string(),
        port: profile.port,
    };
    if profile.username.is_empty() || profile.host.is_empty() || profile.private_key_path.is_empty()
    {
        return Err("SSH username, host, and private key are required".into());
    }
    if profile.username.chars().any(char::is_whitespace)
        || profile.host.chars().any(char::is_whitespace)
        || profile.username.starts_with('-')
        || profile.host.starts_with('-')
        || profile.username.contains('@')
    {
        return Err("Enter a valid SSH username and host".into());
    }
    if profile.port == 0 {
        return Err("SSH port must be between 1 and 65535".into());
    }
    let key = Path::new(&profile.private_key_path);
    if !key.is_file() {
        return Err("The selected private key file does not exist".into());
    }
    Ok(profile)
}

pub fn ssh_args(profile: &SshTunnelProfile, phase_d_enabled: bool) -> Vec<String> {
    let known_hosts = Path::new(&profile.private_key_path)
        .parent()
        .unwrap_or(Path::new("."))
        .join("phase-d")
        .join("known_hosts");
    let mut args = vec![
        "-N".into(),
        "-T".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        format!("UserKnownHostsFile={}", known_hosts.display()),
        "-o".into(),
        "GlobalKnownHostsFile=NUL".into(),
        "-p".into(),
        profile.port.to_string(),
        "-i".into(),
        profile.private_key_path.clone(),
        "-L".into(),
        "127.0.0.1:8642:127.0.0.1:8642".into(),
    ];
    if phase_d_enabled {
        args.extend(["-R".into(), "127.0.0.1:18765:127.0.0.1:18765".into()]);
    }
    args.push(format!("{}@{}", profile.username, profile.host));
    args
}

pub fn reconnect_delay(attempt: u32) -> Duration {
    Duration::from_secs(2_u64.saturating_pow(attempt.min(5)).min(30))
}

fn classify_ssh_error(stderr: &str) -> (String, String, bool) {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("host key verification failed") || lower.contains("no host key is known") {
        ("host_key".into(), "The server host key is not trusted. Verify the host fingerprint, then connect once with OpenSSH to add it to known_hosts.".into(), false)
    } else if lower.contains("permission denied")
        || lower.contains("load key")
        || lower.contains("invalid format")
    {
        ("key_auth".into(), "SSH rejected the private key. Check that this key belongs to the SSH user and is an OpenSSH-compatible private key.".into(), false)
    } else if lower.contains("address already in use") || lower.contains("cannot listen to port") {
        ("local_port".into(), "Local port 8642 is already in use. Close the other tunnel or application using that port, then retry.".into(), true)
    } else if lower.contains("could not resolve hostname") {
        (
            "host".into(),
            "The SSH host could not be resolved. Check the hostname and network connection.".into(),
            true,
        )
    } else if lower.contains("connection timed out")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
    {
        (
            "network".into(),
            "The SSH host is unreachable. Check the host, VPN, firewall, and server SSH service."
                .into(),
            true,
        )
    } else {
        (
            "ssh_exit".into(),
            "The SSH tunnel stopped unexpectedly. Check the SSH host and key, then retry.".into(),
            true,
        )
    }
}

#[cfg(target_os = "windows")]
fn ssh_executable() -> Result<PathBuf, String> {
    let windows = std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into());
    let path = PathBuf::from(windows)
        .join("System32")
        .join("OpenSSH")
        .join("ssh.exe");
    if path.is_file() {
        Ok(path)
    } else {
        Err("Windows OpenSSH Client is not installed. Open Settings → System → Optional features and install OpenSSH Client.".into())
    }
}

#[cfg(not(target_os = "windows"))]
fn ssh_executable() -> Result<PathBuf, String> {
    Err("The managed SSH tunnel is available only on Windows".into())
}

fn profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(PROFILE_FILE))
        .map_err(|e| format!("Failed to locate app configuration: {e}"))
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn load_profile(app: &AppHandle) -> Result<Option<SshTunnelProfile>, String> {
    let path = profile_path(app)?;
    match std::fs::read_to_string(path) {
        Ok(data) => serde_json::from_str(&data)
            .map(Some)
            .map_err(|_| "The saved SSH tunnel profile is invalid".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read the SSH tunnel profile: {e}")),
    }
}

fn save_profile(app: &AppHandle, profile: &SshTunnelProfile) -> Result<(), String> {
    let path = profile_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app configuration: {e}"))?;
    }
    let data = serde_json::to_vec_pretty(profile).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| format!("Failed to save the SSH tunnel profile: {e}"))
}

fn ensure_canonical_host_trust(profile: &SshTunnelProfile) -> Result<(), String> {
    if profile.host != CANONICAL_HOST || profile.port != 22 {
        return Err(
            "This private build only connects to the pinned Hermes VM at 195.200.6.50:22".into(),
        );
    }
    let directory = Path::new(&profile.private_key_path)
        .parent()
        .unwrap_or(Path::new("."))
        .join("phase-d");
    std::fs::create_dir_all(&directory)
        .map_err(|e| format!("Failed to create the private host-trust directory: {e}"))?;
    std::fs::write(directory.join("known_hosts"), CANONICAL_HOST_KEY)
        .map_err(|e| format!("Failed to install the pinned Hermes VM host key: {e}"))
}

async fn set_status(
    state: &SharedSshTunnel,
    phase: TunnelPhase,
    attempt: u32,
    error: Option<(String, String)>,
) {
    let mut manager = state.lock().await;
    manager.status.phase = phase;
    manager.status.attempt = attempt;
    manager.status.error_code = error.as_ref().map(|e| e.0.clone());
    manager.status.message = error.map(|e| e.1);
}

async fn supervise(
    state: SharedSshTunnel,
    profile: SshTunnelProfile,
    phase_d_enabled: bool,
    mut cancel: oneshot::Receiver<()>,
) {
    let mut attempt = 0;
    loop {
        let exe = match ssh_executable() {
            Ok(path) => path,
            Err(message) => {
                set_status(
                    &state,
                    TunnelPhase::Error,
                    attempt,
                    Some(("openssh_missing".into(), message)),
                )
                .await;
                return;
            }
        };
        set_status(
            &state,
            if attempt == 0 {
                TunnelPhase::Connecting
            } else {
                TunnelPhase::Reconnecting
            },
            attempt,
            None,
        )
        .await;
        let mut command = Command::new(exe);
        command
            .args(ssh_args(&profile, phase_d_enabled))
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        command.creation_flags(0x08000000);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                set_status(&state, TunnelPhase::Error, attempt, Some(("openssh_start".into(), "Windows OpenSSH Client could not be started. Repair or reinstall the OpenSSH Client optional feature.".into()))).await;
                return;
            }
        };
        let stderr = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            let mut result = String::new();
            if let Some(stderr) = stderr {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if result.len() < MAX_ERROR_LENGTH {
                        result.push_str(&line);
                        result.push('\n');
                    }
                }
            }
            result
        });

        tokio::select! {
            probe = probe_tunnel() => {
                match (probe, child.try_wait()) {
                    (Ok(()), Ok(None)) => set_status(&state, TunnelPhase::Connected, attempt, None).await,
                    _ => {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        set_status(&state, TunnelPhase::Error, attempt, Some(("health_timeout".into(), "The SSH process started, but Hermes did not become reachable on 127.0.0.1:8642.".into()))).await;
                        return;
                    }
                }
            }
            _ = &mut cancel => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                set_status(&state, TunnelPhase::Disconnected, 0, None).await;
                return;
            }
        }

        let exit = tokio::select! {
            result = child.wait() => result,
            _ = &mut cancel => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                set_status(&state, TunnelPhase::Disconnected, 0, None).await;
                return;
            }
        };
        let stderr = stderr_task.await.unwrap_or_default();
        let (code, message, retryable) = classify_ssh_error(&stderr);
        if exit.is_err() || !retryable {
            set_status(&state, TunnelPhase::Error, attempt, Some((code, message))).await;
            return;
        }
        attempt = attempt.saturating_add(1);
        set_status(
            &state,
            TunnelPhase::Reconnecting,
            attempt,
            Some((code, message)),
        )
        .await;
        tokio::select! {
            _ = tokio::time::sleep(reconnect_delay(attempt)) => {},
            _ = &mut cancel => {
                set_status(&state, TunnelPhase::Disconnected, 0, None).await;
                return;
            }
        }
    }
}

async fn probe_tunnel() -> Result<(), ()> {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect("127.0.0.1:8642")
            .await
            .is_ok()
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(())
}

async fn start_supervisor(
    state: SharedSshTunnel,
    profile: SshTunnelProfile,
    phase_d_enabled: bool,
) {
    stop(&state).await;
    let (tx, rx) = oneshot::channel();
    let generation;
    {
        let mut manager = state.lock().await;
        manager.generation = manager.generation.wrapping_add(1);
        generation = manager.generation;
        manager.status.configured = true;
        manager.status.profile = Some(profile.clone());
        manager.cancel = Some(tx);
    }
    let handle =
        tauri::async_runtime::spawn(supervise(state.clone(), profile, phase_d_enabled, rx));
    let mut manager = state.lock().await;
    if manager.generation == generation {
        manager.supervisor = Some(handle);
    } else {
        handle.abort();
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub async fn start_saved(app: AppHandle, state: SharedSshTunnel) {
    match load_profile(&app) {
        Ok(Some(profile)) => {
            let phase_d = app
                .path()
                .app_config_dir()
                .map(|p| p.join("phase-d.enabled").is_file())
                .unwrap_or(false);
            start_supervisor(state, profile, phase_d).await
        }
        Ok(None) => {}
        Err(message) => {
            set_status(
                &state,
                TunnelPhase::Error,
                0,
                Some(("profile".into(), message)),
            )
            .await
        }
    }
}

pub async fn stop(state: &SharedSshTunnel) {
    let (cancel, supervisor) = {
        let mut manager = state.lock().await;
        (manager.cancel.take(), manager.supervisor.take())
    };
    if let Some(cancel) = cancel {
        let _ = cancel.send(());
    }
    if let Some(supervisor) = supervisor {
        let _ = supervisor.await;
    }
}

pub async fn restart_with_phase_d(state: &SharedSshTunnel, enabled: bool) -> Result<(), String> {
    let profile = state
        .lock()
        .await
        .status
        .profile
        .clone()
        .ok_or("No SSH tunnel is configured")?;
    start_supervisor(state.clone(), profile, enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn ssh_tunnel_status(
    state: tauri::State<'_, SharedSshTunnel>,
) -> Result<TunnelStatus, String> {
    Ok(state.lock().await.status.clone())
}

#[tauri::command]
pub async fn ssh_tunnel_setup(
    app: AppHandle,
    state: tauri::State<'_, SharedSshTunnel>,
    profile: SshTunnelProfile,
) -> Result<TunnelStatus, String> {
    if !cfg!(target_os = "windows") {
        return Err("The managed SSH tunnel is available only on Windows".into());
    }
    ssh_executable()?;
    let profile = validate_profile(profile)?;
    ensure_canonical_host_trust(&profile)?;
    let phase_d = app
        .path()
        .app_config_dir()
        .map(|p| p.join("phase-d.enabled").is_file())
        .unwrap_or(false);
    start_supervisor(state.inner().clone(), profile.clone(), phase_d).await;
    let connected = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let phase = state.lock().await.status.phase.clone();
            if phase == TunnelPhase::Connected {
                return Ok(());
            }
            if phase == TunnelPhase::Error {
                return Err(state
                    .lock()
                    .await
                    .status
                    .message
                    .clone()
                    .unwrap_or_else(|| "SSH tunnel failed".into()));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| "Timed out waiting for the SSH tunnel health check".to_string())?;
    if let Err(error) = connected {
        stop(state.inner()).await;
        return Err(error);
    }
    save_profile(&app, &profile)?;
    app.autolaunch()
        .enable()
        .map_err(|e| format!("Tunnel connected, but launch at login could not be enabled: {e}"))?;
    Ok(state.lock().await.status.clone())
}

#[tauri::command]
pub async fn ssh_tunnel_disconnect(state: tauri::State<'_, SharedSshTunnel>) -> Result<(), String> {
    stop(state.inner()).await;
    Ok(())
}

#[tauri::command]
pub async fn ssh_tunnel_retry(
    app: AppHandle,
    state: tauri::State<'_, SharedSshTunnel>,
) -> Result<TunnelStatus, String> {
    let profile = state
        .lock()
        .await
        .status
        .profile
        .clone()
        .ok_or("No SSH tunnel is configured")?;
    let phase_d = app
        .path()
        .app_config_dir()
        .map(|p| p.join("phase-d.enabled").is_file())
        .unwrap_or(false);
    start_supervisor(state.inner().clone(), profile, phase_d).await;
    Ok(state.lock().await.status.clone())
}

#[tauri::command]
pub async fn ssh_tunnel_clear(
    app: AppHandle,
    state: tauri::State<'_, SharedSshTunnel>,
) -> Result<(), String> {
    stop(state.inner()).await;
    let path = profile_path(&app)?;
    if let Err(e) = std::fs::remove_file(path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("Failed to remove SSH tunnel profile: {e}"));
        }
    }
    let mut manager = state.lock().await;
    manager.status = TunnelStatus::default();
    Ok(())
}

#[tauri::command]
pub fn ssh_autostart_status(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to read launch-at-login setting: {e}"))
}

#[tauri::command]
pub fn ssh_set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| format!("Failed to update launch-at-login setting: {e}"))?;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to verify launch-at-login setting: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> SshTunnelProfile {
        SshTunnelProfile {
            username: "hermes".into(),
            host: "vm.example".into(),
            private_key_path: r"C:\Users\me\.ssh\id_ed25519".into(),
            port: 22,
        }
    }

    #[test]
    fn command_is_noninteractive_strict_and_loopback_only() {
        let args = ssh_args(&profile(), true);
        assert_eq!(args[0], "-N");
        assert!(args.windows(2).any(|v| v == ["-o", "BatchMode=yes"]));
        assert!(args
            .windows(2)
            .any(|v| v == ["-o", "ExitOnForwardFailure=yes"]));
        assert!(args
            .windows(2)
            .any(|v| v == ["-o", "StrictHostKeyChecking=yes"]));
        assert!(args.windows(2).any(|v| v == ["-p", "22"]));
        assert!(args.iter().any(|v| v == "ConnectTimeout=10"));
        assert!(args
            .windows(2)
            .any(|v| v == ["-L", "127.0.0.1:8642:127.0.0.1:8642"]));
        assert!(args
            .windows(2)
            .any(|v| v == ["-R", "127.0.0.1:18765:127.0.0.1:18765"]));
        assert_eq!(args.last().unwrap(), "hermes@vm.example");
        assert!(!args
            .iter()
            .any(|a| a.to_ascii_lowercase().contains("password")));
    }

    #[test]
    fn backoff_is_bounded() {
        assert_eq!(reconnect_delay(0), Duration::from_secs(1));
        assert_eq!(reconnect_delay(1), Duration::from_secs(2));
        assert_eq!(reconnect_delay(4), Duration::from_secs(16));
        assert_eq!(reconnect_delay(99), Duration::from_secs(30));
    }

    #[test]
    fn errors_are_actionable_and_auth_errors_do_not_loop() {
        let (code, message, retry) = classify_ssh_error("Host key verification failed.");
        assert_eq!(code, "host_key");
        assert!(message.contains("fingerprint"));
        assert!(!retry);
        assert!(!classify_ssh_error("Permission denied (publickey).").2);
        assert!(classify_ssh_error("Connection timed out").2);
    }
}
