use futures_util::StreamExt;
use reqwest::{Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

const SERVICE: &str = "Hermes Desktop Client";
const ACCOUNT: &str = "hermes-api";
static STREAM_CANCELLATIONS: LazyLock<Mutex<HashMap<String, oneshot::Sender<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestInput {
    pub path: String,
    #[serde(default = "default_method")]
    pub method: String,
    pub body: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseOutput {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Metadata {
        status: u16,
        headers: HashMap<String, String>,
    },
    Chunk {
        data: Vec<u8>,
    },
    End,
    Error {
        message: String,
    },
}

fn default_method() -> String {
    "GET".into()
}

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("Failed to open native credential storage: {e}"))
}

fn normalized_base(input: &str) -> Result<String, String> {
    let mut url =
        Url::parse(input.trim()).map_err(|_| "Enter a valid Hermes API URL".to_string())?;
    let loopback = url
        .host_str()
        .and_then(|host| host.parse::<std::net::IpAddr>().ok())
        .is_some_and(|ip| ip.is_loopback());
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Remote Hermes connections require HTTPS; HTTP is allowed only for loopback IP addresses".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Hermes API URL must not contain credentials, a query, or a fragment".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn request_url(base: &str, path: &str) -> Result<Url, String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Hermes request path must start with one slash".into());
    }
    let base = normalized_base(base)?;
    Url::parse(&format!("{base}{path}")).map_err(|_| "Invalid Hermes request path".into())
}

fn load_secret() -> Result<ConnectionProfile, String> {
    let value = credential()?.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => "No Hermes connection is configured".into(),
        other => format!("Failed to read native credential storage: {other}"),
    })?;
    serde_json::from_str(&value).map_err(|_| "Stored Hermes credential is invalid".into())
}

fn public_profile() -> Result<Option<ConnectionProfile>, String> {
    match credential()?.get_password() {
        Ok(value) => {
            let mut profile: ConnectionProfile = serde_json::from_str(&value)
                .map_err(|_| "Stored Hermes credential is invalid".to_string())?;
            profile.api_key = None;
            Ok(Some(profile))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read native credential storage: {e}")),
    }
}

fn safe_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    ["content-type", "retry-after"]
        .into_iter()
        .filter_map(|name| {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(|v| (name.into(), v.into()))
        })
        .collect()
}

fn build_request(
    client: &reqwest::Client,
    profile: &ConnectionProfile,
    input: &RequestInput,
) -> Result<reqwest::RequestBuilder, String> {
    let method = Method::from_bytes(input.method.as_bytes())
        .map_err(|_| "Invalid HTTP method".to_string())?;
    let mut request = client
        .request(method, request_url(&profile.base_url, &input.path)?)
        .bearer_auth(
            profile
                .api_key
                .as_deref()
                .ok_or("Stored Hermes API key is empty")?,
        )
        .header(
            "Accept",
            input
                .headers
                .get("accept")
                .map(String::as_str)
                .unwrap_or("application/json"),
        );
    if let Some(content_type) = input.headers.get("content-type") {
        request = request.header("Content-Type", content_type);
    }
    if let Some(key) = input.headers.get("idempotency-key") {
        request = request.header("Idempotency-Key", key);
    }
    if let Some(body) = &input.body {
        request = request.body(body.clone());
    }
    Ok(request)
}

#[tauri::command]
pub async fn hermes_save_connection(
    profile: ConnectionProfile,
) -> Result<ConnectionProfile, String> {
    let base_url = normalized_base(&profile.base_url)?;
    let api_key = profile.api_key.unwrap_or_default().trim().to_string();
    if api_key.is_empty() {
        return Err("Hermes API key is required".into());
    }
    let stored = ConnectionProfile {
        base_url: base_url.clone(),
        api_key: Some(api_key),
    };
    credential()?
        .set_password(&serde_json::to_string(&stored).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to save Hermes credential in native storage: {e}"))?;
    Ok(ConnectionProfile {
        base_url,
        api_key: None,
    })
}

#[tauri::command]
pub async fn hermes_validate_connection(
    profile: ConnectionProfile,
) -> Result<ConnectionProfile, String> {
    let profile = ConnectionProfile {
        base_url: normalized_base(&profile.base_url)?,
        api_key: Some(profile.api_key.unwrap_or_default().trim().to_string()),
    };
    if profile.api_key.as_deref().unwrap_or_default().is_empty() {
        return Err("Hermes API key is required".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create Hermes HTTP client: {e}"))?;
    for path in ["/health", "/v1/capabilities"] {
        let input = RequestInput {
            path: path.into(),
            method: "GET".into(),
            body: None,
            headers: HashMap::new(),
            timeout_ms: Some(30_000),
        };
        let response = build_request(&client, &profile, &input)?
            .send()
            .await
            .map_err(|e| format!("Hermes connection validation failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Hermes connection validation failed (HTTP {})",
                response.status().as_u16()
            ));
        }
    }
    Ok(ConnectionProfile {
        base_url: profile.base_url,
        api_key: None,
    })
}

#[tauri::command]
pub async fn hermes_load_connection() -> Result<Option<ConnectionProfile>, String> {
    public_profile()
}

#[tauri::command]
pub async fn hermes_clear_connection() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to remove Hermes credential: {e}")),
    }
}

#[tauri::command]
pub async fn hermes_request(input: RequestInput) -> Result<ResponseOutput, String> {
    let profile = load_secret()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(
            input.timeout_ms.unwrap_or(30_000).clamp(1, 300_000),
        ))
        .build()
        .map_err(|e| format!("Failed to create Hermes HTTP client: {e}"))?;
    let response = build_request(&client, &profile, &input)?
        .send()
        .await
        .map_err(|e| format!("Hermes request failed: {e}"))?;
    let status = response.status();
    let headers = safe_headers(response.headers());
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Hermes response: {e}"))?;
    Ok(ResponseOutput {
        status: status.as_u16(),
        body,
        headers,
    })
}

#[tauri::command]
pub async fn hermes_stream(
    input: RequestInput,
    stream_id: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let profile = load_secret()?;
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    STREAM_CANCELLATIONS
        .lock()
        .map_err(|_| "Stream cancellation registry is unavailable".to_string())?
        .insert(stream_id.clone(), cancel_tx);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(
            input.timeout_ms.unwrap_or(300_000).clamp(1, 3_600_000),
        ))
        .build()
        .map_err(|e| format!("Failed to create Hermes HTTP client: {e}"))?;
    let response = tokio::select! {
        _ = &mut cancel_rx => {
            if let Ok(mut cancellations) = STREAM_CANCELLATIONS.lock() { cancellations.remove(&stream_id); }
            let _ = on_event.send(StreamEvent::End);
            return Ok(());
        }
        response = build_request(&client, &profile, &input)?.send() => response
            .map_err(|e| format!("Hermes stream failed: {e}"))?,
    };
    let status = response.status();
    on_event
        .send(StreamEvent::Metadata {
            status: status.as_u16(),
            headers: safe_headers(response.headers()),
        })
        .map_err(|e| e.to_string())?;
    if !status.is_success() {
        let text = response.text().await.unwrap_or_else(|_| {
            StatusCode::canonical_reason(&status)
                .unwrap_or("HTTP error")
                .into()
        });
        on_event
            .send(StreamEvent::Error {
                message: format!("Hermes stream failed (HTTP {}): {}", status.as_u16(), text),
            })
            .map_err(|e| e.to_string())?;
        if let Ok(mut cancellations) = STREAM_CANCELLATIONS.lock() {
            cancellations.remove(&stream_id);
        }
        return Ok(());
    }
    let mut stream = response.bytes_stream();
    loop {
        let chunk = tokio::select! {
            _ = &mut cancel_rx => break,
            chunk = stream.next() => chunk,
        };
        let Some(chunk) = chunk else { break };
        match chunk {
            Ok(bytes) => on_event
                .send(StreamEvent::Chunk {
                    data: bytes.to_vec(),
                })
                .map_err(|e| e.to_string())?,
            Err(e) => {
                on_event
                    .send(StreamEvent::Error {
                        message: format!("Hermes stream read failed: {e}"),
                    })
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    if let Ok(mut cancellations) = STREAM_CANCELLATIONS.lock() {
        cancellations.remove(&stream_id);
    }
    on_event.send(StreamEvent::End).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn hermes_cancel_stream(stream_id: String) -> Result<(), String> {
    let sender = STREAM_CANCELLATIONS
        .lock()
        .map_err(|_| "Stream cancellation registry is unavailable".to_string())?
        .remove(&stream_id);
    if let Some(sender) = sender {
        let _ = sender.send(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn url_policy_allows_only_https_or_loopback_ip_http() {
        assert_eq!(
            normalized_base("https://vm.example///").unwrap(),
            "https://vm.example"
        );
        assert_eq!(
            normalized_base("http://127.0.0.1:8642/").unwrap(),
            "http://127.0.0.1:8642"
        );
        assert!(normalized_base("http://vm.example").is_err());
        assert!(normalized_base("http://localhost:8000").is_err());
    }
    #[test]
    fn request_paths_cannot_replace_the_origin() {
        assert!(request_url("https://vm.example", "//evil.example/x").is_err());
        assert!(request_url("https://vm.example", "https://evil.example/x").is_err());
        assert_eq!(
            request_url("https://vm.example/api", "/v1/runs?q=1")
                .unwrap()
                .as_str(),
            "https://vm.example/api/v1/runs?q=1"
        );
    }
    #[test]
    fn public_profile_never_contains_api_key_shape() {
        let value = serde_json::to_value(ConnectionProfile {
            base_url: "https://vm.example".into(),
            api_key: None,
        })
        .unwrap();
        assert!(value.get("apiKey").is_none());
    }
}
