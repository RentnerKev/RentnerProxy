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
    models::{ProxyConfigRequest, ProxyHost},
    proxy::revision_for_hosts,
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
    }];
    serde_json::to_vec(&ProxyConfigRequest {
        version: 1,
        revision: revision_for_hosts(&hosts),
        proxy_hosts: hosts,
    })
    .unwrap()
}

fn request(uri: &str, body: Vec<u8>) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(uri)
        .body(Body::from(body))
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
