use super::*;
use crate::runtime::{
    certificates::DnsValidationMode,
    dns::{DnsDelegationBinding, DnsProviderConfig, capabilities::ProviderId},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
};
use base64::Engine as _;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::{
    net::TcpListener,
    sync::{Mutex, Notify, Semaphore},
    task::JoinHandle,
};

const ZONE: &str = "0123456789abcdef0123456789abcdef";
const TARGET: &str = "order.validation.example.net";

fn isolated(test: &str) -> bool {
    const CHILD: &str = "RENTNERPROXY_DELEGATED_LIFECYCLE_CHILD";
    if std::env::var_os(CHILD).is_some() {
        return true;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("runtime::acme::tests::delegated_lifecycle::{test}"),
            "--nocapture",
        ])
        .env(CHILD, "1")
        .env(
            "APP_ENCRYPTION_KEY",
            base64::engine::general_purpose::STANDARD.encode([7_u8; 32]),
        )
        .env_remove("APP_ENCRYPTION_KEY_FILE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "isolated delegated lifecycle failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    false
}

struct FixtureState {
    uncertain: AtomicBool,
    fail_reads: AtomicBool,
    fail_deletes: AtomicBool,
    records: Mutex<Vec<Value>>,
    pending: Mutex<Option<Value>>,
    post_started: Notify,
    release_post: Semaphore,
    writes: AtomicUsize,
    deleted: Mutex<Vec<String>>,
}

struct Fixture {
    state: Arc<FixtureState>,
    endpoint: String,
    task: JoinHandle<()>,
}

impl Fixture {
    async fn new(uncertain: bool, intent: &DnsRecordIntent) -> Self {
        let state = Arc::new(FixtureState {
            uncertain: AtomicBool::new(uncertain),
            fail_reads: AtomicBool::new(false),
            fail_deletes: AtomicBool::new(false),
            records: Mutex::new(vec![
                json!({"id":"unrelated-txt","type":"TXT","name":TARGET,"content":"another-orders-value","comment":intent.marker}),
                json!({"id":"delegation-cname","type":"CNAME","name":"_acme-challenge.example.com","content":TARGET}),
            ]),
            pending: Mutex::new(None),
            post_started: Notify::new(),
            release_post: Semaphore::new(0),
            writes: AtomicUsize::new(0),
            deleted: Mutex::new(Vec::new()),
        });
        let router = Router::new()
            .route(
                "/zones/{zone}",
                get(|| async {
                    Json(json!({"success":true,"result":{"id":ZONE,"name":"example.net"}}))
                }),
            )
            .route(
                "/zones/{zone}/dns_records",
                get(list_records).post(create_record),
            )
            .route("/zones/{zone}/dns_records/{record}", delete(delete_record))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            state,
            endpoint,
            task,
        }
    }

    fn provider(&self) -> DnsProvider {
        DnsProvider::for_connection_check(
            DnsProviderConfig::Cloudflare {
                zone_id: ZONE.to_owned(),
                api_token: "synthetic-fixture-token".to_owned(),
            },
            &self.endpoint,
        )
        .unwrap()
    }

    async fn commit_late_write(&self) {
        let record = self.state.pending.lock().await.take().unwrap();
        self.state.records.lock().await.push(record);
    }

    async fn assert_only_order_value_was_deleted(&self) {
        assert_eq!(
            *self.state.deleted.lock().await,
            vec!["owned-record".to_owned()]
        );
        let remaining = self.state.records.lock().await;
        assert_eq!(remaining.len(), 2);
        assert!(
            remaining
                .iter()
                .any(|record| record["id"] == "unrelated-txt")
        );
        assert!(
            remaining
                .iter()
                .any(|record| record["id"] == "delegation-cname")
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn list_records(State(state): State<Arc<FixtureState>>) -> (StatusCode, Json<Value>) {
    if state.fail_reads.load(Ordering::Relaxed) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success":false,"result":null,"errors":[]})),
        );
    }
    (
        StatusCode::OK,
        Json(
            json!({"success":true,"result":state.records.lock().await.clone(),"result_info":{"page":1,"total_pages":1}}),
        ),
    )
}

async fn create_record(
    State(state): State<Arc<FixtureState>>,
    Json(mut body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let sequence = state.writes.fetch_add(1, Ordering::Relaxed) + 1;
    body["id"] = if sequence == 1 {
        json!("owned-record")
    } else {
        json!(format!("owned-record-{sequence}"))
    };
    state.post_started.notify_one();
    if state.uncertain.load(Ordering::Relaxed) {
        *state.pending.lock().await = Some(body);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success":false,"result":null,"errors":[]})),
        );
    }
    let permit = state.release_post.acquire().await.unwrap();
    permit.forget();
    // A later successful order must not overwrite an earlier delayed mutation.
    state.records.lock().await.push(body.clone());
    (StatusCode::OK, Json(json!({"success":true,"result":body})))
}

async fn delete_record(
    State(state): State<Arc<FixtureState>>,
    Path((_, id)): Path<(String, String)>,
) -> (StatusCode, Json<Value>) {
    if state.fail_deletes.load(Ordering::Relaxed) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success":false,"result":null,"errors":[]})),
        );
    }
    state.deleted.lock().await.push(id.clone());
    state
        .records
        .lock()
        .await
        .retain(|record| record["id"] != id);
    (
        StatusCode::OK,
        Json(json!({"success":true,"result":{"id":id}})),
    )
}
fn intent() -> DnsRecordIntent {
    DnsRecordIntent::new(ID, "example.com", "synthetic-delegated-proof")
        .unwrap()
        .with_delegation(DnsDelegationBinding {
            original_owner: "_acme-challenge.example.com".to_owned(),
            target_owner: TARGET.to_owned(),
            zone_name: "example.net".to_owned(),
            cname_chain: vec!["_acme-challenge.example.com".to_owned(), TARGET.to_owned()],
        })
        .unwrap()
}

fn delegated_request() -> CertificateIssueRequest {
    let mut request = request();
    request.challenge_type = AcmeChallengeType::Dns01;
    request.dns_mode = DnsValidationMode::Delegated;
    request.dns_provider = Some(DnsProviderConfig::Connection {
        provider: ProviderId::Cloudflare,
        connection_id: "0198d98a-0000-7000-8000-000000000199".to_owned(),
        zone_id: ZONE.to_owned(),
    });
    request
}

async fn begin_delegated(runtime: &ProxyRuntime) -> String {
    let request = delegated_request();
    runtime
        .certificate_store
        .begin_issue(ID, request, false)
        .await
        .unwrap()
        .current_operation
        .unwrap()
        .id
}

#[test]
fn cancellation_waits_for_accepted_provider_post_then_cleans_its_committed_value() {
    if !isolated("cancellation_waits_for_accepted_provider_post_then_cleans_its_committed_value") {
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let runtime = runtime().await;
            let operation_id = begin_delegated(&runtime).await;
            let proof = intent();
            let fixture = Fixture::new(false, &proof).await;
            let provider = fixture.provider();
            let write_runtime = runtime.clone();
            let write_provider = provider.clone();
            let write = tokio::spawn(async move {
                let mut intents = Vec::new();
                let result = super::super::delegated::present(
                    &write_runtime.certificate_store,
                    ID,
                    &write_provider,
                    &mut intents,
                    proof,
                )
                .await;
                (result, intents)
            });
            timeout(
                Duration::from_secs(3),
                fixture.state.post_started.notified(),
            )
            .await
            .unwrap();
            runtime
                .certificate_store
                .request_delegated_cancel(ID, &operation_id)
                .await
                .unwrap();
            assert!(
                !write.is_finished(),
                "accepted provider write must settle before cancellation finishes"
            );
            let pending = runtime
                .certificate_store
                .pending_dns_records(ID)
                .await
                .unwrap();
            assert_eq!(pending.len(), 1);
            assert!(pending[0].unconfirmed_write);
            assert!(fixture.state.deleted.lock().await.is_empty());
            fixture.state.release_post.add_permits(1);
            let (result, intents) = timeout(Duration::from_secs(3), write)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result, Err(CertificateError::AcmeCancelled));
            assert_eq!(intents.len(), 1);
            assert!(!intents[0].unconfirmed_write);
            assert_eq!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap(),
                intents
            );
            runtime
                .certificate_store
                .finish_failed(ID, CertificateError::AcmeCancelled)
                .await;
            runtime
                .cleanup_dns_challenges(ID, &provider, &intents)
                .await
                .unwrap();
            assert!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 1);
            fixture.assert_only_order_value_was_deleted().await;
        });
}

#[test]
fn uncertain_provider_write_retains_authority_until_late_commit_can_be_cleaned() {
    if !isolated("uncertain_provider_write_retains_authority_until_late_commit_can_be_cleaned") {
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let runtime = runtime().await;
            begin_delegated(&runtime).await;
            let proof = intent();
            let fixture = Fixture::new(true, &proof).await;
            let provider = fixture.provider();
            let mut intents = Vec::new();
            assert_eq!(
                super::super::delegated::present(
                    &runtime.certificate_store,
                    ID,
                    &provider,
                    &mut intents,
                    proof
                )
                .await,
                Err(CertificateError::DnsProviderUnavailable)
            );
            assert_eq!(intents.len(), 1);
            assert!(intents[0].unconfirmed_write);
            assert_eq!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap(),
                intents
            );
            assert_eq!(
                runtime
                    .cleanup_dns_challenges(ID, &provider, &intents)
                    .await,
                Err(CertificateError::DnsCleanupFailed)
            );
            assert_eq!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap(),
                intents
            );
            assert!(fixture.state.deleted.lock().await.is_empty());
            fixture.commit_late_write().await;
            runtime
                .cleanup_dns_challenges(ID, &provider, &intents)
                .await
                .unwrap();
            assert!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 1);
            fixture.assert_only_order_value_was_deleted().await;
        });
}

#[test]
fn unknown_write_allows_later_proof_cleanup_and_survives_restart_until_late_commit() {
    if !isolated("unknown_write_allows_later_proof_cleanup_and_survives_restart_until_late_commit")
    {
        return;
    }
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        let runtime = runtime().await;
        begin_delegated(&runtime).await;
        let proof = intent();
        let fixture = Fixture::new(true, &proof).await;
        let provider = fixture.provider();
        let mut journal = Vec::new();
        assert_eq!(super::super::delegated::present(&runtime.certificate_store, ID, &provider, &mut journal, proof).await,
            Err(CertificateError::DnsProviderUnavailable));
        let retained = journal.clone();
        assert!(retained[0].unconfirmed_write);

        // Nothing ever committed for the old value, but a new stored attempt
        // must retain its cleanup authority without blocking new proof work.
        let mut journal = runtime.prepare_dns_challenges(ID, &delegated_request(), Some(&provider)).await.unwrap();
        assert_eq!(journal, retained);
        fixture.state.uncertain.store(false, Ordering::Relaxed);
        fixture.state.release_post.add_permits(1);
        let mut newer = intent();
        newer.value = "newer-stored-attempt-proof".to_owned();
        super::super::delegated::present(&runtime.certificate_store, ID, &provider, &mut journal, newer.clone()).await.unwrap();
        assert_eq!(journal.len(), 2);
        assert_eq!(journal[0], retained[0]);
        assert_eq!(journal[1], newer);
        assert_eq!(runtime.certificate_store.pending_dns_records(ID).await.unwrap(), journal);
        assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 2);

        // Cleanup skips the unknown empty entry and still clears the later
        // exact value. It reports the residual rather than dropping authority.
        assert_eq!(runtime.cleanup_dns_challenges(ID, &provider, &journal).await,
            Err(CertificateError::DnsCleanupFailed));
        assert_eq!(*fixture.state.deleted.lock().await, vec!["owned-record-2".to_owned()]);
        assert_eq!(runtime.certificate_store.pending_dns_records(ID).await.unwrap(), retained);
        let restarted = ProxyRuntime::new(runtime.settings.clone(), None);
        restarted.certificate_store.initialize().await.unwrap();
        assert_eq!(restarted.certificate_store.pending_dns_records(ID).await.unwrap(), retained);

        // The original provider mutation can still land after restart. Its
        // retained value/marker binding remains sufficient for exact cleanup.
        fixture.commit_late_write().await;
        restarted.cleanup_dns_challenges(ID, &provider, &retained).await.unwrap();
        assert!(restarted.certificate_store.pending_dns_records(ID).await.unwrap().is_empty());
        assert_eq!(*fixture.state.deleted.lock().await, vec!["owned-record-2".to_owned(), "owned-record".to_owned()]);
        let remaining = fixture.state.records.lock().await;
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|record| record["id"] == "unrelated-txt" && record["content"] == "another-orders-value"));
        assert!(remaining.iter().any(|record| record["id"] == "delegation-cname" && record["content"] == TARGET));
    });
}

#[test]
fn retained_unknown_limit_accepts_128_and_rejects_129_without_eviction() {
    if !isolated("retained_unknown_limit_accepts_128_and_rejects_129_without_eviction") {
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            for count in [128, 129] {
                let runtime = runtime().await;
                begin_delegated(&runtime).await;
                let fixture = Fixture::new(true, &intent()).await;
                let provider = fixture.provider();
                let journal: Vec<_> = (0..count)
                    .map(|index| {
                        let mut record = intent();
                        record.value = format!("never-committed-proof-{index}");
                        record.unconfirmed_write = true;
                        record
                    })
                    .collect();
                runtime
                    .certificate_store
                    .set_pending_dns_records(ID, journal.clone())
                    .await
                    .unwrap();
                let prepared = runtime
                    .prepare_dns_challenges(ID, &delegated_request(), Some(&provider))
                    .await;
                if count == 128 {
                    assert_eq!(prepared.unwrap(), journal);
                } else {
                    assert_eq!(prepared, Err(CertificateError::DnsCleanupFailed));
                }
                assert_eq!(
                    runtime
                        .certificate_store
                        .pending_dns_records(ID)
                        .await
                        .unwrap(),
                    journal
                );
                assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 0);
                assert!(fixture.state.deleted.lock().await.is_empty());
            }
        });
}

#[test]
fn unrelated_read_or_confirmed_cleanup_failure_blocks_later_attempt() {
    if !isolated("unrelated_read_or_confirmed_cleanup_failure_blocks_later_attempt") {
        return;
    }
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        for confirmed in [false, true] {
            let runtime = runtime().await;
            begin_delegated(&runtime).await;
            let mut record = intent();
            record.unconfirmed_write = !confirmed;
            let fixture = Fixture::new(true, &record).await;
            let provider = fixture.provider();
            if confirmed {
                fixture.state.records.lock().await.push(json!({"id":"confirmed-record","type":"TXT","name":TARGET,"content":record.value,"comment":record.marker}));
                fixture.state.fail_deletes.store(true, Ordering::Relaxed);
            } else {
                fixture.state.fail_reads.store(true, Ordering::Relaxed);
            }
            let journal = vec![record];
            runtime.certificate_store.set_pending_dns_records(ID, journal.clone()).await.unwrap();
            assert!(runtime.prepare_dns_challenges(ID, &delegated_request(), Some(&provider)).await.is_err());
            assert_eq!(runtime.certificate_store.pending_dns_records(ID).await.unwrap(), journal);
            assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 0);
            assert!(fixture.state.deleted.lock().await.is_empty());
            if confirmed { assert!(fixture.state.records.lock().await.iter().any(|record| record["id"] == "confirmed-record")); }
        }
    });
}

#[test]
fn unresolved_exact_same_proof_is_not_replayed_or_added_to_journal() {
    if !isolated("unresolved_exact_same_proof_is_not_replayed_or_added_to_journal") {
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let runtime = runtime().await;
            begin_delegated(&runtime).await;
            let fixture = Fixture::new(true, &intent()).await;
            let provider = fixture.provider();
            let mut journal = Vec::new();
            assert_eq!(
                super::super::delegated::present(
                    &runtime.certificate_store,
                    ID,
                    &provider,
                    &mut journal,
                    intent()
                )
                .await,
                Err(CertificateError::DnsProviderUnavailable)
            );
            let original = journal.clone();
            assert_eq!(
                super::super::delegated::present(
                    &runtime.certificate_store,
                    ID,
                    &provider,
                    &mut journal,
                    intent()
                )
                .await,
                Err(CertificateError::DnsCleanupFailed)
            );
            assert_eq!(journal, original);
            assert_eq!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap(),
                original
            );
            assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 1);
            assert!(fixture.state.deleted.lock().await.is_empty());
        });
}

#[test]
fn retained_unknowns_do_not_bypass_cleanup_for_direct_dns_mode() {
    if !isolated("retained_unknowns_do_not_bypass_cleanup_for_direct_dns_mode") {
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            let runtime = runtime().await;
            begin_delegated(&runtime).await;
            let fixture = Fixture::new(true, &intent()).await;
            let provider = fixture.provider();
            let mut record = intent();
            record.unconfirmed_write = true;
            let journal = vec![record];
            runtime
                .certificate_store
                .set_pending_dns_records(ID, journal.clone())
                .await
                .unwrap();
            let mut different = delegated_request();
            different.dns_mode = DnsValidationMode::Provider;
            assert_eq!(
                runtime
                    .prepare_dns_challenges(ID, &different, Some(&provider))
                    .await,
                Err(CertificateError::DnsCleanupFailed)
            );
            assert_eq!(
                runtime
                    .certificate_store
                    .pending_dns_records(ID)
                    .await
                    .unwrap(),
                journal
            );
            assert_eq!(fixture.state.writes.load(Ordering::Relaxed), 0);
            assert!(fixture.state.deleted.lock().await.is_empty());
        });
}
