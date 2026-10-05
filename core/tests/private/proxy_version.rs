use crate::{
    config::Config,
    runtime::{EngineFuture, ProxyEngine, ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tower::ServiceExt;

struct VersionEngine {
    calls: AtomicUsize,
    value: Option<String>,
    started: tokio::sync::Notify,
    release: tokio::sync::Notify,
    block: bool,
}

impl ProxyEngine for VersionEngine {
    fn start<'a>(&'a self, _: &'a str, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn load<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn probe<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn shutdown(&self) -> EngineFuture<'_> {
        Box::pin(async { Ok(()) })
    }
    fn is_running(&self) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async { false })
    }
    fn version(&self) -> Pin<Box<dyn Future<Output = Option<String>> + Send + '_>> {
        Box::pin(async {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.started.notify_one();
            if self.block {
                self.release.notified().await;
            }
            self.value.clone()
        })
    }
}

fn engine(value: Option<&str>, block: bool) -> Arc<VersionEngine> {
    Arc::new(VersionEngine {
        calls: AtomicUsize::new(0),
        value: value.map(str::to_owned),
        started: tokio::sync::Notify::new(),
        release: tokio::sync::Notify::new(),
        block,
    })
}

fn runtime(engine: Option<Arc<dyn ProxyEngine>>) -> Arc<ProxyRuntime> {
    ProxyRuntime::new(
        RuntimeSettings::new(std::env::temp_dir().join("rp-version-http-unused"), 8080),
        engine,
    )
}

#[tokio::test]
async fn proxy_version_is_authenticated_no_store_and_does_not_read_engine_on_denial() {
    let engine = engine(Some("2.10.0"), false);
    let token_text = "a".repeat(32);
    let token = Config::from_values(None, Some(&token_text), None, None, None, false)
        .unwrap()
        .controller_token;
    let router = app_with_state(AppState::new(runtime(Some(engine.clone())), token));
    for authorization in [None, Some("Bearer incorrect-token")] {
        let mut request = Request::builder().uri("/internal/v1/proxy/version");
        if let Some(value) = authorization {
            request = request.header("authorization", value);
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(engine.calls.load(Ordering::SeqCst), 0);
    for _ in 0..2 {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/internal/v1/proxy/version")
                    .header("authorization", format!("Bearer {token_text}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"version":"2.10.0"})
        );
    }
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn proxy_version_unavailable_is_null_and_negative_result_is_cached() {
    let engine = engine(None, false);
    let router = app_with_state(AppState::new(runtime(Some(engine.clone())), None));
    for _ in 0..2 {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/internal/v1/proxy/version")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"version":null})
        );
    }
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    assert_eq!(runtime(None).version().await, None);
}

#[tokio::test]
async fn proxy_version_concurrent_requests_are_bounded_and_status_remains_independent() {
    let engine = engine(Some("2.10.0"), true);
    let runtime = runtime(Some(engine.clone()));
    let first = tokio::spawn({
        let runtime = runtime.clone();
        async move { runtime.version().await }
    });
    tokio::time::timeout(Duration::from_secs(1), engine.started.notified())
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_millis(100), runtime.version())
            .await
            .unwrap(),
        None
    );
    tokio::time::timeout(Duration::from_millis(100), runtime.status())
        .await
        .unwrap();
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
    engine.release.notify_one();
    assert_eq!(first.await.unwrap().as_deref(), Some("2.10.0"));
    assert_eq!(runtime.version().await.as_deref(), Some("2.10.0"));
    assert_eq!(engine.calls.load(Ordering::SeqCst), 1);
}
