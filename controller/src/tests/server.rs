use std::{
    future::Future,
    path::Path,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use crate::{
    config::{Config, ControllerToken},
    models::{ProxyConfigRequest, ProxyHost, ProxyHttpSettings},
    proxy::{revision_for_configuration, revision_for_hosts},
    runtime::{EngineFuture, ProxyEngine, ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state, auth::constant_time_equal},
};

fn app() -> Router {
    let state_dir = std::env::temp_dir().join("rentnerproxy-controller-http-test");
    let runtime = ProxyRuntime::new(RuntimeSettings::new(state_dir, 8_080), None);
    app_with_state(AppState::new(runtime, None))
}

struct TestEngine(AtomicBool);

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

impl ProxyEngine for TestEngine {
    fn test_config<'a>(&'a self, _: &'a Path) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn start<'a>(&'a self, _: &'a Path, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.0.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
    fn reload<'a>(&'a self, _: &'a Path, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn shutdown<'a>(&'a self) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move { self.0.load(Ordering::SeqCst) })
    }
}

async fn test_app(token: Option<ControllerToken>) -> Router {
    let unique = format!(
        "server-{}-{}",
        std::process::id(),
        TEST_COUNTER.fetch_add(1, Ordering::SeqCst)
    );
    let mut settings = RuntimeSettings::new(std::env::temp_dir().join(unique), 18_080);
    settings.stage_timeout = Duration::from_millis(100);
    let runtime = ProxyRuntime::new(settings, Some(Arc::new(TestEngine(AtomicBool::new(false)))));
    runtime.initialize().await;
    app_with_state(AppState::new(runtime, token))
}

fn valid_payload() -> Vec<u8> {
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: 4_000,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
        certificate_id: None,
        force_https: false,
    }];
    serde_json::to_vec(&ProxyConfigRequest {
        version: 1,
        revision: revision_for_hosts(&hosts),
        proxy_hosts: hosts,
        http_settings: ProxyHttpSettings::default(),
    })
    .unwrap()
}

fn request(uri: &str, body: Vec<u8>) -> Request<Body> {
    request_with_method("PUT", uri, Body::from(body))
}

fn request_with_method(method: &str, uri: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .body(body)
        .unwrap()
}

fn custom_payload() -> Vec<u8> {
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: 4_000,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
        certificate_id: None,
        force_https: false,
    }];
    let http_settings = ProxyHttpSettings {
        client_max_body_size_bytes: Some(10_485_760),
        proxy_connect_timeout_seconds: Some(15),
        proxy_read_timeout_seconds: Some(300),
        proxy_send_timeout_seconds: Some(300),
        send_timeout_seconds: Some(30),
        keepalive_timeout_seconds: Some(75),
    };
    serde_json::to_vec(&ProxyConfigRequest {
        version: 2,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    })
    .unwrap()
}

#[tokio::test]
async fn health_payload_is_stable_and_public() {
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let expected = format!(
        r#"{{"status":"ok","service":"{}","version":"{}"}}"#,
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(body.as_ref(), expected.as_bytes());
}

#[tokio::test]
async fn proxy_endpoints_require_configured_authentication() {
    let token = Config::from_values(
        None,
        Some("0123456789abcdef0123456789abcdef"),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let response = test_app(Some(token))
        .await
        .oneshot(request("/internal/v1/proxy/config", valid_payload()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn source_endpoints_are_authenticated_and_preview_is_pure() {
    let token = Config::from_values(
        None,
        Some("0123456789abcdef0123456789abcdef"),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let protected = test_app(Some(token)).await;
    for request in [
        request_with_method("GET", "/internal/v1/proxy/config", Body::empty()),
        request_with_method(
            "POST",
            "/internal/v1/proxy/config/preview",
            Body::from(valid_payload()),
        ),
    ] {
        let response = protected.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let router = test_app(None).await;
    let preview = router
        .clone()
        .oneshot(request_with_method(
            "POST",
            "/internal/v1/proxy/config/preview",
            Body::from(custom_payload()),
        ))
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    assert_eq!(preview.headers().get("cache-control").unwrap(), "no-store");
    let preview: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(preview.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        preview["config"]
            .as_str()
            .unwrap()
            .contains("managed HTTP settings")
    );
    let revision = preview["revision"].as_str().unwrap().to_owned();

    let before_apply = router
        .clone()
        .oneshot(request_with_method(
            "GET",
            "/internal/v1/proxy/config",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(before_apply.status(), StatusCode::OK);
    assert_eq!(
        before_apply.headers().get("cache-control").unwrap(),
        "no-store"
    );
    let before_apply: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(before_apply.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(before_apply["activeRevision"], serde_json::Value::Null);
    assert!(
        !before_apply["config"]
            .as_str()
            .unwrap()
            .contains("managed HTTP settings")
    );

    let applied = router
        .clone()
        .oneshot(request("/internal/v1/proxy/config", custom_payload()))
        .await
        .unwrap();
    assert_eq!(applied.status(), StatusCode::OK);
    let active = router
        .oneshot(request_with_method(
            "GET",
            "/internal/v1/proxy/config",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(active.status(), StatusCode::OK);
    assert_eq!(active.headers().get("cache-control").unwrap(), "no-store");
    let active: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(active.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(active["activeRevision"], revision);
    assert!(
        active["config"]
            .as_str()
            .unwrap()
            .contains("keepalive_timeout 75s;")
    );
}

#[tokio::test]
async fn apply_validates_hash_and_reports_safe_statuses() {
    let router = test_app(None).await;
    let response = router
        .clone()
        .oneshot(request("/internal/v1/proxy/config", valid_payload()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(
        std::str::from_utf8(&body)
            .unwrap()
            .contains("\"status\":\"applied\"")
    );

    let mut spoofed: serde_json::Value = serde_json::from_slice(&valid_payload()).unwrap();
    spoofed["proxyHosts"][0]["forwardPort"] = serde_json::json!(4_001);
    let response = router
        .oneshot(request(
            "/internal/v1/proxy/config",
            serde_json::to_vec(&spoofed).unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn status_is_private_and_does_not_expose_configuration() {
    let router = test_app(None).await;
    let response = router
        .oneshot(
            Request::builder()
                .uri("/internal/v1/proxy/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(!std::str::from_utf8(&body).unwrap().contains("backend"));
}

#[tokio::test]
async fn oversized_proxy_configuration_returns_a_safe_bounded_error() {
    let response = test_app(None)
        .await
        .oneshot(request(
            "/internal/v1/proxy/config",
            vec![b'x'; 16 * 1024 * 1024 + 1],
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(body.as_ref(), br#"{"error":"invalid_configuration"}"#);
}

#[test]
fn constant_time_comparison_checks_equal_and_unequal_values() {
    assert!(constant_time_equal(b"abc", b"abc"));
    assert!(!constant_time_equal(b"abc", b"abd"));
    assert!(!constant_time_equal(b"abc", b"abcd"));
}

#[tokio::test]
async fn host_source_endpoints_are_authenticated_bounded_and_apply_scoped() {
    let token = Config::from_values(
        None,
        Some("0123456789abcdef0123456789abcdef"),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let protected = test_app(Some(token)).await;
    for request in [
        request_with_method(
            "GET",
            "/internal/v1/proxy/hosts/00000000-0000-0000-0000-000000000000/config",
            Body::empty(),
        ),
        request_with_method(
            "POST",
            "/internal/v1/proxy/hosts/00000000-0000-0000-0000-000000000000/config/preview",
            Body::from(valid_payload()),
        ),
    ] {
        let response = protected.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let router = test_app(None).await;
    let host_path = "/internal/v1/proxy/hosts/00000000-0000-0000-0000-000000000000/config";
    let before_apply = router
        .clone()
        .oneshot(request_with_method("GET", host_path, Body::empty()))
        .await
        .unwrap();
    assert_eq!(before_apply.status(), StatusCode::NOT_FOUND);

    let preview = router
        .clone()
        .oneshot(request_with_method(
            "POST",
            "/internal/v1/proxy/hosts/00000000-0000-0000-0000-000000000000/config/preview",
            Body::from(valid_payload()),
        ))
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    assert_eq!(preview.headers().get("cache-control").unwrap(), "no-store");
    let preview: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(preview.into_body(), 512 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(
        preview["config"]
            .as_str()
            .unwrap()
            .starts_with("server {\n")
    );
    assert!(
        preview["config"]
            .as_str()
            .unwrap()
            .contains("host HTTP settings begin")
    );
    assert!(!preview["config"].as_str().unwrap().contains("\nhttp {\n"));
    let revision = preview["revision"].as_str().unwrap().to_owned();

    let bad_snapshot = router
        .clone()
        .oneshot(request_with_method(
            "POST",
            "/internal/v1/proxy/hosts/10000000-0000-0000-0000-000000000000/config/preview",
            Body::from(valid_payload()),
        ))
        .await
        .unwrap();
    assert_eq!(bad_snapshot.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let applied = router
        .clone()
        .oneshot(request("/internal/v1/proxy/config", valid_payload()))
        .await
        .unwrap();
    assert_eq!(applied.status(), StatusCode::OK);
    let active = router
        .clone()
        .oneshot(request_with_method("GET", host_path, Body::empty()))
        .await
        .unwrap();
    assert_eq!(active.status(), StatusCode::OK);
    assert_eq!(active.headers().get("cache-control").unwrap(), "no-store");
    let active: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(active.into_body(), 512 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(active["activeRevision"], revision);
    assert!(
        active["config"]
            .as_str()
            .unwrap()
            .starts_with("    server {\n")
    );
    assert!(
        !active["config"]
            .as_str()
            .unwrap()
            .contains("host HTTP settings begin")
    );

    let unknown = router
        .oneshot(request_with_method(
            "GET",
            "/internal/v1/proxy/hosts/10000000-0000-0000-0000-000000000000/config",
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
}

const CERTIFICATE_ENDPOINTS: [(&str, &str); 6] = [
    ("GET", "/internal/v1/certificates"),
    (
        "GET",
        "/internal/v1/certificates/0198d98a-0000-7000-8000-000000000001",
    ),
    (
        "DELETE",
        "/internal/v1/certificates/0198d98a-0000-7000-8000-000000000001",
    ),
    (
        "POST",
        "/internal/v1/certificates/0198d98a-0000-7000-8000-000000000001/import",
    ),
    (
        "POST",
        "/internal/v1/certificates/0198d98a-0000-7000-8000-000000000001/issue",
    ),
    (
        "POST",
        "/internal/v1/certificates/0198d98a-0000-7000-8000-000000000001/renew",
    ),
];

#[tokio::test]
async fn certificate_endpoints_require_a_configured_token_even_on_loopback() {
    let router = test_app(None).await;
    for (method, path) in CERTIFICATE_ENDPOINTS {
        for authorization in [None, Some("Bearer unconfigured-local-token")] {
            let mut request = Request::builder().method(method).uri(path);
            if let Some(value) = authorization {
                request = request.header("authorization", value);
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {path}"
            );
        }
    }
    for path in ["/health", "/internal/v1/proxy/status"] {
        let response = router
            .clone()
            .oneshot(request_with_method("GET", path, Body::empty()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn certificate_endpoints_reject_missing_or_wrong_tokens_and_accept_the_configured_token() {
    let token_text = "0123456789abcdef0123456789abcdef";
    let token = Config::from_values(None, Some(token_text), None, None, None, false)
        .unwrap()
        .controller_token
        .unwrap();
    let router = test_app(Some(token)).await;
    for (method, path) in CERTIFICATE_ENDPOINTS {
        for authorization in [None, Some("Bearer incorrect-controller-token")] {
            let mut request = Request::builder().method(method).uri(path);
            if let Some(value) = authorization {
                request = request.header("authorization", value);
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {path}"
            );
        }
    }
    let response = router
        .oneshot(
            Request::builder()
                .uri("/internal/v1/certificates")
                .header("authorization", format!("Bearer {token_text}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 4_096)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body, serde_json::json!({"certificates": []}));
}
