use axum::{
    body::Bytes,
    extract::{Path, rejection::BytesRejection},
    http::{StatusCode, Uri},
    response::Response,
};
use serde::{Deserialize, Serialize};

use super::no_store_status_json;

#[path = "backups_download.rs"]
mod download;
pub(in crate::server) use download::download;

const MAX_REQUEST_BYTES: usize = 2_048;
#[cfg(any(unix, test))]
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
#[cfg(unix)]
const AGENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
#[cfg(unix)]
const AGENT_SOCKET: &str = "/run/rentnerproxy/backups/agent.sock";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start {
    request_id: String,
    actor_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    request_id: String,
    actor_id: String,
    expected_revision: u32,
    enabled: bool,
    interval_hours: u32,
    retention_count: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OffHostConfig {
    request_id: String,
    actor_id: String,
    expected_revision: u64,
    enabled: bool,
    endpoint: String,
    region: String,
    bucket: String,
    prefix: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    access_key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    secret_access_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_key_saved: Option<bool>,
}

pub(in crate::server) async fn off_host_config(
    uri: Uri,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let request = body
        .ok()
        .filter(|value| value.len() <= 8192)
        .and_then(|value| serde_json::from_slice::<OffHostConfig>(&value).ok());
    let bounded = |value: &str, maximum: usize| {
        value.len() <= maximum && !value.chars().any(char::is_control)
    };
    let Some(request) = request.filter(|request| {
        uri.query().is_none()
            && canonical_uuid(&request.request_id)
            && canonical_uuid(&request.actor_id)
            && request.expected_revision <= 9_007_199_254_740_991
            && bounded(&request.endpoint, 512)
            && bounded(&request.region, 64)
            && bounded(&request.bucket, 63)
            && bounded(&request.prefix, 256)
            && request
                .access_key_id
                .as_deref()
                .is_none_or(|value| bounded(value, 256))
            && request
                .secret_access_key
                .as_deref()
                .is_none_or(|value| bounded(value, 512))
            && request
                .recovery_key
                .as_deref()
                .is_none_or(|value| bounded(value, 44))
    }) else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("PUT", "/off-host", body).await,
        Err(_) => unavailable(),
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuditAcknowledgement {
    store_id: String,
    sequence: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Delete {
    request_id: String,
    actor_id: String,
    metadata_sha256: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Restore {
    request_id: String,
    actor_id: String,
    metadata_sha256: String,
    actor_name: String,
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(in crate::server) async fn maintenance() -> Response {
    forward("GET", "/maintenance", Vec::new()).await
}

pub(in crate::server) async fn delete(
    Path(id): Path<String>,
    uri: Uri,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Some(request) = parse::<Delete>(body).filter(|request| {
        canonical_uuid(&id)
            && uri.query().is_none()
            && canonical_uuid(&request.request_id)
            && canonical_uuid(&request.actor_id)
            && request.metadata_sha256.as_deref().is_none_or(digest)
    }) else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("POST", &format!("/artifacts/{id}/delete"), body).await,
        Err(_) => unavailable(),
    }
}

pub(in crate::server) async fn restore(
    Path(id): Path<String>,
    uri: Uri,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let Some(request) = parse::<Restore>(body).filter(|request| {
        canonical_uuid(&id)
            && uri.query().is_none()
            && canonical_uuid(&request.request_id)
            && canonical_uuid(&request.actor_id)
            && digest(&request.metadata_sha256)
            && !request.actor_name.trim().is_empty()
            && request.actor_name.chars().count() <= 160
            && !request.actor_name.chars().any(char::is_control)
    }) else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("POST", &format!("/artifacts/{id}/restore"), body).await,
        Err(_) => unavailable(),
    }
}

fn canonical_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn error(status: StatusCode, code: &str) -> Response {
    no_store_status_json(status, serde_json::json!({ "error": code }))
}

fn unavailable() -> Response {
    error(StatusCode::SERVICE_UNAVAILABLE, "unavailable")
}

fn parse<T: serde::de::DeserializeOwned>(body: Result<Bytes, BytesRejection>) -> Option<T> {
    let body = body.ok()?;
    if body.len() > MAX_REQUEST_BYTES {
        return None;
    }
    serde_json::from_slice(&body).ok()
}

pub(in crate::server) async fn status() -> Response {
    forward("GET", "/status", Vec::new()).await
}

pub(in crate::server) async fn acknowledge_audit(body: Result<Bytes, BytesRejection>) -> Response {
    let Some(request) = parse::<AuditAcknowledgement>(body).filter(|request| {
        canonical_uuid(&request.store_id) && request.sequence <= 9_007_199_254_740_991
    }) else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("POST", "/audit/ack", body).await,
        Err(_) => unavailable(),
    }
}

pub(in crate::server) async fn start(body: Result<Bytes, BytesRejection>) -> Response {
    let Some(request) = parse::<Start>(body)
        .filter(|request| canonical_uuid(&request.request_id) && canonical_uuid(&request.actor_id))
    else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("POST", "/start", body).await,
        Err(_) => unavailable(),
    }
}

pub(in crate::server) async fn config(body: Result<Bytes, BytesRejection>) -> Response {
    let Some(request) = parse::<Config>(body).filter(|request| {
        canonical_uuid(&request.request_id)
            && canonical_uuid(&request.actor_id)
            && (1..=8_760).contains(&request.interval_hours)
            && (1..=50).contains(&request.retention_count)
    }) else {
        return error(StatusCode::BAD_REQUEST, "invalid_input");
    };
    match serde_json::to_vec(&request) {
        Ok(body) => forward("PUT", "/config", body).await,
        Err(_) => unavailable(),
    }
}

async fn forward(method: &'static str, path: &str, body: Vec<u8>) -> Response {
    #[cfg(unix)]
    {
        forward_socket(std::path::Path::new(AGENT_SOCKET), method, path, body).await
    }
    #[cfg(not(unix))]
    {
        let _ = (method, path, body);
        unavailable()
    }
}

#[cfg(unix)]
async fn forward_socket(
    socket: &std::path::Path,
    method: &'static str,
    path: &str,
    body: Vec<u8>,
) -> Response {
    let result = tokio::time::timeout(AGENT_TIMEOUT, async {
        let stream = tokio::net::UnixStream::connect(socket)
            .await
            .map_err(|_| ())?;
        exchange(stream, method, path, body).await
    })
    .await;
    match result {
        Ok(Ok((status, value))) => agent_response(status, value),
        _ => unavailable(),
    }
}

#[cfg(any(unix, test))]
struct ConnectionTask(tokio::task::JoinHandle<()>);

#[cfg(any(unix, test))]
impl Drop for ConnectionTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(any(unix, test))]
async fn exchange<S>(
    stream: S,
    method: &'static str,
    path: &str,
    body: Vec<u8>,
) -> Result<(StatusCode, serde_json::Value), ()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    use http_body_util::{BodyExt, Full, Limited};
    use hyper_util::rt::TokioIo;

    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|_| ())?;
    let _connection = ConnectionTask(tokio::spawn(async move {
        let _ = connection.await;
    }));
    let request = hyper::Request::builder()
        .method(method)
        .uri(path)
        .header("Host", "localhost")
        .header("Content-Type", "application/json")
        .header("Connection", "close")
        .body(Full::new(Bytes::from(body)))
        .map_err(|_| ())?;
    let response = sender.send_request(request).await.map_err(|_| ())?;
    let status = response.status();
    let body = Limited::new(response.into_body(), MAX_RESPONSE_BYTES)
        .collect()
        .await
        .map_err(|_| ())?
        .to_bytes();
    let value = serde_json::from_slice(&body).map_err(|_| ())?;
    Ok((status, value))
}

#[cfg(any(unix, test))]
fn agent_response(status: StatusCode, value: serde_json::Value) -> Response {
    if matches!(status, StatusCode::OK) && value.is_object() && value.get("error").is_none() {
        return no_store_status_json(status, value);
    }
    let code = value.get("error").and_then(serde_json::Value::as_str);
    match (status, code) {
        (StatusCode::CONFLICT, Some("busy")) => error(status, "busy"),
        (StatusCode::CONFLICT, Some("conflict")) => error(status, "conflict"),
        (StatusCode::BAD_REQUEST, Some("invalid_input")) => error(status, "invalid_input"),
        _ => unavailable(),
    }
}

#[cfg(test)]
#[path = "../../../tests/private/backups.rs"]
mod tests;
