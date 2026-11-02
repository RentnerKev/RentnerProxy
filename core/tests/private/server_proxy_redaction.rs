use super::*;
use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
use serde_json::json;

#[tokio::test]
async fn malformed_authentication_source_fails_closed_without_returning_credentials() {
    let secret = "synthetic-private-password";
    let malformed = [
        json!({"handler":"authentication"}),
        json!({"handler":"authentication", "providers":null}),
        json!({"handler":"authentication", "providers":{}}),
        json!({"handler":"authentication", "providers":{"http_basic":{}}}),
        json!({"handler":"authentication", "providers":{"http_basic":{"accounts":{}}}}),
        json!({"handler":"authentication", "providers":{"http_basic":{"accounts":[null]}}}),
        json!({"handler":"authentication", "providers":{"http_basic":{"accounts":[{"username":secret}]}}}),
        json!({"handler":"authentication", "providers":{"http_basic":{"accounts":[{"password":{"secret":secret}}]}}}),
    ];
    for source in malformed {
        let error = match redacted_config_source(&source.to_string()) {
            Ok(value) => panic!("malformed authentication unexpectedly exposed {value}"),
            Err(error) => error,
        };
        let response = error.into_response();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(body, r#"{"error":"apply_failed"}"#);
    }
    assert!(redacted_config_source("not JSON").is_err());
}

#[test]
fn nested_authentication_source_redacts_all_accounts_and_preserves_other_values() {
    let input = json!({"routes":[{"handler":"authentication","providers":{"http_basic":{
        "accounts":[{"username":"alice","password":"first-secret"},{"username":"bob","password":"second-secret"}]
    }}}, {"handler":"static_response","body":"public content","status_code":200}],"enabled":true});
    let output = match redacted_config_source(&input.to_string()) {
        Ok(value) => value,
        Err(_) => panic!("valid authentication source failed"),
    };
    assert!(!output.contains("first-secret"));
    assert!(!output.contains("second-secret"));
    let mut expected = input;
    for account in expected["routes"][0]["providers"]["http_basic"]["accounts"]
        .as_array_mut()
        .unwrap()
    {
        account["password"] = json!("[redacted]");
    }
    assert_eq!(serde_json::from_str::<Value>(&output).unwrap(), expected);
}

#[tokio::test]
async fn proxy_runtime_errors_have_stable_private_api_statuses() {
    for (error, status, code) in [
        (RuntimeError::Busy, StatusCode::CONFLICT, "busy"),
        (
            RuntimeError::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
            "runtime_unavailable",
        ),
        (
            RuntimeError::ApplyFailed,
            StatusCode::BAD_GATEWAY,
            "apply_failed",
        ),
        (
            RuntimeError::ConfigTooLarge,
            StatusCode::PAYLOAD_TOO_LARGE,
            "invalid_configuration",
        ),
        (
            RuntimeError::HostConfigNotFound,
            StatusCode::NOT_FOUND,
            "not_found",
        ),
    ] {
        let response = runtime_error(error).into_response();
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!({"error":code})
        );
    }
}
