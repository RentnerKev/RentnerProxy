mod common;

use common::{Controller, TEST_TOKEN, isolated_command};
use reqwest::StatusCode;
use serde_json::Value;
use std::time::Duration;

#[tokio::test]
async fn controller_binary_preserves_health_authentication_and_safe_validation() {
    let controller = Controller::start();
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if client
            .get(controller.url("/health"))
            .send()
            .await
            .is_ok_and(|response| response.status() == StatusCode::OK)
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "controller readiness deadline"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let health: Value = client
        .get(controller.url("/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["service"], env!("CARGO_PKG_NAME"));
    let ready = client.get(controller.url("/ready")).send().await.unwrap();
    assert_eq!(ready.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(ready.headers()["cache-control"], "no-store");
    for path in [
        "/internal/v1/proxy/status",
        "/internal/v1/certificates",
        "/internal/v1/crowdsec/status",
    ] {
        let response = client.get(controller.url(path)).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    let response = client
        .put(controller.url("/internal/v1/proxy/config"))
        .bearer_auth(TEST_TOKEN)
        .body("invalid-json")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        serde_json::json!({ "error": "invalid_configuration" })
    );
    let status: Value = client
        .get(controller.url("/internal/v1/proxy/status"))
        .bearer_auth(TEST_TOKEN)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["running"], false);
    assert_eq!(status["activeRevision"], Value::Null);
}

#[test]
fn controller_binary_rejects_unprotected_remote_binding_and_unknown_healthchecks() {
    for arguments in [vec![], vec!["--healthcheck", "unknown"]] {
        let result = isolated_command()
            .env("RENTNERPROXY_CONTROLLER_LISTEN_ADDR", "0.0.0.0:0")
            .args(arguments)
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(1));
    }
}
