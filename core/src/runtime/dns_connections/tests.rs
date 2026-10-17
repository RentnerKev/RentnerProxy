use super::models::{Consumer, ConsumerType, Usage};
use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
const ID: &str = "0198d98a-0000-7000-8000-000000000091";
const USER: &str = "0198d98a-0000-7000-8000-000000000092";
fn zone_id(c: char) -> String {
    c.to_string().repeat(32)
}
fn directory() -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "dns-connections-{}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    super::super::state::prepare_state_dir(&path).unwrap();
    path
}
async fn fixture() -> (Store, tokio::task::JoinHandle<()>, Arc<AtomicUsize>) {
    let status = Arc::new(AtomicUsize::new(200));
    let current = status.clone();
    let router = axum::Router::new().route("/zones",axum::routing::get(move |headers:axum::http::HeaderMap| { let current = current.clone(); async move {
        assert!(headers.get("authorization").is_some());
        let status = axum::http::StatusCode::from_u16(current.load(Ordering::SeqCst) as u16).unwrap();
        (status,axum::Json(serde_json::json!({"success":true,"result":[{"id":zone_id('a'),"name":"example.com","status":"active","account":{"id":"fixture-account"},"name_servers":["ada.ns.cloudflare.com"]},{"id":zone_id('b'),"name":"example.org"}],"result_info":{"page":1,"per_page":20,"total_pages":1}})))
    }}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut store = Store::new(directory());
    store.key = Some([7; 32]);
    store.endpoint = Some(format!("http://{address}/"));
    (store, task, status)
}
fn request(revision: u32) -> SaveRequest {
    SaveRequest {
        expected_revision: revision,
        name: "Cloudflare primary".into(),
        api_token: Some("secret-fixture-token".into()),
        zone_ids: vec![zone_id('a'), zone_id('b')],
        actor_user_id: USER.into(),
    }
}
#[tokio::test]
async fn uncertain_registry_writes_reload_rotations_references_and_deletions() {
    let (store, task, _) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    let mut rotation = request(1);
    rotation.api_token = Some("replacement-token".into());
    store.fail_after_persist.store(true, Ordering::SeqCst);
    assert!(matches!(
        store.save(ID.into(), rotation).await,
        Err(Error::StoreUnavailable)
    ));
    assert_eq!(store.list().await.unwrap()[0].revision, 2);
    assert_eq!(
        store.record_access(ID, &zone_id('a')).await.unwrap().token,
        "replacement-token"
    );
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::ConnectionConflict)
    ));
    let reference = Reference {
        connection_id: ID.into(),
        zone_id: zone_id('a'),
        consumer: Consumer {
            r#type: ConsumerType::Ddns,
            id: USER.into(),
        },
    };
    store.fail_after_persist.store(true, Ordering::SeqCst);
    assert!(matches!(
        store.ddns_references(&[reference], true, true).await,
        Err(Error::StoreUnavailable)
    ));
    assert_eq!(store.list().await.unwrap()[0].references.len(), 1);
    assert!(matches!(
        store.delete(ID, 2).await,
        Err(Error::ConnectionInUse)
    ));
    store.ddns_references(&[], false, false).await.unwrap();
    store.fail_after_persist.store(true, Ordering::SeqCst);
    assert!(matches!(
        store.delete(ID, 2).await,
        Err(Error::StoreUnavailable)
    ));
    assert!(store.list().await.unwrap().is_empty());
    task.abort();
}

#[tokio::test]
async fn multizone_encryption_rotation_restart_and_redaction() {
    let (store, task, status) = fixture().await;
    let first = store.save(ID.into(), request(0)).await.unwrap();
    assert_eq!(first.zones.len(), 2);
    let bytes = state_dir(&store.path)
        .unwrap()
        .read_file(FILE, MAX_BYTES)
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("secret-fixture-token"));
    let public = serde_json::to_string(&store.list().await.unwrap()).unwrap();
    assert!(!public.contains("secret"));
    assert!(!public.contains("nonce"));
    let mut restarted = Store::new(store.path.clone());
    restarted.key = store.key;
    restarted.endpoint = store.endpoint.clone();
    let result = restarted
        .test(TestRequest {
            connection_id: Some(ID.into()),
            api_token: None,
            zone_ids: None,
        })
        .await
        .unwrap();
    assert_eq!(result.selected_zone_ids.len(), 2);
    assert!(!result.dns_write_verified);
    status.store(403, Ordering::SeqCst);
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::ProviderUnauthorized)
    ));
    assert_eq!(store.list().await.unwrap()[0].revision, 1);
    assert_eq!(
        state_dir(&store.path)
            .unwrap()
            .read_file(FILE, MAX_BYTES)
            .unwrap(),
        bytes
    );
    status.store(200, Ordering::SeqCst);
    let mut rotation = request(1);
    rotation.api_token = Some("replacement-token".into());
    assert_eq!(store.save(ID.into(), rotation).await.unwrap().revision, 2);
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::ConnectionConflict)
    ));
    task.abort();
}
#[tokio::test]
async fn references_block_delete_and_zone_removal_and_malformed_store_fails_closed() {
    let (store, task, _) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    {
        let mut state = store.lock().await.unwrap();
        let registry = Store::registry(&mut state).unwrap();
        registry.connections[0].metadata.references.push(Usage {
            zone_id: zone_id('a'),
            consumer: Consumer {
                r#type: ConsumerType::Ddns,
                id: USER.into(),
            },
        });
        store.persist(registry).unwrap();
    }
    assert!(matches!(
        store.delete(ID, 1).await,
        Err(Error::ConnectionInUse)
    ));
    let mut remove = request(1);
    remove.zone_ids = vec![zone_id('b')];
    assert!(matches!(
        store.save(ID.into(), remove).await,
        Err(Error::ConnectionInUse)
    ));
    let result = store
        .validate_reference(Reference {
            connection_id: ID.into(),
            zone_id: zone_id('a'),
            consumer: Consumer {
                r#type: ConsumerType::Dns01,
                id: USER.into(),
            },
        })
        .await
        .unwrap();
    assert_eq!(result.revision, 1);
    let mut bytes: serde_json::Value = serde_json::from_slice(
        &state_dir(&store.path)
            .unwrap()
            .read_file(FILE, MAX_BYTES)
            .unwrap(),
    )
    .unwrap();
    bytes["connections"][0]["metadata"]["references"] =
        serde_json::json!([{"zoneId":zone_id('a'),"consumer":{"type":"oops","id":USER}}]);
    state_dir(&store.path)
        .unwrap()
        .atomic_write(FILE, &serde_json::to_vec(&bytes).unwrap())
        .unwrap();
    let broken = Store::new(store.path.clone());
    assert!(matches!(broken.list().await, Err(Error::StoreUnavailable)));
    task.abort();
}
#[tokio::test]
async fn failed_registry_load_retries_after_repair_without_restart() {
    let (store, task, _) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    let dir = state_dir(&store.path).unwrap();
    let original = dir.read_file(FILE, MAX_BYTES).unwrap();
    let malformed = b"{invalid registry";
    dir.atomic_write(FILE, malformed).unwrap();
    let recovering = Store::new(store.path.clone());
    for _ in 0..2 {
        assert!(matches!(
            recovering.list().await,
            Err(Error::StoreUnavailable)
        ));
        assert!(matches!(
            recovering.delete(ID, 1).await,
            Err(Error::StoreUnavailable)
        ));
        assert_eq!(dir.read_file(FILE, MAX_BYTES).unwrap(), malformed);
    }
    dir.atomic_write(FILE, &original).unwrap();
    let restored = recovering.list().await.unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, ID);
    assert_eq!(restored[0].revision, 1);
    assert_eq!(restored[0].zones.len(), 2);
    // Only a successfully loaded registry becomes the authoritative in-memory state.
    dir.atomic_write(FILE, malformed).unwrap();
    assert_eq!(recovering.list().await.unwrap()[0].id, ID);
    task.abort();
}

#[tokio::test]
async fn failed_registry_read_retries_after_filesystem_recovery() {
    let path = directory();
    let file = path.join(FILE);
    std::fs::create_dir(&file).unwrap();
    let store = Store::new(path.clone());
    assert!(matches!(store.list().await, Err(Error::StoreUnavailable)));
    std::fs::remove_dir(&file).unwrap();
    state_dir(&path)
        .unwrap()
        .atomic_write(FILE, br#"{"version":1,"connections":[]}"#)
        .unwrap();
    assert!(store.list().await.unwrap().is_empty());
}
#[tokio::test]
async fn concurrent_updates_have_one_winner_and_domain_separated_secrets() {
    let (store, task, _) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    let (a, b) = tokio::join!(
        store.save(ID.into(), request(1)),
        store.save(ID.into(), request(1))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert!(
        matches!(a, Err(Error::ConnectionConflict)) || matches!(b, Err(Error::ConnectionConflict))
    );
    let mut state = store.lock().await.unwrap();
    let entry = &Store::registry(&mut state).unwrap().connections[0];
    assert!(encryption::decrypt_bytes(&entry.secret, ID, &[7; 32]).is_err());
    assert!(
        encryption::decrypt_bytes(
            &entry.secret,
            &format!("dns-connection:{USER}:v1"),
            &[7; 32]
        )
        .is_err()
    );
    task.abort();
}
#[tokio::test]
async fn routes_require_bearer_even_without_controller_token_and_reject_oversize() {
    use crate::{
        runtime::{ProxyRuntime, RuntimeSettings},
        server::{AppState, app_with_state},
    };
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    let runtime = ProxyRuntime::new(RuntimeSettings::new(directory(), 8080), None);
    let app = app_with_state(AppState::new(runtime.clone(), None));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/internal/v1/dns/connections")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    let token = crate::config::Config::from_values(
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
    let app = app_with_state(AppState::new(runtime, Some(token)));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/internal/v1/dns/connections")
                .header("authorization", "Bearer 0123456789abcdef0123456789abcdef")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/v1/dns/connections/test")
                .header("authorization", "Bearer 0123456789abcdef0123456789abcdef")
                .body(Body::from("a".repeat(32769)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    assert_eq!(&body[..], b"{\"error\":\"invalid_input\"}");
}

#[test]
fn strict_validation_rejects_bad_ids_names_tokens_and_reference_shapes() {
    assert!(validation::name(&"😀".repeat(50)).is_ok());
    assert!(validation::name(&"😀".repeat(51)).is_err());
    for name in ["", " padded", "line\nname", "hidden\u{200b}name"] {
        assert!(validation::name(name).is_err());
    }
    for token in ["", "has space", "line\nbreak", "ümlaut"] {
        assert!(validation::token(token).is_err());
    }
    assert!(validation::token(&"x".repeat(512)).is_ok());
    assert!(validation::token(&"x".repeat(513)).is_err());
    assert!(validation::id(&ID.to_uppercase()).is_err());
    assert!(validation::selection(&vec![zone_id('a'); 51], false).is_err());
    assert!(validation::selection(&[zone_id('a'), zone_id('a')], false).is_err());
    assert!(serde_json::from_value::<Reference>(serde_json::json!({"connectionId":ID,"zoneId":zone_id('a'),"consumer":{"type":"dns01","id":USER,"extra":"rejected"}})).is_err());
}

#[tokio::test]
async fn failures_preserve_state_and_clock_rollback_keeps_timestamp_order() {
    let (store, task, status) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    let mut missing_zone = request(1);
    missing_zone.zone_ids = vec![zone_id('c')];
    assert!(matches!(
        store.save(ID.into(), missing_zone).await,
        Err(Error::ZoneNotPermitted)
    ));
    let mut duplicate = request(0);
    duplicate.name = "CLOUDFLARE PRIMARY".into();
    assert!(matches!(
        store.save(USER.into(), duplicate).await,
        Err(Error::ConnectionConflict)
    ));
    status.store(429, Ordering::SeqCst);
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::ProviderRateLimited)
    ));
    status.store(503, Ordering::SeqCst);
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::ProviderUnavailable)
    ));
    status.store(200, Ordering::SeqCst);
    // A hostile replacement cannot make the store publish an unpersisted revision.
    let bytes = state_dir(&store.path)
        .unwrap()
        .read_file(FILE, MAX_BYTES)
        .unwrap();
    let target = store.path.join(FILE);
    std::fs::remove_file(&target).unwrap();
    std::fs::create_dir(&target).unwrap();
    assert!(matches!(
        store.save(ID.into(), request(1)).await,
        Err(Error::StoreUnavailable)
    ));
    assert!(matches!(store.list().await, Err(Error::StoreUnavailable)));
    std::fs::remove_dir(&target).unwrap();
    state_dir(&store.path)
        .unwrap()
        .atomic_write(FILE, &bytes)
        .unwrap();
    assert_eq!(store.list().await.unwrap()[0].revision, 1);
    {
        let mut state = store.lock().await.unwrap();
        let registry = Store::registry(&mut state).unwrap();
        registry.connections[0].metadata.updated_at = "2099-01-01T00:00:00Z".into();
        store.persist(registry).unwrap();
    }
    let updated = store.save(ID.into(), request(1)).await.unwrap();
    assert_eq!(updated.updated_at, "2099-01-01T00:00:00Z");
    let mut wrong_key = Store::new(store.path.clone());
    wrong_key.key = Some([8; 32]);
    assert!(matches!(
        wrong_key
            .test(TestRequest {
                connection_id: Some(ID.into()),
                api_token: None,
                zone_ids: None
            })
            .await,
        Err(Error::CredentialsUnavailable)
    ));
    task.abort();
}

#[tokio::test]
async fn reference_added_during_provider_validation_prevents_zone_removal() {
    let (store, task, _) = fixture().await;
    store.save(ID.into(), request(0)).await.unwrap();
    let mut update = request(1);
    update.zone_ids = vec![zone_id('b')];
    let (result, ()) = tokio::join!(biased;
        store.save(ID.into(), update),
        async {
            let mut state = store.lock().await.unwrap();
            let registry = Store::registry(&mut state).unwrap();
            registry.connections[0].metadata.references.push(Usage {
                zone_id: zone_id('a'),
                consumer: Consumer { r#type: ConsumerType::Dns01, id: USER.into() },
            });
            store.persist(registry).unwrap();
        }
    );
    assert!(matches!(result, Err(Error::ConnectionInUse)));
    let metadata = store.list().await.unwrap().remove(0);
    assert_eq!(metadata.revision, 1);
    assert_eq!(metadata.zones.len(), 2);
    assert_eq!(metadata.references.len(), 1);
    task.abort();
}
