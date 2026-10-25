use super::super::*;
use super::*;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

static COUNTER: AtomicU64 = AtomicU64::new(0);
const ID: &str = "0198d98a-0000-7000-8000-000000000283";
const STALE: &str = "0198d98a-0000-7000-8000-000000000284";

struct Fixture {
    store: CertificateStore,
    directory: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if self.directory.parent() == Some(std::env::temp_dir().as_path())
            && self.directory.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .starts_with("rentnerproxy-manual-dns-storage-")
            })
        {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
}

impl Fixture {
    async fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "rentnerproxy-manual-dns-storage-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let store = CertificateStore::new(directory.clone());
        store.initialize().await.unwrap();
        Self { store, directory }
    }

    async fn begin(&self, active: bool) -> ManualDnsOrder {
        let request = issue_request();
        self.store
            .begin_issue(ID, request.clone(), false)
            .await
            .unwrap();
        if active {
            let leaf = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
            let staged = self
                .store
                .stage_acme(
                    ID,
                    &request,
                    leaf.cert.pem(),
                    leaf.signing_key.serialize_pem(),
                )
                .await
                .unwrap();
            self.store.commit_staged(&staged).await.unwrap();
            self.store.begin_renewal(ID).await.unwrap();
        }
        let operation = self.store.get(ID).await.unwrap().current_operation.unwrap();
        let expires_at = timestamp_after(1);
        ManualDnsOrder {
            version: 1,
            operation_id: operation.id.clone(),
            challenge_set_id: operation.id,
            account_identity: "a".repeat(64),
            order_url: "https://acme.example.com/order/private-order-path".to_owned(),
            expires_at: expires_at.clone(),
            records: vec![
                ManualDnsRecord {
                    identifier: "example.com".to_owned(),
                    owner: "_acme-challenge.example.com".to_owned(),
                    value: "a".repeat(43),
                    expires_at: expires_at.clone(),
                },
                ManualDnsRecord {
                    identifier: "*.example.com".to_owned(),
                    owner: "_acme-challenge.example.com".to_owned(),
                    value: "b".repeat(43),
                    expires_at,
                },
            ],
            phase: ManualDnsPhase::AwaitingInput,
            private_key_pem: None,
            csr_der: None,
            last_checked_at: None,
            last_error_code: None,
        }
    }

    async fn paused(&self, active: bool) -> ManualDnsOrder {
        let order = self.begin(active).await;
        self.store
            .park_manual_dns_order(ID, order.clone())
            .await
            .unwrap();
        order
    }

    async fn snapshot(&self) -> serde_json::Value {
        serde_json::to_value(&*self.store.index.lock().await).unwrap()
    }
}

fn issue_request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned(), "*.example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Dns01,
        dns_mode: DnsValidationMode::Manual,
        dns_provider: None,
        accept_terms: true,
    }
}

fn timestamp_after(hours: i64) -> String {
    (OffsetDateTime::now_utc() + time::Duration::hours(hours))
        .format(&Rfc3339)
        .unwrap()
}

fn action(order: &ManualDnsOrder) -> ManualDnsActionRequest {
    ManualDnsActionRequest {
        operation_id: order.operation_id.clone(),
        challenge_set_id: order.challenge_set_id.clone(),
    }
}

fn with_csr(mut order: ManualDnsOrder, domains: Vec<String>) -> ManualDnsOrder {
    let key = rcgen::KeyPair::generate().unwrap();
    let csr = rcgen::CertificateParams::new(domains)
        .unwrap()
        .serialize_request(&key)
        .unwrap();
    order.private_key_pem = Some(key.serialize_pem());
    order.csr_der = Some(csr.der().to_vec());
    order.phase = ManualDnsPhase::Finalizing;
    order
}

#[tokio::test]
async fn paused_restart_preserves_operation_records_and_accepts_only_one_continuation() {
    let fixture = Fixture::new().await;
    let order = fixture.paused(false).await;
    assert!(!fixture.store.leases.lock().await.contains(ID));
    let restarted = CertificateStore::new(fixture.directory.clone());
    restarted.initialize().await.unwrap();
    let (_, recovered) = restarted.load_manual_dns_order(ID).await.unwrap().unwrap();
    assert_eq!(recovered, order);
    assert_eq!(
        restarted
            .get(ID)
            .await
            .unwrap()
            .current_operation
            .unwrap()
            .id,
        order.operation_id
    );
    let (_, request, checking) = restarted
        .begin_manual_dns_continuation(ID, &action(&order))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(request.dns_mode, DnsValidationMode::Manual);
    assert_eq!(checking.phase, ManualDnsPhase::CheckingDns);
    assert_eq!(checking.records, order.records);
    assert!(
        restarted
            .begin_manual_dns_continuation(ID, &action(&order))
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        restarted.cancel_manual_dns_order(ID, &action(&order)).await,
        Err(CertificateError::OperationInProgress)
    );
    restarted
        .release_manual_dns_for_recovery(ID, &order.operation_id, CertificateError::AcmeFailed)
        .await
        .unwrap();
    let index = restarted.index.lock().await;
    assert_eq!(
        index
            .events
            .iter()
            .filter(|event| event.operation_id == order.operation_id
                && event.kind == CertificateEventKind::OperatorActionRequired)
            .count(),
        1
    );
}

#[tokio::test]
async fn matching_cancel_preserves_active_certificate_and_disables_automatic_renewal() {
    let fixture = Fixture::new().await;
    let order = fixture.paused(true).await;
    let before = fixture.store.get(ID).await.unwrap();
    let cancelled = fixture
        .store
        .cancel_manual_dns_order(ID, &action(&order))
        .await
        .unwrap();
    assert_eq!(cancelled.status, CertificateStatus::Valid);
    assert_eq!(cancelled.operation, CertificateOperation::Idle);
    assert_eq!(cancelled.fingerprint, before.fingerprint);
    assert_eq!(cancelled.expires_at, before.expires_at);
    assert_eq!(
        cancelled.current_operation.unwrap().stage,
        CertificateOperationStage::Cancelled
    );
    assert!(cancelled.next_attempt_at.is_none());
    assert!(!fixture.store.renewal_is_allowed(ID).await);
    assert!(
        fixture
            .store
            .pending_manual_dns_resume_ids()
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        fixture.store.begin_acme_retry(ID).await.unwrap_err(),
        CertificateError::OperationInProgress
    );
    let restarted = CertificateStore::new(fixture.directory.clone());
    restarted.initialize().await.unwrap();
    assert_eq!(
        restarted.get(ID).await.unwrap().fingerprint,
        before.fingerprint
    );
    assert!(!restarted.renewal_is_allowed(ID).await);
    assert!(!restarted.leases.lock().await.contains(ID));
}

#[tokio::test]
async fn stale_operation_or_challenge_ids_cannot_modify_a_paused_order() {
    let fixture = Fixture::new().await;
    let order = fixture.paused(false).await;
    let before = fixture.snapshot().await;
    for stale in [
        ManualDnsActionRequest {
            operation_id: STALE.to_owned(),
            challenge_set_id: order.challenge_set_id.clone(),
        },
        ManualDnsActionRequest {
            operation_id: order.operation_id.clone(),
            challenge_set_id: STALE.to_owned(),
        },
    ] {
        assert!(
            fixture
                .store
                .begin_manual_dns_continuation(ID, &stale)
                .await
                .is_err()
        );
        assert!(
            fixture
                .store
                .cancel_manual_dns_order(ID, &stale)
                .await
                .is_err()
        );
        assert_eq!(fixture.snapshot().await, before);
        assert!(!fixture.store.leases.lock().await.contains(ID));
    }
    assert_eq!(
        fixture
            .store
            .load_manual_dns_order(ID)
            .await
            .unwrap()
            .unwrap()
            .1,
        order
    );
}

#[tokio::test]
async fn expiry_is_one_shot_and_terminal_cancel_or_complete_cannot_be_overwritten() {
    for terminal in [
        None,
        Some(ManualDnsPhase::Cancelled),
        Some(ManualDnsPhase::Complete),
    ] {
        let fixture = Fixture::new().await;
        let mut order = fixture.begin(false).await;
        order.expires_at = timestamp_after(-1);
        for record in &mut order.records {
            record.expires_at = order.expires_at.clone();
        }
        fixture
            .store
            .park_manual_dns_order(ID, order.clone())
            .await
            .unwrap();
        if terminal == Some(ManualDnsPhase::Cancelled) {
            fixture
                .store
                .cancel_manual_dns_order(ID, &action(&order))
                .await
                .unwrap();
        } else if terminal == Some(ManualDnsPhase::Complete) {
            fixture.store.acquire_lease(ID).await.unwrap();
            let request = issue_request();
            let leaf = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
            let staged = fixture
                .store
                .stage_acme(
                    ID,
                    &request,
                    leaf.cert.pem(),
                    leaf.signing_key.serialize_pem(),
                )
                .await
                .unwrap();
            fixture.store.commit_staged(&staged).await.unwrap();
        }
        fixture.store.expire_manual_dns_orders().await.unwrap();
        fixture.store.expire_manual_dns_orders().await.unwrap();
        let expected_phase = terminal.unwrap_or(ManualDnsPhase::Expired);
        assert_eq!(
            fixture
                .store
                .load_manual_dns_order(ID)
                .await
                .unwrap()
                .unwrap()
                .1
                .phase,
            expected_phase
        );
        let before = fixture.snapshot().await;
        assert_eq!(
            fixture
                .store
                .finish_manual_dns_failed(
                    ID,
                    &order.operation_id,
                    CertificateError::ManualDnsExpired
                )
                .await,
            Err(CertificateError::OperationInProgress)
        );
        assert_eq!(fixture.snapshot().await, before);
        let index = fixture.store.index.lock().await;
        assert_eq!(
            index
                .events
                .iter()
                .filter(|event| event.operation_id == order.operation_id
                    && event.kind == CertificateEventKind::Expired)
                .count(),
            usize::from(terminal.is_none())
        );
        drop(index);
        assert!(!fixture.store.leases.lock().await.contains(ID));
        if terminal.is_none() {
            assert!(!fixture.store.renewal_is_allowed(ID).await);
        }
    }
}

#[tokio::test]
async fn continue_honors_per_certificate_and_account_backoff_but_cancellation_still_works() {
    for account_scope in [false, true] {
        let fixture = Fixture::new().await;
        let order = fixture.paused(false).await;
        let deadline = OffsetDateTime::now_utc() + time::Duration::hours(1);
        if account_scope {
            fixture
                .store
                .defer_acme_account_retry(CertificateEnvironment::Staging, deadline)
                .await
                .unwrap();
        } else {
            fixture.store.defer_acme_retry(ID, deadline).await.unwrap();
        }
        let before = fixture.snapshot().await;
        assert_eq!(
            fixture
                .store
                .begin_manual_dns_continuation(ID, &action(&order))
                .await
                .unwrap_err(),
            CertificateError::OperationInProgress
        );
        assert_eq!(fixture.snapshot().await, before);
        assert!(!fixture.store.leases.lock().await.contains(ID));
        fixture
            .store
            .cancel_manual_dns_order(ID, &action(&order))
            .await
            .unwrap();
        assert_eq!(
            fixture
                .store
                .load_manual_dns_order(ID)
                .await
                .unwrap()
                .unwrap()
                .1
                .phase,
            ManualDnsPhase::Cancelled
        );
    }
}

#[tokio::test]
async fn recovery_reparks_populated_dns_check_and_resumes_empty_preparation_after_backoff() {
    for populated in [false, true] {
        let fixture = Fixture::new().await;
        let mut order = fixture.begin(false).await;
        order.phase = ManualDnsPhase::CheckingDns;
        if !populated {
            order.records.clear();
        }
        fixture
            .store
            .store_manual_dns_order(ID, order.clone())
            .await
            .unwrap();
        fixture
            .store
            .release_manual_dns_for_recovery(ID, &order.operation_id, CertificateError::AcmeFailed)
            .await
            .unwrap();
        let (request, recovered) = fixture
            .store
            .load_manual_dns_order(ID)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(request.dns_mode, DnsValidationMode::Manual);
        assert_eq!(
            recovered.phase,
            if populated {
                ManualDnsPhase::AwaitingInput
            } else {
                ManualDnsPhase::CheckingDns
            }
        );
        assert_eq!(recovered.records, order.records);
        assert!(!fixture.store.leases.lock().await.contains(ID));
        assert!(
            fixture
                .store
                .pending_manual_dns_resume_ids()
                .await
                .unwrap()
                .is_empty()
        );
        fixture
            .store
            .index
            .lock()
            .await
            .certificates
            .get_mut(ID)
            .unwrap()
            .next_attempt_at = Some(timestamp_after(-1));
        assert_eq!(
            fixture.store.pending_manual_dns_resume_ids().await.unwrap(),
            if populated {
                Vec::<String>::new()
            } else {
                vec![ID.to_owned()]
            }
        );
        if populated {
            assert!(
                fixture
                    .store
                    .begin_manual_dns_continuation(ID, &action(&order))
                    .await
                    .unwrap()
                    .is_some()
            );
        } else {
            assert!(
                fixture
                    .store
                    .begin_manual_dns_recovery(ID)
                    .await
                    .unwrap()
                    .is_some()
            );
        }
        fixture.store.release_lease(ID).await;
    }
}

struct BlockIndexWrite {
    index: PathBuf,
    backup: PathBuf,
}
impl BlockIndexWrite {
    fn new(fixture: &Fixture) -> Self {
        let index = fixture
            .directory
            .join("certificates")
            .join(CERTIFICATE_INDEX_FILE);
        let backup = index.with_extension("fixture-backup");
        std::fs::rename(&index, &backup).unwrap();
        std::fs::create_dir(&index).unwrap();
        Self { index, backup }
    }
}
impl Drop for BlockIndexWrite {
    fn drop(&mut self) {
        std::fs::remove_dir(&self.index).unwrap();
        std::fs::rename(&self.backup, &self.index).unwrap();
    }
}

#[tokio::test]
async fn failed_continue_and_cancel_persistence_roll_back_state_and_release_lease() {
    for operation in ["continue", "cancel"] {
        let fixture = Fixture::new().await;
        let order = fixture.paused(false).await;
        let before = fixture.snapshot().await;
        let blocked = BlockIndexWrite::new(&fixture);
        match operation {
            "continue" => assert_eq!(
                fixture
                    .store
                    .begin_manual_dns_continuation(ID, &action(&order))
                    .await
                    .unwrap_err(),
                CertificateError::StoreUnavailable
            ),
            "cancel" => assert_eq!(
                fixture
                    .store
                    .cancel_manual_dns_order(ID, &action(&order))
                    .await
                    .unwrap_err(),
                CertificateError::StoreUnavailable
            ),
            _ => unreachable!(),
        }
        assert_eq!(fixture.snapshot().await, before);
        assert!(!fixture.store.leases.lock().await.contains(ID));
        drop(blocked);
        let restarted = CertificateStore::new(fixture.directory.clone());
        restarted.initialize().await.unwrap();
        assert_eq!(
            restarted
                .load_manual_dns_order(ID)
                .await
                .unwrap()
                .unwrap()
                .1,
            order
        );
        assert!(
            restarted
                .begin_manual_dns_continuation(ID, &action(&order))
                .await
                .unwrap()
                .is_some()
        );
    }
}

#[tokio::test]
async fn failed_park_keeps_the_worker_lease_until_its_error_handler_releases_it() {
    let fixture = Fixture::new().await;
    let order = fixture.paused(false).await;
    fixture.store.acquire_lease(ID).await.unwrap();
    let before = fixture.snapshot().await;
    let blocked = BlockIndexWrite::new(&fixture);
    let mut retry = order.clone();
    retry.last_error_code = Some(CertificateError::ManualDnsNotPropagated.code().to_owned());
    assert_eq!(
        fixture.store.park_manual_dns_order(ID, retry).await,
        Err(CertificateError::StoreUnavailable)
    );
    assert_eq!(fixture.snapshot().await, before);
    assert!(fixture.store.leases.lock().await.contains(ID));
    assert_eq!(
        fixture
            .store
            .begin_manual_dns_continuation(ID, &action(&order))
            .await
            .unwrap_err(),
        CertificateError::OperationInProgress
    );
    drop(blocked);
    fixture
        .store
        .release_manual_dns_for_recovery(
            ID,
            &order.operation_id,
            CertificateError::StoreUnavailable,
        )
        .await
        .unwrap();
    assert!(!fixture.store.leases.lock().await.contains(ID));
    let expected = fixture
        .store
        .load_manual_dns_order(ID)
        .await
        .unwrap()
        .unwrap()
        .1;
    assert_eq!(expected.operation_id, order.operation_id);
    assert_eq!(expected.records, order.records);
    assert_eq!(
        expected.last_error_code.as_deref(),
        Some(CertificateError::StoreUnavailable.code())
    );
    let restarted = CertificateStore::new(fixture.directory.clone());
    restarted.initialize().await.unwrap();
    assert_eq!(
        restarted
            .load_manual_dns_order(ID)
            .await
            .unwrap()
            .unwrap()
            .1,
        expected
    );
}

#[tokio::test]
async fn public_metadata_excludes_persisted_order_url_account_key_and_csr() {
    let fixture = Fixture::new().await;
    let order = with_csr(fixture.begin(false).await, issue_request().domains);
    fixture
        .store
        .store_manual_dns_order(ID, order.clone())
        .await
        .unwrap();
    let json = serde_json::to_string(&fixture.store.get(ID).await.unwrap()).unwrap();
    for private in [
        "orderUrl",
        "privateKeyPem",
        "csrDer",
        "accountIdentity",
        "PRIVATE KEY",
        &order.order_url,
        &order.account_identity,
    ] {
        assert!(!json.contains(private), "private field leaked: {private}");
    }
    let public = fixture
        .store
        .get(ID)
        .await
        .unwrap()
        .current_operation
        .unwrap()
        .manual_dns
        .unwrap();
    assert_eq!(public.challenge_set_id, order.challenge_set_id);
    assert_eq!(public.records, order.records);
    fixture.store.release_lease(ID).await;
}

#[tokio::test]
async fn storage_rejects_wrong_mode_tampered_records_and_invalid_or_wrong_san_csr() {
    let fixture = Fixture::new().await;
    let original = fixture.begin(false).await;
    fixture
        .store
        .store_manual_dns_order(ID, original.clone())
        .await
        .unwrap();
    let before = fixture.snapshot().await;
    let mut invalid_owner = original.clone();
    invalid_owner.records[0].owner = "_acme-challenge.attacker.example.com".to_owned();
    let mut changed_value = original.clone();
    changed_value.records[0].value = "c".repeat(43);
    let mut duplicate_identifier = original.clone();
    duplicate_identifier
        .records
        .push(original.records[0].clone());
    let mut invalid_csr = original.clone();
    invalid_csr.phase = ManualDnsPhase::Finalizing;
    invalid_csr.private_key_pem = Some("invalid-pem".to_owned());
    invalid_csr.csr_der = Some(vec![1, 2, 3]);
    let wrong_san = with_csr(original.clone(), vec!["unrelated.example.com".to_owned()]);
    for invalid in [
        invalid_owner,
        changed_value,
        duplicate_identifier,
        invalid_csr,
        wrong_san,
    ] {
        assert_eq!(
            fixture.store.store_manual_dns_order(ID, invalid).await,
            Err(CertificateError::ManualDnsOrderInvalid)
        );
        assert_eq!(fixture.snapshot().await, before);
    }
    let mut entry = fixture.store.index.lock().await.certificates[ID].clone();
    entry.acme.as_mut().unwrap().dns_mode = DnsValidationMode::Provider;
    assert!(!manual_order_is_valid(&entry, &original));
    fixture.store.release_lease(ID).await;
}
