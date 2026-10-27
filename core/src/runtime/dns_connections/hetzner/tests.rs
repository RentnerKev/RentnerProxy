use super::super::{Error, ProviderId, SaveRequest, Store, TestRequest, models::ConnectionStatus};
use crate::runtime::dns::DnsProviderConfig;
use axum::{
    Json, Router,
    body::to_bytes,
    extract::{Request, State},
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
use tokio::sync::Mutex;

const ID: &str = "0198d98a-0000-7000-8000-000000000091";
const USER: &str = "0198d98a-0000-7000-8000-000000000092";
const ZONE: &str = "42";
const TOKEN: &str = "hetzner-isolated-fixture-token";

struct Api {
    pages: BTreeMap<u32, Value>,
    requests: Vec<(Method, String)>,
    records: BTreeMap<String, Value>,
    writes: Vec<(String, Value)>,
    deny_write: bool,
}

struct Fixture {
    store: Store,
    api: Arc<Mutex<Api>>,
    endpoint: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn zone(id: u64, name: &str, mode: &str) -> Value {
    json!({"id":id,"name":name,"mode":mode,"ttl":3600})
}

fn page(number: u32, next: Option<u32>, zones: Value) -> Value {
    json!({"zones":zones,"meta":{"pagination":{"page":number,"per_page":50,"next_page":next}}})
}

fn foreign() -> Value {
    json!({"value":"\"keep-foreign\"","comment":"external owner"})
}

fn rrset(name: &str, ttl: Value, records: Value) -> Value {
    json!({"id":format!("{name}/TXT"),"name":name,"type":"TXT","zone":42,"ttl":ttl,"records":records})
}

fn action() -> Value {
    json!({"action":{"id":123,"status":"success","resources":[{"id":42,"type":"zone"}],"error":null}})
}

async fn serve(State(state): State<Arc<Mutex<Api>>>, request: Request) -> Response {
    assert_eq!(
        request.headers()[header::AUTHORIZATION],
        format!("Bearer {TOKEN}")
    );
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.path().to_owned();
    let bytes = to_bytes(request.into_body(), 8192).await.unwrap();
    let body: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    let mut api = state.lock().await;
    api.requests.push((method.clone(), path.clone()));
    if method == Method::GET && path == "/v1/zones" {
        let query = reqwest::Url::parse(&format!("http://fixture{uri}")).unwrap();
        let query: BTreeMap<_, _> = query.query_pairs().into_owned().collect();
        assert_eq!(query["mode"], "primary");
        assert_eq!(query["per_page"], "50");
        let number: u32 = query["page"].parse().unwrap();
        return Json(api.pages[&number].clone()).into_response();
    }
    if method == Method::GET && path == "/v1/zones/42" {
        return Json(json!({"zone":zone(42,"example.com","primary")})).into_response();
    }
    let prefix = "/v1/zones/42/rrsets/";
    if method == Method::GET && path.starts_with(prefix) {
        let name = path
            .strip_prefix(prefix)
            .unwrap()
            .strip_suffix("/TXT")
            .unwrap();
        return match api.records.get(name) {
            Some(record) => Json(json!({"rrset":record})).into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if method == Method::POST {
        if api.deny_write {
            return StatusCode::FORBIDDEN.into_response();
        }
        if path == "/v1/zones/42/rrsets" {
            assert_eq!(body["name"], "_acme-challenge");
            assert_eq!(body["type"], "TXT");
            assert!(body.get("ttl").is_some_and(Value::is_null));
            let record = rrset("_acme-challenge", Value::Null, body["records"].clone());
            api.records.insert("_acme-challenge".into(), record.clone());
            api.writes.push((path, body));
            let mut response = action();
            response["rrset"] = record;
            return (StatusCode::CREATED, Json(response)).into_response();
        }
        assert!(path.starts_with("/v1/zones/42/rrsets/_acme-challenge/TXT/actions/"));
        assert_eq!(
            body.as_object().unwrap().len(),
            1,
            "native record mutations must preserve TTL"
        );
        let record = api.records.get_mut("_acme-challenge").unwrap();
        let records = record["records"].as_array_mut().unwrap();
        let values = body["records"].as_array().unwrap();
        if path.ends_with("/add_records") {
            records.extend(values.iter().cloned());
        } else {
            assert!(path.ends_with("/remove_records"));
            records.retain(|record| !values.contains(record));
        }
        if records.is_empty() {
            api.records.remove("_acme-challenge");
        }
        api.writes.push((path, body));
        return Json(action()).into_response();
    }
    panic!("unexpected Hetzner fixture request: {method} {path}");
}

async fn fixture() -> Fixture {
    let api = Arc::new(Mutex::new(Api {
        pages: BTreeMap::from([(
            1,
            page(1, None, json!([zone(42, "example.com", "primary")])),
        )]),
        requests: Vec::new(),
        records: BTreeMap::from([
            (
                "_acme-challenge".into(),
                rrset("_acme-challenge", json!(7200), json!([foreign()])),
            ),
            (
                "_acme-challenge.keep".into(),
                rrset("_acme-challenge.keep", json!(3600), json!([foreign()])),
            ),
        ]),
        writes: Vec::new(),
        deny_write: false,
    }));
    let router = Router::new().fallback(serve).with_state(Arc::clone(&api));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1/", listener.local_addr().unwrap());
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
        provider: Some(ProviderId::Hetzner),
        expected_revision: 0,
        name: "Hetzner fixture".into(),
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
async fn discovers_primary_zones_across_pages_and_filters_secondary_zones() {
    let fixture = fixture().await;
    fixture.api.lock().await.pages = BTreeMap::from([
        (
            1,
            page(
                1,
                Some(2),
                json!([
                    zone(42, "Z.example", "primary"),
                    zone(43, "secondary.example", "secondary")
                ]),
            ),
        ),
        (2, page(2, None, json!([zone(44, "a.example", "primary")]))),
    ]);
    let zones = super::permitted(&fixture.endpoint, TOKEN).await.unwrap();
    assert_eq!(
        zones
            .iter()
            .map(|zone| (zone.id.as_str(), zone.name.as_str()))
            .collect::<Vec<_>>(),
        vec![("44", "a.example"), ("42", "z.example")]
    );
    assert_eq!(fixture.api.lock().await.requests.len(), 2);
}

#[tokio::test]
async fn rejects_duplicate_ids_names_invalid_ids_and_pagination() {
    let fixture = fixture().await;
    for zones in [
        json!([
            zone(42, "one.example", "primary"),
            zone(42, "two.example", "primary")
        ]),
        json!([
            zone(42, "same.example", "primary"),
            zone(43, "same.example", "primary")
        ]),
        json!([zone(0, "example.com", "primary")]),
        json!([zone(i64::MAX as u64 + 1, "example.com", "primary")]),
    ] {
        fixture
            .api
            .lock()
            .await
            .pages
            .insert(1, page(1, None, zones));
        assert!(matches!(
            super::permitted(&fixture.endpoint, TOKEN).await,
            Err(Error::ProviderUnavailable)
        ));
    }
    fixture.api.lock().await.pages.insert(
        1,
        page(1, Some(3), json!([zone(42, "example.com", "primary")])),
    );
    assert!(matches!(
        super::permitted(&fixture.endpoint, TOKEN).await,
        Err(Error::ProviderUnavailable)
    ));
}

#[tokio::test]
async fn strict_numeric_zone_ids_and_provider_mismatch_fail_before_network() {
    let fixture = fixture().await;
    for id in [
        "0",
        "01",
        "-1",
        "+1",
        " 42",
        "42 ",
        "42\n",
        "9223372036854775808",
        "example.com",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ] {
        let mut request = save_request();
        request.zone_ids = vec![id.into()];
        assert!(
            matches!(
                fixture.store.save(ID.into(), request).await,
                Err(Error::InvalidInput)
            ),
            "accepted {id:?}"
        );
        assert!(matches!(
            fixture
                .store
                .test(TestRequest {
                    provider: Some(ProviderId::Hetzner),
                    connection_id: None,
                    api_token: Some(TOKEN.into()),
                    zone_ids: Some(vec![id.into()])
                })
                .await,
            Err(Error::InvalidInput)
        ));
    }
    assert!(fixture.api.lock().await.requests.is_empty());
    assert!(ProviderId::Hetzner.valid_zone_id("1"));
    assert!(ProviderId::Hetzner.valid_zone_id("9223372036854775807"));
}

#[tokio::test]
async fn saves_encrypted_credentials_redacts_public_data_and_resolves_after_restart() {
    let fixture = fixture().await;
    let saved = fixture.store.save(ID.into(), save_request()).await.unwrap();
    assert_eq!(saved.provider, "hetzner");
    assert_eq!(saved.zones[0].id, ZONE);
    assert_eq!(saved.verification.status, ConnectionStatus::Untested);
    let tested = fixture.store.test(saved_test()).await.unwrap();
    assert_eq!(tested.selected_zone_ids, vec![ZONE]);
    assert!(!tested.dns_write_verified);
    assert!(fixture.api.lock().await.writes.is_empty());
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
            provider: ProviderId::Hetzner,
            connection_id: ID.into(),
            zone_id: ZONE.into(),
        })
        .await
        .unwrap();
    match config {
        DnsProviderConfig::Hetzner { zone_id, api_token } => {
            assert_eq!(zone_id, ZONE);
            assert_eq!(api_token, TOKEN);
        }
        _ => panic!("Hetzner connection resolved to another provider"),
    }
}

#[tokio::test]
async fn saved_provider_is_immutable_even_with_valid_other_provider_zone() {
    let fixture = fixture().await;
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    let count = fixture.api.lock().await.requests.len();
    for (provider, id) in [
        (ProviderId::Desec, "example.com"),
        (ProviderId::Cloudflare, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ] {
        let mut request = save_request();
        request.expected_revision = 1;
        request.provider = Some(provider);
        request.zone_ids = vec![id.into()];
        assert!(matches!(
            fixture.store.save(ID.into(), request).await,
            Err(Error::InvalidInput)
        ));
    }
    assert_eq!(fixture.api.lock().await.requests.len(), count);
}

#[tokio::test]
async fn write_verification_preserves_foreign_txt_values_comments_and_ttl() {
    let fixture = fixture().await;
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    let original = fixture.api.lock().await.records.clone();
    let verified = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(verified.verification.status, ConnectionStatus::Connected);
    assert!(verified.verified_for(ZONE));
    let api = fixture.api.lock().await;
    assert_eq!(api.records, original);
    assert_eq!(api.writes.len(), 2);
    assert!(api.writes[0].0.ends_with("/add_records"));
    assert!(api.writes[1].0.ends_with("/remove_records"));
    assert_eq!(api.writes[0].1["records"], api.writes[1].1["records"]);
    assert!(
        api.writes[0].1["records"][0]["comment"]
            .as_str()
            .unwrap()
            .starts_with("rentnerproxy-acme:")
    );
    drop(api);
    let restarted = Store::fixture(fixture.store.path.clone(), fixture.endpoint.clone());
    assert_eq!(
        restarted.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Connected
    );
}

#[tokio::test]
async fn new_verification_rrset_inherits_ttl_and_cleanup_removes_only_owned_values() {
    let fixture = fixture().await;
    fixture.api.lock().await.records.remove("_acme-challenge");
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
    let api = fixture.api.lock().await;
    assert_eq!(api.records.len(), 1);
    assert_eq!(
        api.records["_acme-challenge.keep"]["records"],
        json!([foreign()])
    );
    assert_eq!(api.writes.len(), 2);
    assert_eq!(api.writes[0].0, "/v1/zones/42/rrsets");
    assert!(api.writes[1].0.ends_with("/remove_records"));
}

#[tokio::test]
async fn read_only_token_passes_discovery_without_becoming_write_verified() {
    let fixture = fixture().await;
    fixture.store.save(ID.into(), save_request()).await.unwrap();
    fixture.api.lock().await.deny_write = true;
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
    assert!(fixture.api.lock().await.writes.is_empty());
}
