use super::*;
use crate::runtime::dns_connections::{
    Consumer, ConsumerType, Reference, SaveRequest, models::ConnectionStatus,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
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
use tokio::sync::{Mutex, Notify};

const ID: &str = "0198d98a-0000-7000-8000-000000000091";
const USER: &str = "0198d98a-0000-7000-8000-000000000092";
const ZONE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECOND_ZONE: &str = "cccccccccccccccccccccccccccccccc";
const UNRELATED: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

#[derive(Default)]
struct Api {
    records: Mutex<BTreeMap<String, Value>>,
    sequence: AtomicUsize,
    deny_write: AtomicBool,
    fail_cleanup: AtomicBool,
    cleanup_exemption: Mutex<Option<String>>,
    pause_create: AtomicBool,
    created: Notify,
    resume: Notify,
}

struct Fixture {
    store: Arc<Store>,
    api: Arc<Api>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn envelope(result: Value) -> Json<Value> {
    Json(
        json!({ "success": true, "result": result, "result_info": {"page":1,"per_page":100,"total_pages":1} }),
    )
}

async fn fixture() -> Fixture {
    let api = Arc::new(Api::default());
    api.records.lock().await.insert(UNRELATED.into(), json!({"id":UNRELATED,"type":"TXT","name":"_acme-challenge.keep.example.com","content":"keep-me","comment":null}));
    let router = Router::new()
        .route("/zones", get(|| async { Json(json!({"success":true,"result":[{"id":ZONE,"name":"example.com"},{"id":SECOND_ZONE,"name":"example.org"}],"result_info":{"page":1,"per_page":20,"total_pages":1}})) }))
        .route("/zones/{zone}", get(|Path(zone): Path<String>| async move { let name = if zone == ZONE { "example.com" } else { "example.org" }; envelope(json!({"id":zone,"name":name})) }))
        .route("/zones/{zone}/dns_records", get(|State(api): State<Arc<Api>>, Query(query): Query<BTreeMap<String, String>>| async move {
            let records = api.records.lock().await.values().filter(|record| {
                query.get("name").is_none_or(|name| record["name"].as_str() == Some(name))
            }).cloned().collect::<Vec<_>>();
            envelope(json!(records))
        }).post(|State(api): State<Arc<Api>>, Json(body): Json<Value>| async move {
            if api.deny_write.load(Ordering::SeqCst) { return (StatusCode::FORBIDDEN, envelope(Value::Null)); }
            assert_eq!(body["type"], "TXT");
            assert!(body["name"].as_str().unwrap().starts_with("_acme-challenge.rp-verify-"));
            assert!(body["comment"].as_str().unwrap().starts_with("rentnerproxy-acme:"));
            let id = format!("{:032x}", api.sequence.fetch_add(1, Ordering::SeqCst) + 1);
            let record = json!({"id":id,"name":body["name"],"type":"TXT","content":body["content"],"comment":body["comment"]});
            api.records.lock().await.insert(id, record.clone());
            api.created.notify_one();
            if api.pause_create.load(Ordering::SeqCst) { api.resume.notified().await; }
            (StatusCode::OK, envelope(record))
        }))
        .route("/zones/{zone}/dns_records/{id}", axum::routing::delete(|State(api): State<Arc<Api>>, Path((_zone,id)): Path<(String,String)>| async move {
            assert_ne!(id, UNRELATED, "verification must never delete unrelated TXT values");
            if api.fail_cleanup.load(Ordering::SeqCst) && api.cleanup_exemption.lock().await.as_deref() != Some(&id) { return (StatusCode::SERVICE_UNAVAILABLE, envelope(Value::Null)); }
            api.records.lock().await.remove(&id);
            (StatusCode::OK, envelope(json!({"id":id})))
        }))
        .with_state(Arc::clone(&api));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let mut store = Store::new(crate::runtime::dns_connections::tests::directory());
    store.key = Some([7; 32]);
    store.endpoint = Some(format!("http://{address}/"));
    store
        .save(
            ID.into(),
            SaveRequest {
                provider: None,
                expected_revision: 0,
                name: "Cloudflare".into(),
                api_token: Some("fixture-token".into()),
                zone_ids: vec![ZONE.into()],
                actor_user_id: USER.into(),
            },
        )
        .await
        .unwrap();
    Fixture {
        store: Arc::new(store),
        api,
        task,
    }
}

fn usage() -> Reference {
    Reference {
        connection_id: ID.into(),
        zone_id: ZONE.into(),
        consumer: Consumer {
            r#type: ConsumerType::Dns01,
            id: USER.into(),
        },
    }
}

#[tokio::test]
async fn verification_proves_write_and_cleanup_without_touching_unrelated_records() {
    let fixture = fixture().await;
    assert_eq!(
        fixture.store.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Untested
    );
    assert!(matches!(
        fixture
            .store
            .certificate_references(&[usage()], true, true)
            .await,
        Err(Error::ProviderUnauthorized)
    ));
    let checked = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(checked.verification.status, ConnectionStatus::Connected);
    assert!(checked.verified_for(ZONE));
    assert_eq!(fixture.api.records.lock().await.len(), 1);
    fixture
        .store
        .certificate_references(&[usage()], true, true)
        .await
        .unwrap();
    assert!(matches!(
        fixture.store.delete(ID, 1).await,
        Err(Error::ConnectionInUse)
    ));
    let config = DnsProviderConfig::Connection {
        provider: super::super::ProviderId::Cloudflare,
        connection_id: ID.into(),
        zone_id: ZONE.into(),
    };
    assert_eq!(
        fixture
            .store
            .resolve_config(&config)
            .await
            .unwrap()
            .credential()
            .unwrap()
            .1,
        "fixture-token"
    );
    let bytes = super::super::state_dir(&fixture.store.path)
        .unwrap()
        .read_file(super::super::FILE, super::super::MAX_BYTES)
        .unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("fixture-token"));
    assert!(
        !serde_json::to_string(&checked)
            .unwrap()
            .contains("fixture-token")
    );
    assert!(
        fixture
            .store
            .matching_connection(&DnsProviderConfig::Cloudflare {
                zone_id: ZONE.into(),
                api_token: "fixture-token".into()
            })
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn zone_read_access_alone_cannot_claim_connected_or_bind_a_certificate() {
    let fixture = fixture().await;
    fixture.api.deny_write.store(true, Ordering::SeqCst);
    let checked = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(checked.verification.status, ConnectionStatus::Disconnected);
    assert_eq!(
        checked.verification.error,
        Some(Error::ProviderUnauthorized)
    );
    assert!(checked.verification.zone_ids.is_empty());
    assert!(matches!(
        fixture
            .store
            .certificate_references(&[usage()], true, true)
            .await,
        Err(Error::ProviderUnauthorized)
    ));
    assert_eq!(fixture.api.records.lock().await.len(), 1);
}

#[tokio::test]
async fn denied_multizone_checks_leave_no_unattempted_cleanup_reservations() {
    let fixture = fixture().await;
    fixture
        .store
        .save(
            ID.into(),
            SaveRequest {
                provider: None,
                expected_revision: 1,
                name: "Two zones".into(),
                api_token: None,
                zone_ids: vec![ZONE.into(), SECOND_ZONE.into()],
                actor_user_id: USER.into(),
            },
        )
        .await
        .unwrap();
    fixture.api.deny_write.store(true, Ordering::SeqCst);
    assert_eq!(
        fixture
            .store
            .verify(ID, 2)
            .await
            .unwrap()
            .verification
            .status,
        ConnectionStatus::Disconnected
    );
    fixture.store.delete(ID, 2).await.unwrap();
    assert_eq!(fixture.api.records.lock().await.len(), 1);
}

#[tokio::test]
async fn failed_cleanup_is_journaled_and_recovered_after_restart() {
    let fixture = fixture().await;
    fixture.api.fail_cleanup.store(true, Ordering::SeqCst);
    let checked = fixture.store.verify(ID, 1).await.unwrap();
    assert_eq!(checked.verification.status, ConnectionStatus::Failed);
    assert_eq!(fixture.api.records.lock().await.len(), 2);
    assert!(matches!(
        fixture.store.delete(ID, 1).await,
        Err(Error::ConnectionInUse)
    ));
    let mut restarted = Store::new(fixture.store.path.clone());
    restarted.key = fixture.store.key;
    restarted.endpoint = fixture.store.endpoint.clone();
    fixture.api.fail_cleanup.store(false, Ordering::SeqCst);
    restarted.recover_permission_checks().await;
    assert_eq!(fixture.api.records.lock().await.len(), 1);
    assert_eq!(
        restarted.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Failed
    );
    assert_eq!(
        restarted.verify(ID, 1).await.unwrap().verification.status,
        ConnectionStatus::Connected
    );
}

#[tokio::test]
async fn cancelled_check_keeps_cleanup_intent_and_never_persists_connected() {
    let fixture = fixture().await;
    fixture.api.pause_create.store(true, Ordering::SeqCst);
    let store = Arc::clone(&fixture.store);
    let check = tokio::spawn(async move { store.verify(ID, 1).await });
    tokio::time::timeout(Duration::from_secs(3), fixture.api.created.notified())
        .await
        .unwrap();
    check.abort();
    let _ = check.await;
    fixture.api.pause_create.store(false, Ordering::SeqCst);
    fixture.api.resume.notify_one();
    fixture.store.recover_permission_checks().await;
    assert_eq!(fixture.api.records.lock().await.len(), 1);
    assert_ne!(
        fixture.store.list().await.unwrap()[0].verification.status,
        ConnectionStatus::Connected
    );
}

#[tokio::test]
async fn rotation_keeps_references_but_requires_a_fresh_check_and_resolves_after_restart() {
    let fixture = fixture().await;
    fixture.store.verify(ID, 1).await.unwrap();
    fixture
        .store
        .certificate_references(&[usage()], true, true)
        .await
        .unwrap();
    let shared = DnsProviderConfig::Connection {
        provider: super::super::ProviderId::Cloudflare,
        connection_id: ID.into(),
        zone_id: ZONE.into(),
    };
    let rotated = fixture
        .store
        .save(
            ID.into(),
            SaveRequest {
                provider: None,
                expected_revision: 1,
                name: "Rotated account".into(),
                api_token: Some("replacement-fixture-token".into()),
                zone_ids: vec![ZONE.into()],
                actor_user_id: USER.into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(rotated.verification.status, ConnectionStatus::Untested);
    assert_eq!(rotated.references.len(), 1);
    assert!(matches!(
        fixture
            .store
            .certificate_references(&[usage()], true, true)
            .await,
        Err(Error::ProviderUnauthorized)
    ));
    // Existing renewals resolve the current secret while new admission remains gated.
    assert_eq!(
        fixture
            .store
            .resolve_config(&shared)
            .await
            .unwrap()
            .credential()
            .unwrap()
            .1,
        "replacement-fixture-token"
    );
    let mut restarted = Store::new(fixture.store.path.clone());
    restarted.key = fixture.store.key;
    restarted.endpoint = fixture.store.endpoint.clone();
    assert_eq!(
        restarted
            .resolve_config(&shared)
            .await
            .unwrap()
            .credential()
            .unwrap()
            .1,
        "replacement-fixture-token"
    );
    assert!(matches!(
        restarted.delete(ID, 2).await,
        Err(Error::ConnectionInUse)
    ));
    assert_eq!(
        restarted.verify(ID, 2).await.unwrap().verification.status,
        ConnectionStatus::Connected
    );
    restarted
        .certificate_references(&[], false, false)
        .await
        .unwrap();
    restarted.delete(ID, 2).await.unwrap();
}

#[test]
fn certificate_connections_migrate_only_idle_matching_credentials_and_reconcile_usage() {
    use base64::Engine as _;
    const CHILD: &str = "RENTNERPROXY_CONNECTION_MIGRATION_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "runtime::dns_connections::verification::tests::certificate_connections_migrate_only_idle_matching_credentials_and_reconcile_usage", "--nocapture"])
            .env(CHILD, "1")
            .env("APP_ENCRYPTION_KEY", base64::engine::general_purpose::STANDARD.encode([7_u8; 32]))
            .env_remove("APP_ENCRYPTION_KEY_FILE").output().unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            use crate::runtime::{
                ProxyRuntime, RuntimeSettings,
                certificates::{
                    AcmeChallengeType, CertificateEnvironment, CertificateIssueRequest,
                    DnsValidationMode,
                },
            };
            let fixture = fixture().await;
            fixture.store.verify(ID, 1).await.unwrap();
            let mut runtime =
                ProxyRuntime::new(RuntimeSettings::new(fixture.store.path.clone(), 0), None);
            Arc::get_mut(&mut runtime).unwrap().dns_connections =
                Store::fixture(fixture.store.path.clone(), fixture.store.endpoint().into());
            runtime.certificate_store.initialize().await.unwrap();
            let legacy = DnsProviderConfig::Cloudflare {
                zone_id: ZONE.into(),
                api_token: "fixture-token".into(),
            };
            let request = CertificateIssueRequest {
                domains: vec!["example.com".into(), "*.example.com".into()],
                environment: CertificateEnvironment::Staging,
                contact_email: None,
                challenge_type: AcmeChallengeType::Dns01,
                dns_mode: DnsValidationMode::Provider,
                dns_provider: Some(legacy.clone()),
                accept_terms: true,
            };
            runtime
                .certificate_store
                .begin_issue(USER, request.clone(), false)
                .await
                .unwrap();
            runtime.reconcile_provider_connections().await.unwrap();
            assert_eq!(
                runtime
                    .certificate_store
                    .dns_configurations()
                    .await
                    .unwrap()[0]
                    .1,
                legacy
            );
            runtime
                .certificate_store
                .finish_failed(USER, CertificateError::AcmeFailed)
                .await;
            runtime.reconcile_provider_connections().await.unwrap();
            let shared = runtime
                .certificate_store
                .dns_configurations()
                .await
                .unwrap()[0]
                .1
                .clone();
            assert_eq!(shared.connection().unwrap().1, ID);
            assert_eq!(
                runtime.dns_connections.list().await.unwrap()[0]
                    .references
                    .len(),
                1
            );
            assert!(matches!(
                runtime.dns_connections.delete(ID, 1).await,
                Err(Error::ConnectionInUse)
            ));
            let mut selected = request;
            selected.dns_provider = Some(shared.clone());
            runtime
                .reserve_certificate_connection(USER, &selected)
                .await
                .unwrap();
            selected.domains.push("unrelated-example.com".into());
            assert_eq!(
                runtime
                    .reserve_certificate_connection(USER, &selected)
                    .await,
                Err(CertificateError::DnsProviderInvalid)
            );
            runtime
                .certificate_store
                .delete_if_unused(USER, false)
                .await
                .unwrap();
            runtime.reconcile_provider_connections().await.unwrap();
            assert!(
                runtime.dns_connections.list().await.unwrap()[0]
                    .references
                    .is_empty()
            );
            runtime.dns_connections.delete(ID, 1).await.unwrap();
        });
}

#[tokio::test]
async fn recovery_reaches_later_accounts_despite_repeated_failures_in_the_first_batch() {
    let fixture = fixture().await;
    fixture.api.fail_cleanup.store(true, Ordering::SeqCst);
    for number in 91..=95 {
        let id = format!("0198d98a-0000-7000-8000-{number:012}");
        if number != 91 {
            fixture
                .store
                .save(
                    id.clone(),
                    SaveRequest {
                        provider: None,
                        expected_revision: 0,
                        name: format!("Account {number}"),
                        api_token: Some("fixture-token".into()),
                        zone_ids: vec![ZONE.into()],
                        actor_user_id: USER.into(),
                    },
                )
                .await
                .unwrap();
        }
        assert_eq!(
            fixture
                .store
                .verify(&id, 1)
                .await
                .unwrap()
                .verification
                .status,
            ConnectionStatus::Failed
        );
    }
    let last = "rentnerproxy-acme:0198d98a-0000-7000-8000-000000000095";
    let exempt = fixture
        .api
        .records
        .lock()
        .await
        .iter()
        .find(|(_, record)| record["comment"] == last)
        .unwrap()
        .0
        .clone();
    *fixture.api.cleanup_exemption.lock().await = Some(exempt.clone());
    fixture.store.recover_permission_checks().await;
    assert!(fixture.api.records.lock().await.contains_key(&exempt));
    fixture.store.recover_permission_checks().await;
    let records = fixture.api.records.lock().await;
    assert!(!records.contains_key(&exempt));
    assert!(records.contains_key(UNRELATED));
    assert_eq!(records.len(), 5);
}
