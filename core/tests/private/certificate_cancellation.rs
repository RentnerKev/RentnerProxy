use super::*;
use crate::runtime::dns::{DnsDelegationBinding, DnsRecordIntent, EncryptedDnsConfig};
use base64::Engine as _;
use std::sync::atomic::{AtomicU64, Ordering};

const ID: &str = "0198d98a-0000-7000-8000-000000000291";
static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "rentner-cancellation-{}-{}-{}",
            std::process::id(),
            OffsetDateTime::now_utc().unix_timestamp_nanos(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Http01,
        dns_mode: DnsValidationMode::Provider,
        dns_provider: None,
        accept_terms: true,
    }
}

async fn delegated(store: &CertificateStore) -> String {
    let metadata = store.begin_issue(ID, request(), false).await.unwrap();
    let mut index = store.index.lock().await;
    let entry = index.certificates.get_mut(ID).unwrap();
    let acme = entry.acme.as_mut().unwrap();
    acme.challenge_type = AcmeChallengeType::Dns01;
    acme.dns_mode = DnsValidationMode::Delegated;
    // Store tests do not contact a provider or decrypt credentials.
    acme.dns_provider = Some(EncryptedDnsConfig {
        version: 1,
        nonce: vec![0; 12],
        ciphertext: vec![0; 16],
    });
    entry.metadata.challenge_type = Some(AcmeChallengeType::Dns01);
    metadata.current_operation.unwrap().id
}

async fn install_live(store: &CertificateStore) -> CertificateMetadata {
    store.begin_issue(ID, request(), false).await.unwrap();
    let leaf = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &request(),
            leaf.cert.pem(),
            leaf.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap()
}

#[tokio::test]
async fn delegated_cancellation_is_fenced_and_allowed_only_before_finalization() {
    let root = Root::new();
    let store = CertificateStore::new(root.0.clone());
    store.initialize().await.unwrap();
    let operation_id = delegated(&store).await;
    for stale in ["", "invalid", ID] {
        assert_eq!(
            store.request_delegated_cancel(ID, stale).await,
            Err(CertificateError::OperationInProgress)
        );
    }
    for stage in [
        CertificateOperationStage::AwaitingDns,
        CertificateOperationStage::CheckingDns,
        CertificateOperationStage::Finalizing,
        CertificateOperationStage::CertificateReady,
        CertificateOperationStage::Applying,
        CertificateOperationStage::Applied,
        CertificateOperationStage::RetryScheduled,
        CertificateOperationStage::Failed,
        CertificateOperationStage::Cancelled,
        CertificateOperationStage::Expired,
    ] {
        store
            .index
            .lock()
            .await
            .certificates
            .get_mut(ID)
            .unwrap()
            .metadata
            .current_operation
            .as_mut()
            .unwrap()
            .stage = stage;
        assert_eq!(
            store.request_delegated_cancel(ID, &operation_id).await,
            Err(CertificateError::OperationInProgress)
        );
    }
    for mode in [DnsValidationMode::Manual, DnsValidationMode::Provider] {
        let mut index = store.index.lock().await;
        let entry = index.certificates.get_mut(ID).unwrap();
        entry.metadata.current_operation.as_mut().unwrap().stage =
            CertificateOperationStage::Queued;
        entry.acme.as_mut().unwrap().dns_mode = mode;
        drop(index);
        assert_eq!(
            store.request_delegated_cancel(ID, &operation_id).await,
            Err(CertificateError::OperationInProgress)
        );
    }
    let mut index = store.index.lock().await;
    let entry = index.certificates.get_mut(ID).unwrap();
    entry.acme.as_mut().unwrap().dns_mode = DnsValidationMode::Delegated;
    entry.metadata.current_operation.as_mut().unwrap().kind = OperationKind::Import;
    drop(index);
    assert_eq!(
        store.request_delegated_cancel(ID, &operation_id).await,
        Err(CertificateError::OperationInProgress)
    );
}

#[tokio::test]
async fn accepted_cancellation_is_idempotent_blocks_advancement_and_survives_restart() {
    for stage in [
        CertificateOperationStage::Queued,
        CertificateOperationStage::CreatingOrder,
        CertificateOperationStage::PreparingChallenge,
        CertificateOperationStage::WaitingForValidation,
    ] {
        let root = Root::new();
        let store = CertificateStore::new(root.0.clone());
        store.initialize().await.unwrap();
        let operation_id = delegated(&store).await;
        store.record_operation_stage(ID, stage).await.unwrap();
        assert!(
            !store
                .delegated_cancel_requested(ID, &operation_id)
                .await
                .unwrap()
        );
        let legacy = serde_json::to_value(
            store.index.lock().await.certificates[ID]
                .acme
                .as_ref()
                .unwrap(),
        )
        .unwrap();
        assert!(legacy.get("cancelRequested").is_none());
        let restored: StoredAcmeConfiguration = serde_json::from_value(legacy).unwrap();
        assert!(!restored.cancel_requested);
        let accepted = store
            .request_delegated_cancel(ID, &operation_id)
            .await
            .unwrap();
        assert_eq!(
            accepted.current_operation.as_ref().unwrap().stage,
            CertificateOperationStage::Cancelling
        );
        assert!(
            store
                .delegated_cancel_requested(ID, &operation_id)
                .await
                .unwrap()
        );
        let stored: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.0.join("certificates").join(CERTIFICATE_INDEX_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(stored["certificates"][ID]["acme"]["cancelRequested"], true);
        assert_eq!(
            store
                .request_delegated_cancel(ID, &operation_id)
                .await
                .unwrap(),
            accepted
        );
        assert_eq!(
            store
                .record_operation_stage(ID, CertificateOperationStage::Finalizing)
                .await,
            Err(CertificateError::AcmeCancelled)
        );
        assert!(!store.renewal_is_allowed(ID).await);
        assert!(
            !store
                .events(None, 200)
                .await
                .unwrap()
                .events
                .iter()
                .any(|event| event.kind == CertificateEventKind::Cancelled)
        );
        drop(store);
        let restarted = CertificateStore::new(root.0.clone());
        restarted.initialize().await.unwrap();
        let finished = restarted.get(ID).await.unwrap();
        assert_eq!(finished.operation, CertificateOperation::Idle);
        assert_eq!(finished.status, CertificateStatus::Failed);
        assert_eq!(
            finished.current_operation.unwrap().stage,
            CertificateOperationStage::Cancelled
        );
        assert_eq!(finished.last_error_code.as_deref(), Some("acme_cancelled"));
        assert_eq!(finished.next_attempt_at, None);
        assert!(!restarted.renewal_is_allowed(ID).await);
        assert_eq!(
            restarted.request_delegated_cancel(ID, &operation_id).await,
            Err(CertificateError::OperationInProgress)
        );
        assert!(matches!(
            restarted.begin_acme_retry(ID).await,
            Err(CertificateError::OperationInProgress)
        ));
        let events = restarted.events(None, 200).await.unwrap().events;
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == CertificateEventKind::Cancelled)
                .count(),
            1
        );
        assert!(!events.iter().any(|event| matches!(
            event.kind,
            CertificateEventKind::Failed | CertificateEventKind::RetryScheduled
        )));
        restarted.begin_issue(ID, request(), false).await.unwrap();
        assert!(
            !restarted.index.lock().await.certificates[ID]
                .acme
                .as_ref()
                .unwrap()
                .cancel_requested
        );
    }
}

#[tokio::test]
async fn cancellation_and_finalization_cannot_both_be_accepted() {
    let root = Root::new();
    let store = CertificateStore::new(root.0.clone());
    store.initialize().await.unwrap();
    let operation_id = delegated(&store).await;
    let (cancelled, finalized) = tokio::join!(
        store.request_delegated_cancel(ID, &operation_id),
        store.record_operation_stage(ID, CertificateOperationStage::Finalizing),
    );
    assert_ne!(cancelled.is_ok(), finalized.is_ok());
    if cancelled.is_ok() {
        assert_eq!(finalized, Err(CertificateError::AcmeCancelled));
    } else {
        assert_eq!(cancelled, Err(CertificateError::OperationInProgress));
    }
}

#[tokio::test]
async fn cancelled_renewal_preserves_live_material_and_cleanup_authority_without_retry() {
    let root = Root::new();
    let store = CertificateStore::new(root.0.clone());
    store.initialize().await.unwrap();
    let active = install_live(&store).await;
    let material_id = store.index.lock().await.certificates[ID]
        .material_id
        .clone();
    let operation_id = delegated(&store).await;
    {
        let mut index = store.index.lock().await;
        let entry = index.certificates.get_mut(ID).unwrap();
        entry.metadata.current_operation.as_mut().unwrap().kind = OperationKind::Renew;
        entry.metadata.operation = CertificateOperation::Renewing;
    }
    let proof = DnsRecordIntent::new(ID, "example.com", "fixture-proof-value")
        .unwrap()
        .with_delegation(DnsDelegationBinding {
            original_owner: "_acme-challenge.example.com".to_owned(),
            target_owner: "order.validation.example.net".to_owned(),
            zone_name: "example.net".to_owned(),
            cname_chain: vec![
                "_acme-challenge.example.com".to_owned(),
                "order.validation.example.net".to_owned(),
            ],
        })
        .unwrap();
    store
        .set_pending_dns_records(ID, vec![proof.clone()])
        .await
        .unwrap();
    store
        .request_delegated_cancel(ID, &operation_id)
        .await
        .unwrap();
    // Cancellation wins over a concurrent ordinary order failure as well.
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    let cancelled = store.get(ID).await.unwrap();
    assert_eq!(cancelled.status, CertificateStatus::Valid);
    assert_eq!(cancelled.fingerprint, active.fingerprint);
    assert_eq!(
        store.index.lock().await.certificates[ID].material_id,
        material_id
    );
    assert_eq!(
        cancelled.current_operation.unwrap().stage,
        CertificateOperationStage::Cancelled
    );
    assert_eq!(cancelled.last_error_code.as_deref(), Some("acme_cancelled"));
    assert!(cancelled.next_attempt_at.is_some());
    assert!(cancelled.next_renewal_at.is_some());
    assert!(
        !store.index.lock().await.certificates[ID]
            .acme
            .as_ref()
            .unwrap()
            .cancel_requested
    );
    assert!(cancelled.dns_cleanup_pending);
    assert_eq!(
        store.pending_dns_records(ID).await.unwrap(),
        vec![proof.clone()]
    );
    assert_eq!(
        store.pending_dns_cleanup_ids().await.unwrap(),
        vec![ID.to_owned()]
    );
    assert!(!store.renewal_is_allowed(ID).await);
    drop(store);
    let restarted = CertificateStore::new(root.0.clone());
    restarted.initialize().await.unwrap();
    assert_eq!(
        restarted.pending_dns_records(ID).await.unwrap(),
        vec![proof]
    );
    assert_eq!(
        restarted.get(ID).await.unwrap().fingerprint,
        active.fingerprint
    );
    let events = restarted.events(None, 200).await.unwrap().events;
    assert_eq!(
        events
            .iter()
            .filter(|event| event.operation_id == operation_id
                && event.kind == CertificateEventKind::Cancelled)
            .count(),
        1
    );
    assert!(
        !events.iter().any(|event| event.operation_id == operation_id
            && event.kind == CertificateEventKind::RetryScheduled)
    );
}

#[tokio::test]
async fn cancellation_persistence_failure_rolls_back_the_request() {
    let root = Root::new();
    let store = CertificateStore::new(root.0.clone());
    store.initialize().await.unwrap();
    let operation_id = delegated(&store).await;
    let index_path = root.0.join("certificates").join(CERTIFICATE_INDEX_FILE);
    std::fs::remove_file(&index_path).unwrap();
    std::fs::create_dir(&index_path).unwrap();
    assert_eq!(
        store.request_delegated_cancel(ID, &operation_id).await,
        Err(CertificateError::StoreUnavailable)
    );
    assert!(
        !store
            .delegated_cancel_requested(ID, &operation_id)
            .await
            .unwrap()
    );
    assert_eq!(
        store
            .get(ID)
            .await
            .unwrap()
            .current_operation
            .unwrap()
            .stage,
        CertificateOperationStage::Queued
    );
}

#[tokio::test]
async fn delegated_cancellation_http_acknowledges_only_matching_active_operations() {
    use crate::{
        config::Config,
        runtime::{ProxyRuntime, RuntimeSettings},
        server::{AppState, app_with_state},
    };
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let root = Root::new();
    let runtime = ProxyRuntime::new(RuntimeSettings::new(root.0.clone(), 18080), None);
    runtime.certificate_store.initialize().await.unwrap();
    let operation_id = delegated(&runtime.certificate_store).await;
    let token = "synthetic-delegated-cancellation-http-token";
    let config = Config::from_values(None, Some(token), None, None, None, false).unwrap();
    let router = app_with_state(AppState::new(runtime.clone(), config.controller_token));
    for (action_id, expected) in [
        (ID, StatusCode::CONFLICT),
        (&operation_id, StatusCode::ACCEPTED),
        (&operation_id, StatusCode::ACCEPTED),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/internal/v1/certificates/{ID}/cancel"))
                    .header("authorization", format!("Bearer {token}"))
                    .body(Body::from(
                        serde_json::json!({"operationId":action_id}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()["cache-control"], "no-store");
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 8192).await.unwrap()).unwrap();
        if expected == StatusCode::ACCEPTED {
            assert_eq!(body["currentOperation"]["stage"], "cancelling");
            assert_eq!(body["currentOperation"]["id"], operation_id);
            assert!(body.get("cancelRequested").is_none());
        } else {
            assert_eq!(body["error"], "operation_in_progress");
        }
    }
    runtime
        .certificate_store
        .finish_failed(ID, CertificateError::AcmeCancelled)
        .await;
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/internal/v1/certificates/{ID}/cancel"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(
                    serde_json::json!({"operationId":operation_id}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn cancelled_delegated_issue_can_be_replaced_by_manual_import_across_reload() {
    for reload_before_import in [false, true] {
        let root = Root::new();
        let mut store = CertificateStore::new(root.0.clone());
        store.initialize().await.unwrap();
        let cancelled_id = delegated(&store).await;
        store
            .request_delegated_cancel(ID, &cancelled_id)
            .await
            .unwrap();
        store
            .finish_failed(ID, CertificateError::AcmeCancelled)
            .await;
        assert!(
            !store.index.lock().await.certificates[ID]
                .acme
                .as_ref()
                .unwrap()
                .cancel_requested
        );
        // Simulate a terminal entry written by the earlier implementation as
        // well as the new terminal representation. Import must clear either.
        {
            let mut index = store.index.lock().await;
            index
                .certificates
                .get_mut(ID)
                .unwrap()
                .acme
                .as_mut()
                .unwrap()
                .cancel_requested = true;
            persistence::persist_index(&store.certificates_dir().unwrap(), &index).unwrap();
        }
        if reload_before_import {
            drop(store);
            store = CertificateStore::new(root.0.clone());
            store.initialize().await.unwrap();
        }
        let leaf = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
        let staged = store
            .stage_manual(
                ID,
                CertificateImportRequest {
                    certificate_pem: leaf.cert.pem(),
                    private_key_pem: leaf.signing_key.serialize_pem(),
                    chain_pem: None,
                    required_domains: Some(vec!["example.com".to_owned()]),
                },
            )
            .await
            .unwrap();
        let import_id = store.get(ID).await.unwrap().current_operation.unwrap().id;
        assert_ne!(import_id, cancelled_id);
        assert!(
            !store.index.lock().await.certificates[ID]
                .acme
                .as_ref()
                .unwrap()
                .cancel_requested
        );
        drop(store);
        let reopened = CertificateStore::new(root.0.clone());
        reopened.initialize().await.unwrap();
        let current = reopened.get(ID).await.unwrap().current_operation.unwrap();
        assert_eq!(current.kind, OperationKind::Import);
        assert_eq!(current.id, import_id);
        reopened
            .record_operation_stage(ID, CertificateOperationStage::Applying)
            .await
            .unwrap();
        let installed = reopened.commit_staged(&staged).await.unwrap();
        assert_eq!(installed.source, CertificateSource::Manual);
        assert_eq!(installed.status, CertificateStatus::Valid);
        assert_eq!(
            installed.current_operation.as_ref().unwrap().stage,
            CertificateOperationStage::Applied
        );
        assert_ne!(
            installed.current_operation.as_ref().unwrap().id,
            cancelled_id
        );
        drop(reopened);
        let restored = CertificateStore::new(root.0.clone());
        restored.initialize().await.unwrap();
        assert_eq!(restored.get(ID).await.unwrap(), installed);
        assert!(restored.index.lock().await.certificates[ID].acme.is_none());
        let events = restored.events(None, 200).await.unwrap().events;
        assert_eq!(
            events
                .iter()
                .filter(|event| event.operation_id == cancelled_id
                    && event.kind == CertificateEventKind::Cancelled)
                .count(),
            1
        );
        assert!(events.iter().any(|event| event.operation_id == import_id
            && event.kind == CertificateEventKind::Activated));
    }
}

#[tokio::test]
async fn cancelled_live_renewal_defers_future_maintenance_without_restarting_cancelled_operation() {
    const CHILD: &str = "RENTNERPROXY_CANCELLED_RENEWAL_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "runtime::certificates::cancellation_tests::cancelled_live_renewal_defers_future_maintenance_without_restarting_cancelled_operation", "--nocapture"])
            .env(CHILD, "1")
            .env("APP_ENCRYPTION_KEY", base64::engine::general_purpose::STANDARD.encode([7_u8; 32]))
            .env_remove("APP_ENCRYPTION_KEY_FILE")
            .output().unwrap();
        assert!(
            output.status.success(),
            "isolated cancelled-renewal test failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    for restart_during_cancellation in [false, true] {
        let root = Root::new();
        let mut store = CertificateStore::new(root.0.clone());
        store.initialize().await.unwrap();
        install_live(&store).await;
        let cancelled_id = delegated(&store).await;
        let connection: DnsProviderConfig = serde_json::from_value(serde_json::json!({
            "type":"connection", "provider":"cloudflare",
            "connectionId":"0198d98a-0000-7000-8000-000000000299",
            "zoneId":"0123456789abcdef0123456789abcdef",
        }))
        .unwrap();
        let encrypted = crate::runtime::dns::encrypt(&connection, ID).unwrap();
        {
            let mut index = store.index.lock().await;
            let entry = index.certificates.get_mut(ID).unwrap();
            entry.acme.as_mut().unwrap().dns_provider = Some(encrypted);
            entry.metadata.current_operation.as_mut().unwrap().kind = OperationKind::Renew;
            entry.metadata.operation = CertificateOperation::Renewing;
            // Model a certificate whose renewal is already due.
            let now = OffsetDateTime::now_utc();
            entry.metadata.issued_at =
                Some((now - time::Duration::days(90)).format(&Rfc3339).unwrap());
            entry.metadata.expires_at =
                Some((now + time::Duration::days(30)).format(&Rfc3339).unwrap());
        }
        store
            .request_delegated_cancel(ID, &cancelled_id)
            .await
            .unwrap();
        let before_finish = OffsetDateTime::now_utc();
        if restart_during_cancellation {
            drop(store);
            store = CertificateStore::new(root.0.clone());
            store.initialize().await.unwrap();
        } else {
            store.finish_failed(ID, CertificateError::AcmeFailed).await;
        }
        let cancelled = store.get(ID).await.unwrap();
        assert_eq!(
            cancelled.current_operation.as_ref().unwrap().id,
            cancelled_id
        );
        assert_eq!(
            cancelled.current_operation.as_ref().unwrap().stage,
            CertificateOperationStage::Cancelled
        );
        let deadline =
            OffsetDateTime::parse(cancelled.next_attempt_at.as_deref().unwrap(), &Rfc3339).unwrap();
        assert!(
            deadline
                >= before_finish + time::Duration::seconds(i64::from(MIN_ACME_RETRY_DELAY_SECONDS))
        );
        assert!(
            deadline
                <= OffsetDateTime::now_utc()
                    + time::Duration::seconds(i64::from(MIN_ACME_RETRY_DELAY_SECONDS))
        );
        assert!(crate::runtime::ProxyRuntime::renewal_is_due(&cancelled));
        assert!(
            !store.renewal_is_allowed(ID).await,
            "the next scheduler tick must not undo cancellation"
        );
        assert!(matches!(
            store.begin_renewal(ID).await,
            Err(CertificateError::OperationInProgress)
        ));
        assert!(matches!(
            store.begin_acme_retry(ID).await,
            Err(CertificateError::OperationInProgress)
        ));
        assert!(
            !store.index.lock().await.certificates[ID]
                .acme
                .as_ref()
                .unwrap()
                .cancel_requested
        );
        drop(store);
        store = CertificateStore::new(root.0.clone());
        store.initialize().await.unwrap();
        assert_eq!(
            store.get(ID).await.unwrap().next_attempt_at,
            cancelled.next_attempt_at,
            "restarts must not extend the pause"
        );
        assert!(!store.renewal_is_allowed(ID).await);
        {
            let mut index = store.index.lock().await;
            index.certificates.get_mut(ID).unwrap().next_attempt_at =
                Some("2000-01-01T00:00:00Z".to_owned());
            persistence::persist_index(&store.certificates_dir().unwrap(), &index).unwrap();
        }
        drop(store);
        store = CertificateStore::new(root.0.clone());
        store.initialize().await.unwrap();
        assert!(
            store.renewal_is_allowed(ID).await,
            "a later scheduled renewal remains eligible"
        );
        assert!(crate::runtime::ProxyRuntime::renewal_is_due(
            &store.get(ID).await.unwrap()
        ));
        assert!(
            matches!(
                store.begin_acme_retry(ID).await,
                Err(CertificateError::OperationInProgress)
            ),
            "the cancelled operation itself remains terminal"
        );
        let (renewal, saved_request) = store.begin_renewal(ID).await.unwrap();
        let next_id = renewal.current_operation.as_ref().unwrap().id.clone();
        assert_ne!(next_id, cancelled_id);
        assert_eq!(renewal.operation, CertificateOperation::Renewing);
        assert_eq!(saved_request.dns_mode, DnsValidationMode::Delegated);
        assert_eq!(saved_request.dns_provider, Some(connection));
        assert_eq!(
            store.delegated_cancel_requested(ID, &cancelled_id).await,
            Err(CertificateError::OperationInProgress)
        );
        assert!(
            !store
                .delegated_cancel_requested(ID, &next_id)
                .await
                .unwrap()
        );
        store
            .record_operation_stage(ID, CertificateOperationStage::Finalizing)
            .await
            .unwrap();
        let events = store.events(None, 200).await.unwrap().events;
        assert_eq!(
            events
                .iter()
                .filter(|event| event.operation_id == cancelled_id
                    && event.kind == CertificateEventKind::Cancelled)
                .count(),
            1
        );
        assert!(
            !events.iter().any(|event| event.operation_id == cancelled_id
                && event.kind == CertificateEventKind::RetryScheduled)
        );
    }
}

#[tokio::test]
async fn legacy_terminal_cancel_flag_is_cleared_without_extending_original_renewal_pause() {
    let root = Root::new();
    let store = CertificateStore::new(root.0.clone());
    store.initialize().await.unwrap();
    install_live(&store).await;
    let operation_id = delegated(&store).await;
    store
        .request_delegated_cancel(ID, &operation_id)
        .await
        .unwrap();
    store
        .finish_failed(ID, CertificateError::AcmeCancelled)
        .await;
    {
        let mut index = store.index.lock().await;
        let entry = index.certificates.get_mut(ID).unwrap();
        entry.acme.as_mut().unwrap().cancel_requested = true;
        let operation = entry.metadata.current_operation.as_mut().unwrap();
        operation.started_at = "1999-12-31T23:59:00Z".to_owned();
        operation.updated_at = "2000-01-01T00:00:00Z".to_owned();
        persistence::persist_index(&store.certificates_dir().unwrap(), &index).unwrap();
    }
    drop(store);
    let restored = CertificateStore::new(root.0.clone());
    restored.initialize().await.unwrap();
    assert!(
        !restored.index.lock().await.certificates[ID]
            .acme
            .as_ref()
            .unwrap()
            .cancel_requested
    );
    assert_eq!(
        restored.get(ID).await.unwrap().next_attempt_at.as_deref(),
        Some("2000-01-01T00:30:00Z")
    );
    assert!(restored.renewal_is_allowed(ID).await);
    assert_eq!(
        restored
            .get(ID)
            .await
            .unwrap()
            .current_operation
            .unwrap()
            .id,
        operation_id
    );
}
