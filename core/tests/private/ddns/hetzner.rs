use super::*;
use crate::runtime::{
    ddns::{
        Engine,
        models::{RecordType, Selection, Status},
    },
    dns::capabilities::ProviderId,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::time::{Duration, Instant};

struct Data {
    rrsets: Vec<Value>,
    writes: Vec<(String, Value)>,
    status: StatusCode,
    write_status: StatusCode,
    commit_on_error: bool,
    mutation_retry_after: Option<u32>,
    reads_after_write: usize,
    mode: String,
}
struct Fixture {
    data: Arc<Mutex<Data>>,
    base: String,
    task: tokio::task::JoinHandle<()>,
}
fn rrset(kind: &str, values: &[&str], comment: Option<&str>, ttl: Option<u32>) -> Value {
    json!({"id":format!("www/{kind}"),"zone":42,"name":"www","type":kind,"ttl":ttl,
        "records":values.iter().map(|value| json!({"value":value,"comment":comment})).collect::<Vec<_>>()})
}
fn target(selection: Selection, kind: RecordType) -> Target {
    Target {
        id: "0000000000000000000000000000000a".into(),
        connection_id: "00000000000000000000000000000001".into(),
        zone_id: "42".into(),
        name: "www.example.com".into(),
        record_type: kind,
        proxied: false,
        enabled: true,
        selection,
    }
}
fn auth(headers: &HeaderMap) {
    assert_eq!(headers["authorization"], "Bearer fixture-hetzner");
}
async fn zone(
    State(data): State<Arc<Mutex<Data>>>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    auth(&headers);
    let mut data = data.lock().unwrap();
    if !data.writes.is_empty() {
        data.reads_after_write += 1;
    }
    (
        data.status,
        Json(json!({"zone":{"id":42,"name":"example.com","mode":data.mode,"ttl":900}})),
    )
}
async fn list(
    State(data): State<Arc<Mutex<Data>>>,
    headers: HeaderMap,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    let mut data = data.lock().unwrap();
    if !data.writes.is_empty() {
        data.reads_after_write += 1;
    }
    let mut headers = HeaderMap::new();
    headers.insert("retry-after", "17".parse().unwrap());
    (
        data.status,
        headers,
        Json(
            json!({"rrsets":data.rrsets,"meta":{"pagination":{"page":1,"per_page":50,"next_page":null,"previous_page":null,"last_page":1,"total_entries":data.rrsets.len()}}}),
        ),
    )
}
async fn create(
    State(data): State<Arc<Mutex<Data>>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    mutate(data, "create".into(), None, body)
}
async fn update(
    State(data): State<Arc<Mutex<Data>>>,
    Path((name, kind, action)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, HeaderMap, Json<Value>) {
    auth(&headers);
    assert_eq!(name, "www");
    mutate(data, action, Some(kind), body)
}
fn mutate(
    data: Arc<Mutex<Data>>,
    action: String,
    kind: Option<String>,
    body: Value,
) -> (StatusCode, HeaderMap, Json<Value>) {
    let mut data = data.lock().unwrap();
    data.writes.push((action, body.clone()));
    let kind = kind.unwrap_or_else(|| body["type"].as_str().unwrap().to_owned());
    let mut written = data
        .rrsets
        .iter()
        .find(|rrset| rrset["type"] == kind)
        .cloned()
        .unwrap_or_else(|| rrset(&kind, &[], None, None));
    written["records"] = body["records"].clone();
    if data.write_status.is_success() || data.commit_on_error {
        data.rrsets.retain(|rrset| rrset["type"] != kind);
        data.rrsets.push(written.clone());
    }
    let mut headers = HeaderMap::new();
    if let Some(seconds) = data.mutation_retry_after {
        headers.insert("retry-after", seconds.to_string().parse().unwrap());
    }
    let response = if data.write_status.is_success() {
        json!({"rrset":written,"action":{"id":123,"status":"success","command":"set_rrset_records","resources":[{"id":42,"type":"zone"}],"error":null}})
    } else {
        json!({"error":{"code":"server_error","message":"fixture failure"}})
    };
    (data.write_status, headers, Json(response))
}
impl Fixture {
    async fn new(rrsets: Vec<Value>) -> Self {
        let data = Arc::new(Mutex::new(Data {
            rrsets,
            writes: vec![],
            status: StatusCode::OK,
            write_status: StatusCode::OK,
            commit_on_error: false,
            mutation_retry_after: Some(23),
            reads_after_write: 0,
            mode: "primary".into(),
        }));
        let app = Router::new()
            .route("/zones/42", get(zone))
            .route("/zones/42/rrsets", get(list).post(create))
            .route(
                "/zones/42/rrsets/{name}/{kind}/actions/{action}",
                post(update),
            )
            .with_state(data.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { data, base, task }
    }
    fn provider(&self) -> Provider<'_> {
        Provider::new(
            ProviderId::Hetzner,
            super::super::http::client().unwrap(),
            &self.base,
            "fixture-hetzner",
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap()
    }
    async fn run(
        &self,
        target: &Target,
        ip: &str,
        preview: bool,
    ) -> Result<super::super::models::TargetResult, Failure> {
        Engine::new()
            .compare(&self.provider(), target, ip.parse().unwrap(), preview)
            .await
    }
    async fn adoption(&self, kind: RecordType) -> Target {
        let inspect = target(Selection::Inspect, kind);
        let ip = if kind == RecordType::A {
            "8.8.8.8"
        } else {
            "2001:4860:4860::8844"
        };
        let result = self.run(&inspect, ip, true).await.unwrap();
        target(
            Selection::Adopt {
                record_id: result.current.unwrap().id,
            },
            kind,
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[tokio::test]
async fn create_uses_zone_default_ttl_and_marker_survives_engine_restart() {
    for (kind, ip) in [
        (RecordType::A, "8.8.8.8"),
        (RecordType::Aaaa, "2001:4860:4860::8844"),
    ] {
        let fixture = Fixture::new(vec![]).await;
        let target = target(Selection::Create, kind);
        let first = fixture.run(&target, ip, false).await.unwrap();
        assert_eq!(first.status, Status::Updated);
        assert_eq!(first.current.as_ref().unwrap().id.len(), 32);
        let second = fixture.run(&target, ip, false).await.unwrap();
        assert_eq!(second.status, Status::Unchanged);
        let data = fixture.data.lock().unwrap();
        assert_eq!(data.writes.len(), 1);
        assert_eq!(data.writes[0].0, "create");
        assert_eq!(data.writes[0].1["ttl"], Value::Null);
        assert_eq!(
            data.writes[0].1["records"],
            json!([{"value":ip,"comment":provider::marker(&target)}])
        );
    }
}
#[tokio::test]
async fn explicit_adoption_preserves_exact_foreign_comment_ttl_and_unrelated_types() {
    for ttl in [None, Some(3600)] {
        let foreign = " owner note: keep ünicode and spaces ";
        let txt = rrset("TXT", &["\"foreign\""], Some("TXT owner"), Some(7200));
        let fixture = Fixture::new(vec![
            rrset("AAAA", &["2001:4860:4860::8888"], Some(foreign), ttl),
            txt.clone(),
        ])
        .await;
        let target = fixture.adoption(RecordType::Aaaa).await;
        assert_eq!(
            fixture
                .run(&target, "2001:4860:4860::8844", false)
                .await
                .unwrap()
                .status,
            Status::Updated
        );
        assert_eq!(
            fixture
                .run(&target, "2001:4860:4860:0:0:0:0:8844", false)
                .await
                .unwrap()
                .status,
            Status::Unchanged
        );
        let data = fixture.data.lock().unwrap();
        assert_eq!(data.writes.len(), 1);
        assert_eq!(data.writes[0].0, "set_records");
        assert!(data.writes[0].1.get("ttl").is_none());
        assert_eq!(
            data.writes[0].1["records"],
            json!([{"value":"2001:4860:4860::8844","comment":foreign}])
        );
        assert!(data.rrsets.contains(&txt));
        assert_eq!(
            data.rrsets
                .iter()
                .find(|rrset| rrset["type"] == "AAAA")
                .unwrap()["ttl"],
            json!(ttl)
        );
    }
}
#[tokio::test]
async fn empty_existing_rrset_adds_instead_of_creating_and_preserves_ttl() {
    let fixture = Fixture::new(vec![rrset("A", &[], None, Some(1200))]).await;
    let target = target(Selection::Create, RecordType::A);
    assert_eq!(
        fixture.run(&target, "8.8.8.8", false).await.unwrap().status,
        Status::Updated
    );
    let data = fixture.data.lock().unwrap();
    assert_eq!(data.writes[0].0, "add_records");
    assert_eq!(data.rrsets[0]["ttl"], 1200);
}
#[tokio::test]
async fn rejects_foreign_markers_multivalue_cname_and_unselected_records() {
    for rrsets in [
        vec![rrset(
            "A",
            &["1.2.3.4"],
            Some("rentnerproxy-ddns:other"),
            None,
        )],
        vec![rrset("A", &["1.2.3.4", "8.8.4.4"], None, None)],
        vec![rrset("CNAME", &["foreign.example.com."], None, None)],
        vec![rrset("CNAME", &[], None, None)],
        vec![rrset("A", &["1.2.3.4"], None, None)],
    ] {
        let fixture = Fixture::new(rrsets).await;
        assert_eq!(
            fixture
                .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
                .await
                .unwrap_err()
                .code,
            Error::RecordConflict
        );
        assert!(fixture.data.lock().unwrap().writes.is_empty());
    }
}
#[tokio::test]
async fn comment_change_invalidates_adoption_but_address_change_does_not() {
    let fixture = Fixture::new(vec![rrset("A", &["1.2.3.4"], Some("owner"), None)]).await;
    let target = fixture.adoption(RecordType::A).await;
    fixture.data.lock().unwrap().rrsets[0]["records"][0]["comment"] = json!("new owner");
    assert_eq!(
        fixture
            .run(&target, "8.8.8.8", false)
            .await
            .unwrap_err()
            .code,
        Error::RecordChanged
    );
    fixture.data.lock().unwrap().rrsets[0]["records"][0] =
        json!({"value":"8.8.4.4","comment":"owner"});
    assert_eq!(
        fixture.run(&target, "8.8.8.8", false).await.unwrap().status,
        Status::Updated
    );
}
#[tokio::test]
async fn ambiguous_write_readback_confirms_only_exact_result_without_replay() {
    for commit in [false, true] {
        let fixture = Fixture::new(vec![]).await;
        {
            let mut data = fixture.data.lock().unwrap();
            data.write_status = StatusCode::INTERNAL_SERVER_ERROR;
            data.commit_on_error = commit;
            data.mutation_retry_after = None;
        }
        let result = fixture
            .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
            .await;
        if commit {
            assert_eq!(result.unwrap().status, Status::Updated);
        } else {
            let failure = result.unwrap_err();
            assert_eq!(failure.code, Error::WriteUnconfirmed);
            assert_eq!(failure.retry_after, None);
        }
        assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
    }
}
#[tokio::test]
async fn rejects_nonprimary_unauthorized_and_proxy_before_mutation() {
    let fixture = Fixture::new(vec![]).await;
    fixture.data.lock().unwrap().mode = "secondary".into();
    assert!(
        fixture
            .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
            .await
            .is_err()
    );
    fixture.data.lock().unwrap().mode = "primary".into();
    fixture.data.lock().unwrap().status = StatusCode::UNAUTHORIZED;
    assert_eq!(
        fixture
            .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
            .await
            .unwrap_err()
            .code,
        Error::ProviderUnauthorized
    );
    let mut target = target(Selection::Create, RecordType::A);
    target.proxied = true;
    assert_eq!(
        fixture
            .run(&target, "8.8.8.8", false)
            .await
            .unwrap_err()
            .code,
        Error::InvalidInput
    );
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}
#[tokio::test]
async fn rate_limit_write_is_not_replayed_and_retains_cooldown() {
    let fixture = Fixture::new(vec![]).await;
    fixture.data.lock().unwrap().write_status = StatusCode::TOO_MANY_REQUESTS;
    let failure = fixture
        .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
        .await
        .unwrap_err();
    assert_eq!(failure.code, Error::ProviderRateLimited);
    assert_eq!(failure.retry_after, Some(23));
    assert_eq!(fixture.data.lock().unwrap().writes.len(), 1);
}

#[tokio::test]
async fn address_family_and_outside_owner_validation_prevents_mutation() {
    for value in ["not-an-address", "2001:4860:4860::8888"] {
        let fixture = Fixture::new(vec![rrset("A", &[value], None, None)]).await;
        assert_eq!(
            fixture
                .run(&target(Selection::Inspect, RecordType::A), "8.8.8.8", true)
                .await
                .unwrap_err()
                .code,
            Error::InvalidProviderResponse
        );
        assert!(fixture.data.lock().unwrap().writes.is_empty());
    }
    let fixture = Fixture::new(vec![]).await;
    let mut target = target(Selection::Create, RecordType::A);
    target.name = "www.other.example.net".into();
    assert_eq!(
        fixture
            .run(&target, "8.8.8.8", false)
            .await
            .unwrap_err()
            .code,
        Error::NameOutsideZone
    );
    assert!(fixture.data.lock().unwrap().writes.is_empty());
}

#[tokio::test]
async fn ambiguous_mutation_with_provider_pause_defers_readback_and_preserves_cooldown() {
    for commit in [false, true] {
        let fixture = Fixture::new(vec![]).await;
        {
            let mut data = fixture.data.lock().unwrap();
            data.write_status = StatusCode::SERVICE_UNAVAILABLE;
            data.commit_on_error = commit;
            data.mutation_retry_after = Some(47);
        }
        let failure = fixture
            .run(&target(Selection::Create, RecordType::A), "8.8.8.8", false)
            .await
            .unwrap_err();
        assert_eq!(failure.code, Error::WriteUnconfirmed);
        assert_eq!(failure.retry_after, Some(47));
        let result =
            super::super::failure_result(&target(Selection::Create, RecordType::A), failure);
        assert_eq!(
            result.provider_cooldown(),
            Some((47, Error::ProviderUnavailable))
        );
        let data = fixture.data.lock().unwrap();
        assert_eq!(data.writes.len(), 1);
        assert_eq!(data.reads_after_write, 0);
        assert_eq!(!data.rrsets.is_empty(), commit);
    }
}
