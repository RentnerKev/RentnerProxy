use super::*;
use crate::runtime::dns::{DnsDelegationBinding, DnsRecordIntent, EncryptedDnsConfig};
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
    let active = store.commit_staged(&staged).await.unwrap();
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
    assert_eq!(cancelled.next_attempt_at, None);
    assert_eq!(cancelled.next_renewal_at, None);
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
