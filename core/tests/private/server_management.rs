use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::{
    config::Config,
    runtime::{ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state},
};

const TOKEN: &str = "synthetic-management-controller-token-for-router-tests";
const ACTOR: &str = "0198d98a-0000-7000-8000-000000000001";
const CONNECTION: &str = "0198d98a-0000-7000-8000-000000000002";
const ZONE: &str = "0123456789abcdef0123456789abcdef";
static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

struct Root(PathBuf);

impl Root {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "rentner-management-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn router(&self, authenticated: bool) -> Router {
        let token = authenticated.then(|| {
            Config::from_values(None, Some(TOKEN), None, None, None, false)
                .unwrap()
                .controller_token
                .unwrap()
        });
        let runtime = ProxyRuntime::new(RuntimeSettings::new(self.0.clone(), 18_080), None);
        app_with_state(AppState::new(runtime, token))
    }
}

impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn call(
    router: &Router,
    method: &str,
    uri: &str,
    body: impl Into<Body>,
    authorized: bool,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(uri);
    if authorized {
        request = request.header("authorization", format!("Bearer {TOKEN}"));
    }
    let response = router
        .clone()
        .oneshot(request.body(body.into()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    if status != StatusCode::UNAUTHORIZED && !uri.contains("/crowdsec/") {
        assert_eq!(
            response.headers()["cache-control"],
            "no-store",
            "{method} {uri}"
        );
    }
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value = serde_json::from_slice(&bytes).expect("management response is JSON");
    (status, value)
}

async fn json_call(router: &Router, method: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    // These byte-oriented endpoints deliberately accept JSON without a content-type header.
    call(
        router,
        method,
        uri,
        serde_json::to_vec(&body).unwrap(),
        true,
    )
    .await
}

fn action(revision: u32) -> Value {
    json!({"actorUserId":ACTOR,"expectedRevision":revision})
}

#[tokio::test]
async fn management_routes_authenticate_before_parsing_or_reading_state() {
    let root = Root::new();
    let routes = [
        ("GET", "/internal/v1/crowdsec/status"),
        ("PUT", "/internal/v1/crowdsec/config"),
        ("POST", "/internal/v1/crowdsec/test"),
        ("POST", "/internal/v1/crowdsec/console/enroll"),
        ("GET", "/internal/v1/dns/connections"),
        ("PUT", "/internal/v1/dns/connections/invalid"),
        ("DELETE", "/internal/v1/dns/connections/invalid"),
        ("POST", "/internal/v1/dns/connections/test"),
        ("POST", "/internal/v1/dns/connections/references/validate"),
        ("GET", "/internal/v1/discovery/docker/status"),
        ("PUT", "/internal/v1/discovery/docker/config"),
        ("POST", "/internal/v1/discovery/docker/inspect"),
        ("GET", "/internal/v1/ddns/config"),
        ("GET", "/internal/v1/ddns/status"),
        ("GET", "/internal/v1/ddns/events?limit=invalid"),
        ("PUT", "/internal/v1/ddns/config"),
        ("POST", "/internal/v1/ddns/preview"),
        ("POST", "/internal/v1/ddns/sync"),
        ("POST", "/internal/v1/ddns/enable"),
        ("POST", "/internal/v1/ddns/disable"),
    ];
    let router = root.router(true);
    for (method, uri) in routes {
        assert_eq!(
            call(&router, method, uri, "not JSON", false).await,
            (StatusCode::UNAUTHORIZED, json!({"error":"unauthorized"})),
            "{method} {uri}"
        );
    }
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
    // Credential-bearing management groups also require configured controller auth.
    let anonymous = root.router(false);
    for uri in [
        "/internal/v1/dns/connections",
        "/internal/v1/ddns/status",
        "/internal/v1/discovery/docker/status",
    ] {
        assert_eq!(
            call(&anonymous, "GET", uri, Body::empty(), true).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
}

#[tokio::test]
async fn management_mutations_reject_malformed_and_oversized_bodies() {
    let root = Root::new();
    let router = root.router(true);
    let routes = [
        (
            "PUT",
            "/internal/v1/crowdsec/config",
            8192,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_crowdsec_configuration",
        ),
        (
            "POST",
            "/internal/v1/crowdsec/test",
            8192,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_crowdsec_configuration",
        ),
        (
            "POST",
            "/internal/v1/crowdsec/console/enroll",
            1024,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_crowdsec_configuration",
        ),
        (
            "PUT",
            "/internal/v1/dns/connections/invalid",
            32768,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "DELETE",
            "/internal/v1/dns/connections/invalid",
            32768,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/dns/connections/test",
            32768,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/dns/connections/references/validate",
            32768,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "PUT",
            "/internal/v1/discovery/docker/config",
            4096,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/discovery/docker/inspect",
            4096,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_input",
        ),
        (
            "PUT",
            "/internal/v1/ddns/config",
            131072,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/ddns/preview",
            131072,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/ddns/sync",
            131072,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/ddns/enable",
            131072,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
        (
            "POST",
            "/internal/v1/ddns/disable",
            131072,
            StatusCode::BAD_REQUEST,
            "invalid_input",
        ),
    ];
    for (method, uri, limit, status, error) in routes {
        for body in [b"{".to_vec(), b"null".to_vec()] {
            assert_eq!(
                call(&router, method, uri, body, true).await,
                (status, json!({"error":error})),
                "{method} {uri}"
            );
        }
        let (oversize_status, oversize_body) =
            call(&router, method, uri, vec![b' '; limit + 1], true).await;
        if uri.contains("/crowdsec/") {
            assert_eq!(
                (oversize_status, oversize_body),
                (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    json!({"error":"invalid_configuration"})
                )
            );
        } else {
            assert_eq!(
                (oversize_status, oversize_body),
                (status, json!({"error":error})),
                "{method} {uri}"
            );
        }
    }
    assert_eq!(std::fs::read_dir(&root.0).unwrap().count(), 0);
}

#[tokio::test]
async fn crowdsec_disabled_and_uninitialized_contracts_are_explicit() {
    let root = Root::new();
    let router = root.router(true);
    let (status, body) = call(
        &router,
        "GET",
        "/internal/v1/crowdsec/status",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["mode"], "disabled");
    assert_eq!(body["credentialConfigured"], false);
    assert_eq!(body["enforcementActive"], false);
    assert!(body.get("apiKey").is_none());
    assert_eq!(
        json_call(
            &router,
            "PUT",
            "/internal/v1/crowdsec/config",
            json!({"mode":"disabled"})
        )
        .await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":"runtime_unavailable"})
        )
    );
    for body in [
        json!({"mode":"disabled"}),
        json!({"mode":"external","apiUrl":"file:///tmp/invalid","apiKey":"synthetic-key"}),
    ] {
        assert_eq!(
            json_call(&router, "POST", "/internal/v1/crowdsec/test", body).await,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error":"invalid_crowdsec_configuration"})
            )
        );
    }
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/crowdsec/console/enroll",
            json!({"enrollmentKey":"synthetic-enrollment-key"})
        )
        .await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"error":"invalid_crowdsec_configuration"})
        )
    );
    for query in [
        "unknown=1".to_owned(),
        "limit=0".to_owned(),
        "offset=1&include_all=true".to_owned(),
        format!("search={}", "a".repeat(2050)),
    ] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/internal/v1/crowdsec/dashboard?{query}"),
                Body::empty(),
                true
            )
            .await,
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({"error":"validation_failed"})
            )
        );
    }
}

fn docker_save(revision: u32, enabled: bool) -> Value {
    json!({"expectedRevision":revision,"actorUserId":ACTOR,"configuration":{"enabled":enabled,"endpoint":null},"acknowledgeRestore":false})
}

#[tokio::test]
async fn docker_configuration_persists_and_rejects_stale_or_invalid_writes() {
    let root = Root::new();
    let router = root.router(true);
    let (status, initial) = call(
        &router,
        "GET",
        "/internal/v1/discovery/docker/status",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["status"], "disabled");
    assert_eq!(initial["configuration"]["revision"], 0);
    let (status, saved) = json_call(
        &router,
        "PUT",
        "/internal/v1/discovery/docker/config",
        docker_save(0, false),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["configuration"]["revision"], 1);
    assert_eq!(saved["status"], "disabled");
    assert_eq!(saved["candidates"], json!([]));
    assert_eq!(
        json_call(
            &router,
            "PUT",
            "/internal/v1/discovery/docker/config",
            docker_save(0, false)
        )
        .await,
        (StatusCode::CONFLICT, json!({"error":"conflict"}))
    );
    assert_eq!(
        json_call(
            &router,
            "PUT",
            "/internal/v1/discovery/docker/config",
            docker_save(1, true)
        )
        .await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"error":"invalid_input"})
        )
    );
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/discovery/docker/inspect",
            json!({"actorUserId":ACTOR,"endpoint":"file:///tmp/docker.sock"})
        )
        .await,
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"error":"invalid_input"})
        )
    );
    let fresh_router = root.router(true);
    let (_, reloaded) = call(
        &fresh_router,
        "GET",
        "/internal/v1/discovery/docker/status",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(reloaded, saved);
    let persisted: Value =
        serde_json::from_slice(&std::fs::read(root.0.join("docker-discovery.json")).unwrap())
            .unwrap();
    assert_eq!(persisted, saved["configuration"]);
}

#[tokio::test]
async fn docker_restored_configuration_requires_explicit_acknowledgement() {
    let root = Root::new();
    std::fs::write(root.0.join("docker-discovery-restore-paused"), b"paused").unwrap();
    let router = root.router(true);
    let (_, initial) = call(
        &router,
        "GET",
        "/internal/v1/discovery/docker/status",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(initial["status"], "paused");
    let mut save = docker_save(0, true);
    save["configuration"]["endpoint"] = json!("http://127.0.0.1:9/");
    assert_eq!(
        json_call(
            &router,
            "PUT",
            "/internal/v1/discovery/docker/config",
            save.clone()
        )
        .await,
        (StatusCode::CONFLICT, json!({"error":"conflict"}))
    );
    assert!(root.0.join("docker-discovery-restore-paused").exists());
    save["acknowledgeRestore"] = json!(true);
    let (status, accepted) =
        json_call(&router, "PUT", "/internal/v1/discovery/docker/config", save).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(accepted["configuration"]["revision"], 1);
    assert_eq!(accepted["configuration"]["settings"]["enabled"], true);
    assert_eq!(accepted["status"], "connecting");
    assert!(!root.0.join("docker-discovery-restore-paused").exists());
}

#[tokio::test]
async fn management_reports_corrupt_stores_without_returning_their_contents() {
    for (file, routes) in [
        (
            "docker-discovery.json",
            vec!["/internal/v1/discovery/docker/status"],
        ),
        ("dns-connections.json", vec!["/internal/v1/dns/connections"]),
        (
            "ddns-automation.json",
            vec!["/internal/v1/ddns/status", "/internal/v1/ddns/events"],
        ),
    ] {
        let root = Root::new();
        std::fs::write(root.0.join(file), b"corrupt-synthetic-private-store").unwrap();
        let router = root.router(true);
        for route in routes {
            assert_eq!(
                call(&router, "GET", route, Body::empty(), true).await,
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    json!({"error":"store_unavailable"})
                ),
                "{route}"
            );
        }
    }
}

#[tokio::test]
async fn ddns_configuration_events_and_disabled_actions_survive_reload() {
    let root = Root::new();
    let router = root.router(true);
    let (status, initial) = call(
        &router,
        "GET",
        "/internal/v1/ddns/config",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(initial["configuration"].is_null());
    for endpoint in ["enable", "disable", "sync"] {
        assert_eq!(
            json_call(
                &router,
                "POST",
                &format!("/internal/v1/ddns/{endpoint}"),
                action(0)
            )
            .await,
            (StatusCode::CONFLICT, json!({"error":"disabled"}))
        );
    }
    let save = json!({"expectedRevision":0,"actorUserId":ACTOR,"configuration":{"enabled":false,"intervalSeconds":300,"ipv4":true,"ipv6":false,"targets":[]}});
    let (status, saved) = json_call(&router, "PUT", "/internal/v1/ddns/config", save.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["configuration"]["revision"], 1);
    assert_eq!(saved["configuration"]["settings"]["enabled"], false);
    assert_eq!(
        json_call(&router, "PUT", "/internal/v1/ddns/config", save).await,
        (StatusCode::CONFLICT, json!({"error":"conflict"}))
    );
    assert_eq!(
        json_call(&router, "POST", "/internal/v1/ddns/sync", action(1)).await,
        (StatusCode::CONFLICT, json!({"error":"disabled"}))
    );
    let (status, disabled) =
        json_call(&router, "POST", "/internal/v1/ddns/disable", action(1)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(disabled["configuration"]["revision"], 2);
    let (status, events) = call(
        &router,
        "GET",
        "/internal/v1/ddns/events?after=1&limit=1",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(events["events"].as_array().unwrap().len(), 1);
    assert_eq!(events["events"][0]["sequence"], 2);
    assert_eq!(events["events"][0]["outcome"], "disabled");
    assert_eq!(events["latestSequence"], 2);
    assert_eq!(events["truncated"], false);
    for query in ["limit=0", "limit=65", "after=-1", "unknown=true"] {
        assert_eq!(
            call(
                &router,
                "GET",
                &format!("/internal/v1/ddns/events?{query}"),
                Body::empty(),
                true
            )
            .await,
            (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"}))
        );
    }
    let (_, reloaded) = call(
        &root.router(true),
        "GET",
        "/internal/v1/ddns/status",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(reloaded["configuration"], disabled["configuration"]);
    assert_eq!(reloaded["events"], disabled["events"]);
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/ddns/preview",
            json!({"actorUserId":ACTOR,"ipv4":true,"ipv6":false,"targets":[]})
        )
        .await,
        (StatusCode::BAD_REQUEST, json!({"error":"invalid_input"}))
    );
}

fn seed_connection(root: &Root, in_use: bool) {
    let references = if in_use {
        json!([{"zoneId":ZONE,"consumer":{"type":"dns01","id":ACTOR}}])
    } else {
        json!([])
    };
    // A structurally valid persisted envelope is sufficient for metadata/deletion paths.
    // Deliberately invalid authentication bytes exercise fail-closed reference validation.
    let registry = json!({"version":1,"connections":[{"metadata":{
        "id":CONNECTION,"provider":"cloudflare","ownership":"instance","name":"Test DNS",
        "createdByUserId":ACTOR,"revision":1,"zones":[{"id":ZONE,"name":"example.test"}],
        "references":references,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"
    },"secret":{"version":1,"nonce":vec![0;12],"ciphertext":vec![7;32]}}]});
    std::fs::write(
        root.0.join("dns-connections.json"),
        serde_json::to_vec(&registry).unwrap(),
    )
    .unwrap();
}

#[tokio::test]
async fn dns_metadata_redacts_credentials_and_deletion_persists() {
    let root = Root::new();
    seed_connection(&root, false);
    let router = root.router(true);
    let (status, list) = call(
        &router,
        "GET",
        "/internal/v1/dns/connections",
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["connections"].as_array().unwrap().len(), 1);
    assert_eq!(list["connections"][0]["id"], CONNECTION);
    assert_eq!(list["connections"][0]["zones"][0]["name"], "example.test");
    for secret_field in ["secret", "apiToken", "ciphertext", "nonce"] {
        assert!(!list.to_string().contains(secret_field));
    }
    let uri = format!("/internal/v1/dns/connections/{CONNECTION}");
    assert_eq!(
        json_call(&router, "DELETE", &uri, json!({"expectedRevision":2})).await,
        (StatusCode::CONFLICT, json!({"error":"connection_conflict"}))
    );
    assert_eq!(
        json_call(&router, "DELETE", &uri, json!({"expectedRevision":1})).await,
        (StatusCode::OK, json!({"deleted":true}))
    );
    assert_eq!(
        call(
            &root.router(true),
            "GET",
            "/internal/v1/dns/connections",
            Body::empty(),
            true
        )
        .await,
        (StatusCode::OK, json!({"connections":[]}))
    );
    assert_eq!(
        json_call(&router, "DELETE", &uri, json!({"expectedRevision":1})).await,
        (
            StatusCode::NOT_FOUND,
            json!({"error":"connection_not_found"})
        )
    );
}

#[tokio::test]
async fn dns_reference_conflicts_and_missing_credentials_fail_closed() {
    let root = Root::new();
    seed_connection(&root, true);
    let router = root.router(true);
    let uri = format!("/internal/v1/dns/connections/{CONNECTION}");
    assert_eq!(
        json_call(&router, "DELETE", &uri, json!({"expectedRevision":1})).await,
        (StatusCode::CONFLICT, json!({"error":"connection_in_use"}))
    );
    let reference =
        json!({"connectionId":CONNECTION,"zoneId":ZONE,"consumer":{"type":"dns01","id":ACTOR}});
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/dns/connections/references/validate",
            reference.clone()
        )
        .await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":"credentials_unavailable"})
        )
    );
    let mut wrong_zone = reference.clone();
    wrong_zone["zoneId"] = json!("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/dns/connections/references/validate",
            wrong_zone
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            json!({"error":"zone_not_permitted"})
        )
    );
    let mut missing = reference;
    missing["connectionId"] = json!(ACTOR);
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/dns/connections/references/validate",
            missing
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            json!({"error":"connection_not_found"})
        )
    );
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/dns/connections/test",
            json!({})
        )
        .await,
        (StatusCode::BAD_REQUEST, json!({"error":"token_required"}))
    );
    assert_eq!(
        json_call(
            &router,
            "POST",
            "/internal/v1/dns/connections/test",
            json!({"connectionId":ACTOR})
        )
        .await,
        (
            StatusCode::NOT_FOUND,
            json!({"error":"connection_not_found"})
        )
    );
    assert_eq!(
        json_call(
            &router,
            "PUT",
            &format!("/internal/v1/dns/connections/{ACTOR}"),
            json!({"expectedRevision":0,"name":"New DNS","zoneIds":[ZONE],"actorUserId":ACTOR})
        )
        .await,
        (StatusCode::BAD_REQUEST, json!({"error":"token_required"}))
    );
}
