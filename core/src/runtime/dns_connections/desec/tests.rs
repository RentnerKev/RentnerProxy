use super::super::{Error, ProviderId, SaveRequest, Store, TestRequest, models::ConnectionStatus};
use crate::runtime::dns::DnsProviderConfig;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Mutex;

const ID: &str = "0198d98a-0000-7000-8000-000000000091";
const USER: &str = "0198d98a-0000-7000-8000-000000000092";
const ZONE: &str = "example.com";
const TOKEN: &str = "desec-isolated-fixture-token";
const FOREIGN: &str = "\"keep-foreign\"";

struct Api {
    discovery_body: Mutex<Vec<u8>>,
    discovery_status: AtomicUsize,
    discovery_link: Mutex<Option<String>>,
    requests: AtomicUsize,
    records: Mutex<BTreeMap<String, Value>>,
    writes: Mutex<Vec<Value>>,
    posts: AtomicUsize,
    inject_foreign: AtomicBool,
    deny_write: AtomicBool,
    fail_cleanup: AtomicBool,
}

struct Fixture {
    store: Store,
    api: Arc<Api>,
    endpoint: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn authenticate(State(api): State<Arc<Api>>, request: Request, next: Next) -> Response {
    assert_eq!(
        request.headers()[header::AUTHORIZATION],
        format!("Token {TOKEN}")
    );
    api.requests.fetch_add(1, Ordering::SeqCst);
    next.run(request).await
}

async fn domains(State(api): State<Arc<Api>>) -> Response {
    let status = StatusCode::from_u16(api.discovery_status.load(Ordering::SeqCst) as u16).unwrap();
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(link) = api.discovery_link.lock().await.as_ref() {
        response = response.header(header::LINK, HeaderValue::from_str(link).unwrap());
    }
    response
        .body(Body::from(api.discovery_body.lock().await.clone()))
        .unwrap()
}

fn rrset(subname: &str, records: Value, ttl: u32) -> Value {
    json!({
        "domain": ZONE, "name": format!("{subname}.{ZONE}."),
        "subname": subname, "type": "TXT", "ttl": ttl, "records": records,
    })
}

async fn read_rrset(
    State(api): State<Arc<Api>>,
    Path((subname, kind)): Path<(String, String)>,
) -> Response {
    assert_eq!(kind, "TXT");
    let mut records = api.records.lock().await;
    if api.inject_foreign.load(Ordering::SeqCst) && subname == "_acme-challenge" {
        records
            .entry(subname.clone())
            .or_insert_with(|| rrset(&subname, json!([FOREIGN]), 7200));
    }
    match records.get(&subname) {
        Some(record) => Json(record.clone()).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn create_rrset(State(api): State<Arc<Api>>, Json(body): Json<Value>) -> Response {
    if api.deny_write.load(Ordering::SeqCst) {
        return StatusCode::FORBIDDEN.into_response();
    }
    assert_eq!(body["type"], "TXT");
    let subname = body["subname"].as_str().unwrap();
    assert!(subname == "_acme-challenge");
    assert_eq!(body["ttl"], 3600);
    let record = rrset(subname, body["records"].clone(), 3600);
    api.records
        .lock()
        .await
        .insert(subname.into(), record.clone());
    api.posts.fetch_add(1, Ordering::SeqCst);
    api.writes.lock().await.push(body);
    (StatusCode::CREATED, Json(record)).into_response()
}

async fn patch_rrset(
    State(api): State<Arc<Api>>,
    Path((subname, kind)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    assert_eq!(kind, "TXT");
    assert!(subname == "_acme-challenge");
    assert!(
        body.get("ttl").is_none(),
        "existing RRset TTL must be preserved"
    );
    if api.deny_write.load(Ordering::SeqCst) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let values = body["records"].as_array().unwrap();
    let cleanup = values.iter().all(|value| value == FOREIGN);
    if cleanup && api.fail_cleanup.load(Ordering::SeqCst) {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let mut records = api.records.lock().await;
    let Some(record) = records.get_mut(&subname) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    record["records"] = body["records"].clone();
    let result = record.clone();
    if values.is_empty() {
        records.remove(&subname);
    }
    api.writes.lock().await.push(body);
    Json(result).into_response()
}

async fn fixture() -> Fixture {
    let api = Arc::new(Api {
        discovery_body: Mutex::new(serde_json::to_vec(&json!([{ "name": ZONE }])).unwrap()),
        discovery_status: AtomicUsize::new(200),
        discovery_link: Mutex::new(None),
        requests: AtomicUsize::new(0),
        records: Mutex::new(BTreeMap::from([(
            "_acme-challenge.keep".into(),
            rrset("_acme-challenge.keep", json!([FOREIGN]), 7200),
        )])),
        writes: Mutex::new(Vec::new()),
        posts: AtomicUsize::new(0),
        inject_foreign: AtomicBool::new(true),
        deny_write: AtomicBool::new(false),
        fail_cleanup: AtomicBool::new(false),
    });
    let router = Router::new()
        .route("/api/v1/domains/", get(domains))
        .route(
            "/api/v1/domains/example.com/",
            get(|| async { Json(json!({ "name": ZONE, "minimum_ttl": 3600 })) }),
        )
        .route(
            "/api/v1/domains/example.com/rrsets/",
            axum::routing::post(create_rrset),
        )
        .route(
            "/api/v1/domains/example.com/rrsets/{subname}/{kind}/",
            get(read_rrset).patch(patch_rrset),
        )
        .layer(middleware::from_fn_with_state(
            Arc::clone(&api),
            authenticate,
        ))
        .with_state(Arc::clone(&api));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let endpoint = format!("http://{address}/api/v1/");
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let store = Store::fixture(super::super::tests::directory(), endpoint.clone());
    Fixture {
        store,
        api,
        endpoint,
        task,
    }
}

fn save_request() -> SaveRequest {
    SaveRequest {
        provider: Some(ProviderId::Desec),
        expected_revision: 0,
        name: "deSEC fixture".into(),
        api_token: Some(TOKEN.into()),
        zone_ids: vec![ZONE.into()],
        actor_user_id: USER.into(),
    }
}

fn saved_test() -> TestRequest {
    TestRequest {
        provider: None,
        connection_id: Some(ID.into()),
        api_token: None,
        zone_ids: None,
    }
}

#[tokio::test]
async fn discovers_canonical_domains_with_token_authentication() {
    let fixture = fixture().await;
    *fixture.api.discovery_body.lock().await = serde_json::to_vec(&json!([
        {"name":ZONE,"unrelated_provider_metadata":"ignored"}, {"name":"xn--bcher-kva.example"}
    ]))
    .unwrap();
    let zones = super::permitted(&fixture.endpoint, TOKEN).await.unwrap();
    assert_eq!(zones.len(), 2);
    assert_eq!(zones[0].id, ZONE);
    assert_eq!(zones[0].name, ZONE);
    assert_eq!(zones[1].id, "xn--bcher-kva.example");
    assert_eq!(fixture.api.requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn rejects_duplicate_and_noncanonical_discovery_names() {
    let fixture = fixture().await;
    for invalid in [
        "Example.com",
        "example.com.",
        "../example.com",
        "example.com/records",
        "example.com?x=y",
        "localhost",
        "127.0.0.1",
        "bücher.example",
        "-bad.example",
        "bad..example",
    ] {
        *fixture.api.discovery_body.lock().await =
            serde_json::to_vec(&json!([{"name":invalid}])).unwrap();
        assert!(
            matches!(
                super::permitted(&fixture.endpoint, TOKEN).await,
                Err(Error::ProviderUnavailable)
            ),
            "accepted {invalid}"
        );
    }
    *fixture.api.discovery_body.lock().await =
        serde_json::to_vec(&json!([{"name":ZONE},{"name":ZONE}])).unwrap();
    assert!(matches!(
        super::permitted(&fixture.endpoint, TOKEN).await,
        Err(Error::ProviderUnavailable)
    ));
}

#[tokio::test]
async fn refuses_next_page_links_without_forwarding_token_to_another_server() {
    let fixture = fixture().await;
    let leaked = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&leaked);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().fallback(move || {
        let observed = Arc::clone(&observed);
        async move {
            observed.fetch_add(1, Ordering::SeqCst);
            StatusCode::OK
        }
    });
    let foreign = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    *fixture.api.discovery_link.lock().await =
        Some(format!("<http://{address}/capture>; rel=\"next\""));
    let result = super::permitted(&fixture.endpoint, TOKEN).await;
    foreign.abort();
    assert!(matches!(result, Err(Error::ZoneLimit)));
    assert_eq!(leaked.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.api.requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn maps_discovery_rate_limits_and_rejected_credentials() {
    let fixture = fixture().await;
    for status in [401, 403, 429, 503] {
        fixture.api.discovery_status.store(status, Ordering::SeqCst);
        let error = super::permitted(&fixture.endpoint, TOKEN)
            .await
            .unwrap_err();
        assert_eq!(
            error,
            match status {
                401 | 403 => Error::ProviderUnauthorized,
                429 => Error::ProviderRateLimited,
                _ => Error::ProviderUnavailable,
            }
        );
    }
}

#[tokio::test]
async fn bounds_discovery_response_bytes_and_domain_count_and_rejects_malformed_json() {
    let fixture = fixture().await;
    for body in [
        b"{not-json".to_vec(),
        br#"{"name":"example.com"}"#.to_vec(),
        br#"[{"name":5}]"#.to_vec(),
        vec![b' '; 512 * 1024 + 1],
    ] {
        *fixture.api.discovery_body.lock().await = body;
        assert!(matches!(
            super::permitted(&fixture.endpoint, TOKEN).await,
            Err(Error::ProviderUnavailable)
        ));
    }
    *fixture.api.discovery_body.lock().await = serde_json::to_vec(
        &(0..501)
            .map(|index| json!({"name":format!("zone{index}.example")}))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(matches!(
        super::permitted(&fixture.endpoint, TOKEN).await,
        Err(Error::ZoneLimit)
    ));
}

#[tokio::test]
async fn save_test_verify_encrypts_token_and_resolves_private_desec_after_restart() {
    let fixture = fixture().await;
    let saved = fixture.store.save(ID.into(), save_request()).await.unwrap();
    assert_eq!(saved.provider, "desec");
    assert_eq!(saved.zones[0].id, ZONE);
    assert_eq!(saved.verification.status, ConnectionStatus::Untested);
    let tested = fixture.store.test(saved_test()).await.unwrap();
    assert_eq!(tested.selected_zone_ids, vec![ZONE]);
    assert!(!tested.dns_write_verified);
    assert!(fixture.api.writes.lock().await.is_empty());
    let verified = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(verified.verification.status, ConnectionStatus::Connected);
    assert!(verified.verified_for(ZONE));
    let writes = fixture.api.writes.lock().await;
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[0]["records"].as_array().unwrap().len(), 2);
    assert!(
        writes[0]["records"]
            .as_array()
            .unwrap()
            .contains(&json!(FOREIGN))
    );
    assert_eq!(writes[1]["records"], json!([FOREIGN]));
    drop(writes);
    let records = fixture.api.records.lock().await;
    assert_eq!(records["_acme-challenge.keep"]["records"], json!([FOREIGN]));
    assert!(
        records
            .values()
            .all(|record| record["records"] == json!([FOREIGN]) && record["ttl"] == 7200)
    );
    drop(records);
    let bytes = super::super::state_dir(&fixture.store.path)
        .unwrap()
        .read_file(super::super::FILE, super::super::MAX_BYTES)
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains(TOKEN));
    let public = serde_json::to_string(&fixture.store.list().await.unwrap()).unwrap();
    for private in [TOKEN, "ciphertext", "nonce", "apiToken"] {
        assert!(!public.contains(private));
    }
    let restarted = Store::fixture(fixture.store.path.clone(), fixture.endpoint.clone());
    let config = restarted
        .resolve_config(&DnsProviderConfig::Connection {
            provider: ProviderId::Desec,
            connection_id: ID.into(),
            zone_id: ZONE.into(),
        })
        .await
        .unwrap();
    match config {
        DnsProviderConfig::Desec { zone_id, api_token } => {
            assert_eq!(zone_id, ZONE);
            assert_eq!(api_token, TOKEN);
        }
        _ => panic!("deSEC connection resolved to another provider"),
    }
    assert_eq!(
        restarted.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Connected
    );
}

#[tokio::test]
async fn permission_check_creates_and_removes_only_its_new_txt_rrset() {
    let fixture = fixture().await;
    fixture.api.inject_foreign.store(false, Ordering::SeqCst);
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    assert_eq!(
        fixture
            .store
            .verify(ID, 1)
            .await
            .unwrap()
            .verification
            .status,
        ConnectionStatus::Connected
    );
    assert_eq!(fixture.api.posts.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.api.records.lock().await.len(), 1);
    assert_eq!(
        fixture.api.records.lock().await["_acme-challenge.keep"]["records"],
        json!([FOREIGN])
    );
}

#[tokio::test]
async fn read_only_token_never_becomes_connected() {
    let fixture = fixture().await;
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    fixture.api.deny_write.store(true, Ordering::SeqCst);
    assert!(
        !fixture
            .store
            .test(saved_test())
            .await
            .unwrap()
            .dns_write_verified
    );
    let verified = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(verified.verification.status, ConnectionStatus::Disconnected);
    assert_eq!(
        verified.verification.error,
        Some(Error::ProviderUnauthorized)
    );
    assert!(verified.verification.zone_ids.is_empty());
    assert!(fixture.api.writes.lock().await.is_empty());
}

#[tokio::test]
async fn wrong_provider_and_malformed_zone_ids_fail_before_network_requests() {
    let fixture = fixture().await;
    for (provider, zone) in [
        (ProviderId::Desec, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        (ProviderId::Cloudflare, ZONE),
        (ProviderId::Desec, "Example.com"),
        (ProviderId::Desec, "example.com/path"),
    ] {
        let mut request = save_request();
        request.provider = Some(provider);
        request.zone_ids = vec![zone.into()];
        assert!(matches!(
            fixture.store.save(ID.into(), request).await,
            Err(Error::InvalidInput)
        ));
        assert!(matches!(
            fixture
                .store
                .test(TestRequest {
                    provider: Some(provider),
                    connection_id: None,
                    api_token: Some(TOKEN.into()),
                    zone_ids: Some(vec![zone.into()])
                })
                .await,
            Err(Error::InvalidInput)
        ));
    }
    assert_eq!(fixture.api.requests.load(Ordering::SeqCst), 0);
    assert!(fixture.store.list().await.unwrap().is_empty());
}

#[tokio::test]
async fn restarting_failed_cleanup_recovers_journal_without_deleting_foreign_values() {
    let fixture = fixture().await;
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    fixture.api.fail_cleanup.store(true, Ordering::SeqCst);
    let failed = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(failed.verification.status, ConnectionStatus::Failed);
    assert!(matches!(
        fixture.store.delete(ID, 1).await,
        Err(Error::ConnectionInUse)
    ));
    assert!(
        fixture
            .api
            .records
            .lock()
            .await
            .values()
            .any(|record| record["records"].as_array().unwrap().len() == 2)
    );
    let restarted = Store::fixture(fixture.store.path.clone(), fixture.endpoint.clone());
    fixture.api.fail_cleanup.store(false, Ordering::SeqCst);
    restarted.recover_permission_checks().await;
    assert!(
        fixture
            .api
            .records
            .lock()
            .await
            .values()
            .all(|record| record["records"] == json!([FOREIGN]))
    );
    assert_ne!(
        restarted.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Connected
    );
    assert_eq!(
        restarted.verify(ID, 1).await.unwrap().verification.status,
        ConnectionStatus::Connected
    );
    restarted.delete(ID, 1).await.unwrap();
}
