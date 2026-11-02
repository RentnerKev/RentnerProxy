use super::*;

#[tokio::test]
async fn off_host_backup_fields_are_bounded_before_any_agent_request() {
    let root = Root::new();
    let router = root.router(true);
    let valid = json!({
        "requestId": ACTOR, "actorId": CONNECTION, "expectedRevision": 0,
        "enabled": true, "endpoint": "https://storage.example.test", "region": "eu-test-1",
        "bucket": "backups", "prefix": "daily/", "accessKeyId": "synthetic-key",
        "secretAccessKey": "synthetic-secret", "recoveryKey": "synthetic-recovery-key",
        "recoveryKeySaved": true
    });
    for (field, limit) in [
        ("endpoint", 512),
        ("region", 64),
        ("bucket", 63),
        ("prefix", 256),
        ("accessKeyId", 256),
        ("secretAccessKey", 512),
        ("recoveryKey", 44),
    ] {
        for value in ["x".repeat(limit + 1), "contains\ncontrol".to_owned()] {
            let mut invalid = valid.clone();
            invalid[field] = json!(value);
            assert_eq!(
                json_call(&router, "PUT", "/internal/v1/backups/off-host", invalid).await,
                (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"})),
                "field {field}"
            );
        }
    }
    let mut invalid = valid.clone();
    invalid["expectedRevision"] = json!(9_007_199_254_740_992_u64);
    assert_eq!(
        json_call(&router, "PUT", "/internal/v1/backups/off-host", invalid).await,
        (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"}))
    );
    assert_eq!(
        json_call(
            &router,
            "PUT",
            "/internal/v1/backups/off-host?unexpected=1",
            valid
        )
        .await,
        (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"}))
    );
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
}

#[tokio::test]
async fn dns_permission_verification_authenticates_and_fences_without_provider_io() {
    let root = Root::new();
    seed_connection(&root, false);
    let router = root.initialized_router().await;
    let uri = format!("/internal/v1/dns/connections/{CONNECTION}/verify");
    assert_eq!(
        call(&router, "POST", &uri, "not JSON", false).await.0,
        StatusCode::UNAUTHORIZED
    );
    for invalid in ["not JSON".to_owned(), "x".repeat(32769), "{}".to_owned()] {
        assert_eq!(
            call(&router, "POST", &uri, invalid, true).await,
            (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"}))
        );
    }
    assert_eq!(
        json_call(&router, "POST", &uri, json!({"expectedRevision":2})).await,
        (StatusCode::CONFLICT, json!({"error":"connection_conflict"}))
    );
    assert_eq!(
        json_call(
            &router,
            "POST",
            &format!("/internal/v1/dns/connections/{ACTOR}/verify"),
            json!({"expectedRevision":1})
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            json!({"error":"connection_not_found"})
        )
    );
    let (status, result) = json_call(&router, "POST", &uri, json!({"expectedRevision":1})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["id"], CONNECTION);
    assert_eq!(result["verification"]["status"], "failed");
    assert_eq!(result["verification"]["error"], "credentials_unavailable");
    assert_eq!(result["verification"]["zoneIds"], json!([]));
    assert!(result["verification"]["checkedAt"].is_string());
    for field in ["secret", "ciphertext", "nonce", "apiToken"] {
        assert!(!result.to_string().contains(field));
    }
    let (status, persisted) = call(
        &root.initialized_router().await,
        "GET",
        "/internal/v1/dns/connections",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        persisted["connections"][0]["verification"],
        result["verification"]
    );
}

#[tokio::test]
async fn backup_download_rejects_noncanonical_ids_and_queries_before_connecting() {
    let root = Root::new();
    let router = root.router(true);
    for path in [
        "/internal/v1/backups/invalid/download".to_owned(),
        format!("/internal/v1/backups/{ACTOR}/download?path=private"),
        format!("/internal/v1/backups/{}/download", ACTOR.to_uppercase()),
    ] {
        assert_eq!(
            call(&router, "GET", &path, Body::empty(), true).await,
            (StatusCode::NOT_FOUND, json!({"error":"not_found"}))
        );
    }
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
}

#[tokio::test]
async fn dns_mutations_fail_closed_when_certificate_bindings_are_not_initialized() {
    let root = Root::new();
    let router = root.router(true);
    for (method, uri, body) in [
        (
            "GET",
            "/internal/v1/dns/connections".to_owned(),
            json!(null),
        ),
        (
            "PUT",
            format!("/internal/v1/dns/connections/{CONNECTION}"),
            json!({"expectedRevision":0,"name":"Test","zoneIds":[ZONE],"actorUserId":ACTOR}),
        ),
        (
            "DELETE",
            format!("/internal/v1/dns/connections/{CONNECTION}"),
            json!({"expectedRevision":1}),
        ),
    ] {
        assert_eq!(
            json_call(&router, method, &uri, body).await,
            (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"error":"store_unavailable"})
            )
        );
    }
}
