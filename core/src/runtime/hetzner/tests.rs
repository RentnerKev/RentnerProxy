use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, Response, StatusCode},
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

fn test_client() -> Client {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .unwrap()
}

struct Reply {
    status: StatusCode,
    headers: Vec<(String, String)>,
    body: String,
}
impl Reply {
    fn json(body: Value) -> Self {
        Self {
            status: StatusCode::OK,
            headers: vec![],
            body: body.to_string(),
        }
    }
    fn status(status: StatusCode) -> Self {
        Self {
            status,
            headers: vec![],
            body: "{}".into(),
        }
    }
    fn header(mut self, name: &str, value: impl ToString) -> Self {
        self.headers.push((name.into(), value.to_string()));
        self
    }
}
#[derive(Clone)]
struct Seen {
    method: String,
    uri: String,
    token: String,
    body: Value,
}
struct Data {
    replies: VecDeque<Reply>,
    seen: Vec<Seen>,
}
struct Fixture {
    base: Url,
    token: String,
    client: Client,
    data: Arc<Mutex<Data>>,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    async fn new(replies: Vec<Reply>) -> Self {
        let data = Arc::new(Mutex::new(Data {
            replies: replies.into(),
            seen: vec![],
        }));
        let app = Router::new().fallback(handle).with_state(data.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = test_client();
        Self {
            base,
            // An OS may reuse a closed listener's port while its provider pause is live.
            token: format!(
                "contract-fixture-{}",
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ),
            client,
            data,
            task,
        }
    }
    fn api(&self) -> Api<'_> {
        self.api_for(Duration::from_secs(3))
    }
    fn api_for(&self, duration: Duration) -> Api<'_> {
        Api::new(
            &self.client,
            &self.base,
            &self.token,
            Instant::now() + duration,
        )
    }
    fn count(&self) -> usize {
        self.data.lock().unwrap().seen.len()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn handle(State(data): State<Arc<Mutex<Data>>>, request: Request<Body>) -> Response<Body> {
    let method = request.method().to_string();
    let uri = request.uri().to_string();
    let token = request
        .headers()
        .get("authorization")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let bytes = to_bytes(request.into_body(), 1024 * 1024).await.unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    let mut data = data.lock().unwrap();
    data.seen.push(Seen {
        method,
        uri,
        token,
        body,
    });
    let reply = data
        .replies
        .pop_front()
        .unwrap_or_else(|| Reply::status(StatusCode::IM_A_TEAPOT));
    let mut response = Response::builder()
        .status(reply.status)
        .header("content-type", "application/json");
    for (name, value) in reply.headers {
        response = response.header(name, value);
    }
    response.body(Body::from(reply.body)).unwrap()
}
fn zone() -> Value {
    json!({"id":42,"name":"example.com","mode":"primary","ttl":900})
}
fn page(items: Vec<Value>, next: Value, last: u32, total: usize) -> Value {
    json!({"zones":items,"meta":{"pagination":{"page":1,"per_page":50,"next_page":next,"last_page":last,"total_entries":total}}})
}
fn action(id: u64, status: &str, zone: u64) -> Value {
    json!({"action":{"id":id,"status":status,"resources":[{"id":zone,"type":"zone"}],"error":null}})
}
fn records() -> [Record; 1] {
    [Record {
        value: "1.2.3.4".into(),
        comment: Some("fixture".into()),
    }]
}

#[tokio::test]
async fn zone_pagination_is_explicit_and_primary_filter_is_sent_without_exposing_token() {
    let fixture=Fixture::new(vec![Reply::json(page((0..50).map(|index| json!({"id":42+index,"name":format!("zone{index}.example.com"),"mode":"primary","ttl":900})).collect(), json!(2), 2, 51)),Reply::json(json!({"zones":[{"id":43,"name":"other.example","mode":"primary","ttl":900}],"meta":{"pagination":{"page":2,"per_page":50,"next_page":null,"last_page":2,"total_entries":51}}}))]).await;
    let first = fixture.api().zones_page(1).await.unwrap();
    assert_eq!(first.next_page, Some(2));
    assert_eq!(first.items[0].id, 42);
    assert!(
        fixture
            .api()
            .zones_page(2)
            .await
            .unwrap()
            .next_page
            .is_none()
    );
    let data = fixture.data.lock().unwrap();
    for (index, seen) in data.seen.iter().enumerate() {
        let url = fixture.base.join(&seen.uri).unwrap();
        let pairs = url
            .query_pairs()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(
            pairs.get("mode").map(|value| value.as_ref()),
            Some("primary")
        );
        assert_eq!(
            pairs.get("per_page").map(|value| value.as_ref()),
            Some("50")
        );
        assert_eq!(pairs.get("page").unwrap().as_ref(), (index + 1).to_string());
        assert_eq!(seen.token, format!("Bearer {}", fixture.token));
        assert!(!seen.uri.contains(&fixture.token));
    }
}
#[tokio::test]
async fn malformed_pagination_cannot_silently_truncate_discovery() {
    let good = page(vec![zone()], Value::Null, 1, 1);
    let mut cases = vec![];
    for field in ["page", "per_page", "next_page"] {
        let mut value = good.clone();
        value["meta"]["pagination"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        cases.push(value);
    }
    let mut wrong = good.clone();
    wrong["meta"]["pagination"]["next_page"] = json!(3);
    cases.push(wrong);
    let mut wrong = good.clone();
    wrong["meta"]["pagination"]["last_page"] = json!(2);
    cases.push(wrong);
    cases.push(page(vec![], json!(2), 2, 1));
    for body in cases {
        let fixture = Fixture::new(vec![Reply::json(body)]).await;
        assert_eq!(
            fixture.api().zones_page(1).await.err().unwrap().kind,
            ErrorKind::InvalidResponse
        );
        assert_eq!(fixture.count(), 1);
    }
}
#[tokio::test]
async fn redirect_is_not_followed_and_never_forwards_credentials_to_redirect_target() {
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::TEMPORARY_REDIRECT).header("location", "/credential-sink"),
    ])
    .await;
    assert_eq!(
        fixture.api().zone("42").await.unwrap_err().kind,
        ErrorKind::Unavailable
    );
    let data = fixture.data.lock().unwrap();
    // GET may be retried once at its original URL, but no redirected request occurs.
    assert!(data.seen.iter().all(|seen| seen.uri == "/zones/42"));
    assert!(data.seen.len() <= 2);
}
#[tokio::test]
async fn malformed_and_oversized_json_are_rejected_without_retry() {
    for body in [
        "{broken".to_owned(),
        format!("{{\"padding\":\"{}\"}}", "x".repeat(512 * 1024)),
    ] {
        let fixture = Fixture::new(vec![Reply {
            status: StatusCode::OK,
            headers: vec![],
            body,
        }])
        .await;
        assert_eq!(
            fixture.api().zone("42").await.unwrap_err().kind,
            ErrorKind::InvalidResponse
        );
        assert_eq!(fixture.count(), 1);
    }
}
#[tokio::test]
async fn reads_retry_only_once_and_server_failure_posts_are_never_replayed() {
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::INTERNAL_SERVER_ERROR),
        Reply::json(json!({"zone":zone()})),
    ])
    .await;
    assert_eq!(fixture.api().zone("42").await.unwrap().id, 42);
    assert_eq!(fixture.count(), 2);
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::INTERNAL_SERVER_ERROR),
        Reply::status(StatusCode::INTERNAL_SERVER_ERROR),
        Reply::json(json!({"zone":zone()})),
    ])
    .await;
    assert_eq!(
        fixture.api().zone("42").await.unwrap_err().kind,
        ErrorKind::Unavailable
    );
    assert_eq!(fixture.count(), 2);
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::INTERNAL_SERVER_ERROR),
        Reply::json(action(123, "success", 42)),
    ])
    .await;
    assert_eq!(
        fixture
            .api()
            .set_records("42", "www", "A", &records())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::WriteUnconfirmed
    );
    assert_eq!(fixture.count(), 1);
    let data = fixture.data.lock().unwrap();
    assert_eq!(data.seen[0].method, "POST");
    assert_eq!(
        data.seen[0].body,
        json!({"records":[{"value":"1.2.3.4","comment":"fixture"}]})
    );
}
#[tokio::test]
async fn post_transport_disconnect_does_not_replay_mutation() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let seen = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = seen.clone();
    let task = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let mut bytes = [0; 8192];
            let _ = stream.read(&mut bytes).await;
            let _ = stream.shutdown().await;
        }
    });
    let client = test_client();
    let api = Api::new(
        &client,
        &base,
        "contract-fixture",
        Instant::now() + Duration::from_secs(1),
    );
    assert_eq!(
        api.add_records("42", "www", "A", &records())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::WriteUnconfirmed
    );
    assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 1);
    task.abort();
}
#[tokio::test]
async fn provider_pause_headers_survive_read_and_ambiguous_write_failures() {
    for status in [
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::SERVICE_UNAVAILABLE,
    ] {
        let fixture = Fixture::new(vec![Reply::status(status).header("retry-after", 23)]).await;
        let error = fixture.api().zone("42").await.unwrap_err();
        assert_eq!(
            error.kind,
            if status == StatusCode::TOO_MANY_REQUESTS {
                ErrorKind::RateLimited
            } else {
                ErrorKind::Unavailable
            }
        );
        assert_eq!(error.retry_after, Some(23));
        assert_eq!(fixture.count(), 1);
    }
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::SERVICE_UNAVAILABLE).header("retry-after", 31),
    ])
    .await;
    let error = fixture
        .api()
        .set_records("42", "www", "A", &records())
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::WriteUnconfirmed);
    assert_eq!(error.retry_after, Some(31));
    let reset = time::OffsetDateTime::now_utc().unix_timestamp() + 40;
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::TOO_MANY_REQUESTS).header("ratelimit-reset", reset),
    ])
    .await;
    let error = fixture.api().zone("42").await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::RateLimited);
    assert!((38..=40).contains(&error.retry_after.unwrap()));
}
#[tokio::test]
async fn action_polling_binds_both_action_id_and_zone_without_replaying_post() {
    let fixture = Fixture::new(vec![
        Reply::json(action(123, "running", 42)),
        Reply::json(action(123, "success", 42)),
    ])
    .await;
    fixture
        .api()
        .set_records("42", "www", "A", &records())
        .await
        .unwrap();
    {
        let data = fixture.data.lock().unwrap();
        assert_eq!(data.seen.len(), 2);
        assert_eq!(data.seen[0].method, "POST");
        assert_eq!(data.seen[1].method, "GET");
        assert_eq!(data.seen[1].uri, "/actions/123");
    }
    for (id, zone) in [(124, 42), (123, 43)] {
        let fixture = Fixture::new(vec![
            Reply::json(action(123, "running", 42)),
            Reply::json(action(id, "success", zone)),
        ])
        .await;
        assert_eq!(
            fixture
                .api()
                .set_records("42", "www", "A", &records())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::InvalidResponse
        );
        assert_eq!(fixture.count(), 2);
    }
}
#[tokio::test]
async fn running_action_stops_at_deadline_without_another_mutation() {
    let fixture = Fixture::new(vec![
        Reply::json(action(123, "running", 42)),
        Reply::json(action(123, "running", 42)),
    ])
    .await;
    let started = Instant::now();
    let error = fixture
        .api_for(Duration::from_millis(160))
        .set_records("42", "www", "A", &records())
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::TimeBudgetExceeded);
    assert!(started.elapsed() < Duration::from_secs(1));
    let data = fixture.data.lock().unwrap();
    assert_eq!(
        data.seen
            .iter()
            .filter(|seen| seen.method == "POST")
            .count(),
        1
    );
    assert!(data.seen.len() <= 2);
}

#[tokio::test]
async fn rrset_identity_must_match_exact_owner_type_and_zone() {
    let good = json!({"id":"www/A","name":"www","type":"A","zone":42,"ttl":null,"records":[{"value":"1.2.3.4","comment":null}]});
    for (field, value) in [
        ("id", json!("other/A")),
        ("name", json!("other")),
        ("type", json!("AAAA")),
        ("zone", json!(43)),
    ] {
        let mut rrset = good.clone();
        rrset[field] = value;
        let fixture = Fixture::new(vec![Reply::json(json!({"rrset":rrset}))]).await;
        assert_eq!(
            fixture
                .api()
                .rrset("42", "www", "A")
                .await
                .unwrap_err()
                .kind,
            ErrorKind::InvalidResponse,
            "{field}"
        );
        assert_eq!(fixture.count(), 1);
    }
    let fixture = Fixture::new(vec![Reply::json(json!({"rrset":good}))]).await;
    assert_eq!(
        fixture
            .api()
            .rrset("42", "www", "A")
            .await
            .unwrap()
            .unwrap()
            .id,
        "www/A"
    );
}
#[tokio::test]
async fn optional_pagination_totals_are_consistent_when_present() {
    for total in [json!(0), json!(2), json!("1")] {
        let mut body = page(vec![zone()], Value::Null, 1, 1);
        body["meta"]["pagination"]["total_entries"] = total;
        let fixture = Fixture::new(vec![Reply::json(body)]).await;
        assert_eq!(
            fixture.api().zones_page(1).await.err().unwrap().kind,
            ErrorKind::InvalidResponse
        );
    }
    let mut body = page(vec![zone()], Value::Null, 1, 1);
    let pagination = body["meta"]["pagination"].as_object_mut().unwrap();
    pagination.remove("last_page");
    pagination.remove("total_entries");
    let fixture = Fixture::new(vec![Reply::json(body)]).await;
    assert_eq!(fixture.api().zones_page(1).await.unwrap().items.len(), 1);
}

#[tokio::test]
async fn failed_action_acknowledgement_is_not_reported_as_success_or_replayed() {
    let mut response = action(123, "error", 42);
    response["action"]["error"] = json!({"code":"action_failed","message":"fixture failure"});
    let fixture = Fixture::new(vec![Reply::json(response)]).await;
    assert_eq!(
        fixture
            .api()
            .set_records("42", "www", "A", &records())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Unavailable
    );
    assert_eq!(fixture.count(), 1);
}

#[tokio::test]
async fn accepted_mutation_poll_auth_and_rate_limits_are_unconfirmed_with_pause_preserved() {
    for status in [
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        for hint in [None, Some(29)] {
            let mut rejection = Reply::status(status);
            if let Some(seconds) = hint {
                rejection = rejection.header("retry-after", seconds);
            }
            let fixture =
                Fixture::new(vec![Reply::json(action(123, "running", 42)), rejection]).await;
            let error = fixture
                .api()
                .set_records("42", "www", "A", &records())
                .await
                .unwrap_err();
            assert_eq!(error.kind, ErrorKind::WriteUnconfirmed, "{status}");
            assert_eq!(
                error.retry_after,
                hint.or(if status == StatusCode::TOO_MANY_REQUESTS {
                    Some(60)
                } else {
                    None
                })
            );
            let data = fixture.data.lock().unwrap();
            assert_eq!(data.seen.len(), 2);
            assert_eq!(data.seen[0].method, "POST");
            assert_eq!(data.seen[1].method, "GET");
            assert_eq!(data.seen[1].uri, "/actions/123");
        }
        let fixture = Fixture::new(vec![Reply::status(status).header("retry-after", 17)]).await;
        let error = fixture
            .api()
            .set_records("42", "www", "A", &records())
            .await
            .unwrap_err();
        assert_eq!(
            error.kind,
            if status == StatusCode::TOO_MANY_REQUESTS {
                ErrorKind::RateLimited
            } else {
                ErrorKind::Unauthorized
            }
        );
        assert_eq!(error.retry_after, Some(17));
        assert_eq!(fixture.count(), 1);
    }
}
#[tokio::test]
async fn server_errors_ignore_rate_limit_reset_and_keep_the_single_get_retry() {
    let reset = time::OffsetDateTime::now_utc().unix_timestamp() + 300;
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::SERVICE_UNAVAILABLE).header("ratelimit-reset", reset),
        Reply::status(StatusCode::SERVICE_UNAVAILABLE).header("ratelimit-reset", reset),
        Reply::json(json!({"zone":zone()})),
    ])
    .await;
    let error = fixture.api().zone("42").await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert_eq!(error.retry_after, None);
    assert_eq!(fixture.count(), 2);
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::SERVICE_UNAVAILABLE).header("ratelimit-reset", reset),
    ])
    .await;
    let error = fixture
        .api()
        .set_records("42", "www", "A", &records())
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::WriteUnconfirmed);
    assert_eq!(error.retry_after, None);
    assert_eq!(fixture.count(), 1);
}

#[tokio::test]
async fn provider_pause_is_shared_across_api_clients_but_scoped_to_base_and_token() {
    for (status, kind) in [
        (StatusCode::TOO_MANY_REQUESTS, ErrorKind::RateLimited),
        (StatusCode::SERVICE_UNAVAILABLE, ErrorKind::Unavailable),
    ] {
        let fixture = Fixture::new(vec![
            Reply::status(status).header("retry-after", 47),
            Reply::json(json!({"zone":zone()})),
        ])
        .await;
        super::clear_pause_for_test(&fixture.base, &fixture.token);
        let initial = fixture.api().zone("42").await.unwrap_err();
        assert_eq!(initial.kind, kind);
        assert_eq!(initial.retry_after, Some(47));
        assert_eq!(fixture.count(), 1);

        // Separate reqwest clients and Api objects must honor one provider scope.
        let another_client = test_client();
        for _ in 0..2 {
            let another_api = Api::new(
                &another_client,
                &fixture.base,
                &fixture.token,
                Instant::now() + Duration::from_secs(3),
            );
            let paused = another_api.zone("42").await.unwrap_err();
            assert_eq!(paused.kind, kind);
            assert!((46..=47).contains(&paused.retry_after.unwrap()));
            assert_eq!(
                fixture.count(),
                1,
                "cooldown must reject locally before HTTP"
            );
        }

        let other_token_api = Api::new(
            &another_client,
            &fixture.base,
            "different-fixture-token",
            Instant::now() + Duration::from_secs(3),
        );
        assert_eq!(other_token_api.zone("42").await.unwrap().id, 42);
        assert_eq!(fixture.count(), 2);
        assert_eq!(
            fixture.data.lock().unwrap().seen[1].token,
            "Bearer different-fixture-token"
        );

        // A token's pause on one endpoint cannot suppress another API scope.
        let other_base = Fixture::new(vec![Reply::json(json!({"zone":zone()}))]).await;
        let other_base_api = Api::new(
            &other_base.client,
            &other_base.base,
            &fixture.token,
            Instant::now() + Duration::from_secs(3),
        );
        assert_eq!(other_base_api.zone("42").await.unwrap().id, 42);
        assert_eq!(other_base.count(), 1);
        super::clear_pause_for_test(&fixture.base, &fixture.token);
    }
}

#[tokio::test]
async fn fixture_credentials_isolate_cooldowns_even_when_an_endpoint_is_reused() {
    let fixture = Fixture::new(vec![
        Reply::status(StatusCode::UNAUTHORIZED).header("retry-after", 47),
        Reply::json(json!({"zone":zone()})),
    ])
    .await;
    assert_eq!(
        fixture.api().zone("42").await.unwrap_err().kind,
        ErrorKind::Unauthorized
    );

    let next_fixture = Fixture::new(vec![]).await;
    assert_ne!(fixture.token, next_fixture.token);
    // Keep the listener alive to model port reuse deterministically on every OS.
    let next_scope = Api::new(
        &next_fixture.client,
        &fixture.base,
        &next_fixture.token,
        Instant::now() + Duration::from_secs(3),
    );
    assert_eq!(next_scope.zone("42").await.unwrap().id, 42);
    assert_eq!(fixture.count(), 2);
    assert_eq!(
        fixture.api().zone("42").await.unwrap_err().kind,
        ErrorKind::Unauthorized
    );
    assert_eq!(
        fixture.count(),
        2,
        "the original scope must still honor its pause"
    );
    super::clear_pause_for_test(&fixture.base, &fixture.token);
}
