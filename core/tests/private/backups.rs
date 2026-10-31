use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use tower::ServiceExt;

const ID: &str = "0198d98a-0000-7000-8000-000000000001";
const TOKEN: &str = "synthetic-backup-controller-token-for-tests";

fn app(configured: bool) -> axum::Router {
    let token = configured.then(|| {
        crate::config::Config::from_values(None, Some(TOKEN), None, None, None, false)
            .unwrap()
            .controller_token
            .unwrap()
    });
    let runtime = crate::runtime::ProxyRuntime::new(
        crate::runtime::RuntimeSettings::new(
            std::env::temp_dir().join("backup-boundary-no-state-writes"),
            18_080,
        ),
        None,
    );
    crate::server::app_with_state(crate::server::AppState::new(runtime, token))
}

async fn call(
    app: axum::Router,
    method: &str,
    path: &str,
    body: String,
    authorized: bool,
) -> Response {
    let mut request = Request::builder().method(method).uri(path);
    if authorized {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    app.oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn backups_always_require_configured_explicit_token() {
    for (method, path) in [("GET", "/status"), ("POST", "/start"), ("PUT", "/config")] {
        for (configured, authorized) in [(false, false), (false, true), (true, false)] {
            let response = call(
                app(configured),
                method,
                &format!("/internal/v1/backups{path}"),
                "{}".into(),
                authorized,
            )
            .await;
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        }
    }
}

#[tokio::test]
async fn invalid_backup_commands_never_reach_agent() {
    let start = serde_json::json!({"requestId": ID, "actorId": ID});
    let config = serde_json::json!({"requestId": ID, "actorId": ID, "expectedRevision": 0, "enabled": true, "intervalHours": 24, "retentionCount": 7});
    let mut invalid = vec![
        ("POST", "/start", "{}".into()),
        ("POST", "/start", "x".repeat(2_049)),
    ];
    for id in [
        "",
        "../arbitrary",
        "0198D98A-0000-7000-8000-000000000001",
        "0198d98a000070008000000000000001",
    ] {
        for field in ["requestId", "actorId"] {
            let mut request = start.clone();
            request[field] = id.into();
            invalid.push(("POST", "/start", request.to_string()));
        }
    }
    for (field, value) in [
        ("path", serde_json::json!("/etc")),
        ("actorId", serde_json::json!(null)),
    ] {
        let mut request = start.clone();
        request[field] = value;
        invalid.push(("POST", "/start", request.to_string()));
    }
    for (field, value) in [
        ("intervalHours", 0_i64),
        ("intervalHours", 8_761),
        ("retentionCount", 0),
        ("retentionCount", 51),
        ("expectedRevision", -1),
        ("expectedRevision", 4_294_967_296),
    ] {
        let mut request = config.clone();
        request[field] = value.into();
        invalid.push(("PUT", "/config", request.to_string()));
    }
    let mut request = config;
    request["action"] = "restore".into();
    invalid.push(("PUT", "/config", request.to_string()));
    for (method, path, body) in invalid {
        let response = call(
            app(true),
            method,
            &format!("/internal/v1/backups{path}"),
            body,
            true,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            to_bytes(response.into_body(), 1_024).await.unwrap(),
            r#"{"error":"invalid_input"}"#
        );
    }
}

#[test]
fn backup_config_accepts_inclusive_limits_and_rejects_unknown_fields() {
    for (hours, retention) in [(1, 1), (8_760, 50)] {
        let body = serde_json::json!({"requestId": ID, "actorId": ID, "expectedRevision": u32::MAX, "enabled": false, "intervalHours": hours, "retentionCount": retention});
        let parsed = parse::<Config>(Ok(Bytes::from(body.to_string()))).unwrap();
        assert_eq!(parsed.interval_hours, hours);
        assert_eq!(parsed.retention_count, retention);
    }
}

#[tokio::test]
async fn agent_errors_are_allowlisted_and_sanitized() {
    for (status, code, expected) in [
        (StatusCode::CONFLICT, "busy", StatusCode::CONFLICT),
        (StatusCode::CONFLICT, "conflict", StatusCode::CONFLICT),
        (
            StatusCode::BAD_REQUEST,
            "invalid_input",
            StatusCode::BAD_REQUEST,
        ),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "unavailable",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "/private/path",
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (StatusCode::OK, "busy", StatusCode::SERVICE_UNAVAILABLE),
    ] {
        let response = agent_response(
            status,
            serde_json::json!({"error": code, "detail": "/private/path"}),
        );
        assert_eq!(response.status(), expected);
        let bytes = to_bytes(response.into_body(), 1_024).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private"));
    }
    assert_eq!(
        agent_response(StatusCode::CREATED, serde_json::json!({})).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        agent_response(StatusCode::OK, serde_json::json!([])).status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

async fn raw_response(body: Vec<u8>) -> Result<(StatusCode, serde_json::Value), ()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (client, mut server) = tokio::io::duplex(4_096);
    let task = tokio::spawn(async move {
        let mut request = vec![0; 4_096];
        let count = server.read(&mut request).await.unwrap();
        assert!(
            std::str::from_utf8(&request[..count])
                .unwrap()
                .starts_with("GET /status HTTP/1.1\r\n")
        );
        let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len());
        let _ = server.write_all(head.as_bytes()).await;
        let _ = server.write_all(&body).await;
    });
    let result = exchange(client, "GET", "/status", Vec::new()).await;
    task.await.unwrap();
    result
}

#[tokio::test]
async fn agent_response_body_is_bounded_and_requires_json() {
    assert!(
        raw_response(vec![b'x'; MAX_RESPONSE_BYTES + 1])
            .await
            .is_err()
    );
    assert!(
        raw_response(b"secret internal error".to_vec())
            .await
            .is_err()
    );
    let (status, body) = raw_response(br#"{"jobs":[]}"#.to_vec()).await.unwrap();
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({"jobs": []}));
}

#[cfg(not(unix))]
#[tokio::test]
async fn unsupported_runtime_reports_sanitized_unavailable() {
    let response = call(
        app(true),
        "GET",
        "/internal/v1/backups/status",
        String::new(),
        true,
    )
    .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        to_bytes(response.into_body(), 1_024).await.unwrap(),
        r#"{"error":"unavailable"}"#
    );
}

#[cfg(unix)]
#[tokio::test]
async fn unix_agent_missing_and_stalled_are_unavailable() {
    let root = std::env::temp_dir().join(format!(
        "backup-agent-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let socket = root.join("agent.sock");
    assert_eq!(
        forward_socket(&socket, "GET", "/status", Vec::new())
            .await
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let task = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    let response = forward_socket(&socket, "GET", "/status", Vec::new()).await;
    task.abort();
    let _ = task.await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        to_bytes(response.into_body(), 1_024).await.unwrap(),
        r#"{"error":"unavailable"}"#
    );
    std::fs::remove_file(&socket).unwrap();
    std::fs::remove_dir(&root).unwrap();
}

#[tokio::test]
async fn backup_routes_expose_no_arbitrary_action_endpoint() {
    let response = call(
        app(true),
        "POST",
        "/internal/v1/backups/restore",
        "{}".into(),
        true,
    )
    .await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let response = call(
        app(true),
        "POST",
        "/internal/v1/backups/config",
        "{}".into(),
        true,
    )
    .await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[cfg(unix)]
#[tokio::test]
async fn unix_agent_status_uses_fixed_http_suffix() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let root = std::env::temp_dir().join(format!(
        "backup-agent-success-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let socket = root.join("agent.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4_096];
        let count = stream.read(&mut request).await.unwrap();
        assert!(
            std::str::from_utf8(&request[..count])
                .unwrap()
                .starts_with("GET /status HTTP/1.1\r\n")
        );
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"jobs\":[]}")
            .await
            .unwrap();
    });
    let response = forward_socket(&socket, "GET", "/status", Vec::new()).await;
    task.await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(response.into_body(), 1_024).await.unwrap(),
        r#"{"jobs":[]}"#
    );
    std::fs::remove_file(&socket).unwrap();
    std::fs::remove_dir(&root).unwrap();
}
