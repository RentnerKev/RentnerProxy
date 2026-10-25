use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);
const ID: &str = "0198d98a-0000-7000-8000-000000000191";

fn state_dir() -> std::path::PathBuf {
    let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "rentnerproxy-certificate-operations-{}-{}-{counter}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos(),
    ))
}

fn issue_request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Http01,
        dns_mode: Default::default(),
        dns_provider: None,
        accept_terms: true,
    }
}

#[tokio::test]
async fn initial_acme_retry_after_restart_preserves_issue_and_checks_retry_deadlines() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    let mut request = issue_request();
    request.contact_email = Some("certificates@example.com".to_owned());
    let first = store.begin_issue(ID, request.clone(), false).await.unwrap();
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    drop(store);

    let store = CertificateStore::new(directory);
    store.initialize().await.unwrap();
    assert_eq!(
        store.get(ID).await.unwrap().status,
        CertificateStatus::Failed
    );
    assert!(matches!(
        store.begin_acme_retry(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .next_attempt_at = Some("2000-01-01T00:00:00Z".to_owned());
    store
        .defer_acme_account_retry(
            CertificateEnvironment::Staging,
            OffsetDateTime::now_utc() + time::Duration::hours(1),
        )
        .await
        .unwrap();
    assert!(matches!(
        store.begin_acme_retry(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    store.index.lock().await.acme_retry_until.clear();
    let (attempt, saved) = store.begin_acme_retry(ID).await.unwrap();
    assert_eq!(attempt.operation, CertificateOperation::Issuing);
    assert_eq!(attempt.attempt_count, 2);
    let operation = attempt.current_operation.unwrap();
    assert_eq!(operation.kind, OperationKind::Issue);
    assert_ne!(operation.id, first.current_operation.unwrap().id);
    assert_eq!(saved.domains, request.domains);
    assert_eq!(saved.environment, request.environment);
    assert_eq!(saved.contact_email, request.contact_email);
    assert_eq!(saved.challenge_type, request.challenge_type);
    assert!(matches!(
        store.begin_acme_retry(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    assert!(store.get(ID).await.unwrap().next_attempt_at.is_some());
}

#[tokio::test]
async fn acme_retry_retains_renewal_material_and_cannot_replace_pending_candidate() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory);
    store.initialize().await.unwrap();
    let request = issue_request();
    store.begin_issue(ID, request.clone(), false).await.unwrap();
    let leaf = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &request,
            leaf.cert.pem(),
            leaf.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    let original = store.commit_staged(&staged).await.unwrap();
    assert!(matches!(
        store.begin_acme_retry(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    store.begin_renewal(ID).await.unwrap();
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .next_attempt_at = Some("2000-01-01T00:00:00Z".to_owned());
    let (attempt, saved) = store.begin_acme_retry(ID).await.unwrap();
    assert_eq!(attempt.operation, CertificateOperation::Renewing);
    assert_eq!(
        attempt.current_operation.as_ref().unwrap().kind,
        OperationKind::Renew
    );
    assert!(matches!(
        store.begin_renewal(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    let after_conflict = store.get(ID).await.unwrap();
    assert_eq!(after_conflict.operation, attempt.operation);
    assert_eq!(after_conflict.attempt_count, attempt.attempt_count);
    assert_eq!(
        after_conflict.current_operation.unwrap().id,
        attempt.current_operation.as_ref().unwrap().id
    );
    assert_eq!(attempt.fingerprint, original.fingerprint);
    let staged = store
        .stage_acme(
            ID,
            &saved,
            leaf.cert.pem(),
            leaf.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    store
        .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
        .await;
    assert!(matches!(
        store.begin_acme_retry(ID).await,
        Err(CertificateError::OperationInProgress)
    ));
    assert_eq!(
        store.get(ID).await.unwrap().fingerprint,
        original.fingerprint
    );
    assert_eq!(store.pending_candidate_ids().await.unwrap(), vec![ID]);
}

#[tokio::test]
async fn readiness_distinguishes_uninitialized_from_ready_empty() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory);
    assert_eq!(store.readiness().await, CertificateStoreReadiness::NotReady);
    assert!(matches!(
        store.list().await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert!(matches!(
        store.events(None, 10).await,
        Err(CertificateError::StoreUnavailable)
    ));

    store
        .initialize()
        .await
        .expect("empty store should initialize");
    assert_eq!(store.readiness().await, CertificateStoreReadiness::Ready);
    assert!(
        store
            .list()
            .await
            .expect("ready store should list")
            .is_empty()
    );
    let page = store
        .events(None, 10)
        .await
        .expect("ready store should page events");
    assert!(page.events.is_empty());
    assert!(!page.reset_required);
}

#[tokio::test]
async fn operation_and_event_ids_survive_restart() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    let started = store
        .begin_issue(ID, issue_request(), false)
        .await
        .expect("issue should be accepted");
    let operation = started
        .current_operation
        .clone()
        .expect("accepted issue should have operation metadata");
    assert_eq!(operation.kind, OperationKind::Issue);
    assert_eq!(operation.stage, CertificateOperationStage::Queued);
    store
        .record_operation_stage(ID, CertificateOperationStage::CreatingOrder)
        .await
        .unwrap();
    let first_page = store.events(None, 20).await.unwrap();
    assert_eq!(first_page.events.len(), 2);
    assert_eq!(first_page.events[0].kind, CertificateEventKind::Accepted);
    assert_eq!(first_page.events[1].kind, CertificateEventKind::Started);
    assert!(
        first_page
            .events
            .iter()
            .all(|event| event.operation_kind == Some(OperationKind::Issue))
    );
    let event_ids = first_page
        .events
        .iter()
        .map(|event| event.id.clone())
        .collect::<Vec<_>>();
    drop(store);

    let reopened = CertificateStore::new(directory);
    reopened.initialize().await.unwrap();
    let metadata = reopened.get(ID).await.unwrap();
    assert_eq!(metadata.current_operation.unwrap().id, operation.id);
    let page = reopened.events(None, 20).await.unwrap();
    let reopened_event_ids = page
        .events
        .iter()
        .map(|event| event.id.clone())
        .collect::<Vec<_>>();
    assert!(reopened_event_ids.starts_with(&event_ids));
    assert!(
        page.events
            .iter()
            .all(|event| event.operation_id == operation.id)
    );
}

#[tokio::test]
async fn acme_candidate_staging_records_issued_event() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory);
    store.initialize().await.unwrap();
    store.begin_issue(ID, issue_request(), false).await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    store
        .stage_acme(
            ID,
            &issue_request(),
            certificate.cert.pem(),
            certificate.signing_key.serialize_pem(),
        )
        .await
        .unwrap();

    let page = store.events(None, 20).await.unwrap();
    assert_eq!(
        page.events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec![
            CertificateEventKind::Accepted,
            CertificateEventKind::Started,
            CertificateEventKind::Issued,
        ]
    );
    assert_eq!(
        store
            .get(ID)
            .await
            .unwrap()
            .current_operation
            .unwrap()
            .stage,
        CertificateOperationStage::CertificateReady
    );
}

#[tokio::test]
async fn sidecar_recovery_records_issued_event_once_with_stable_operation_id() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    store.begin_issue(ID, issue_request(), false).await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &issue_request(),
            certificate.cert.pem(),
            certificate.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    let operation_id = staged
        .stored
        .metadata
        .current_operation
        .as_ref()
        .unwrap()
        .id
        .clone();
    drop(store);

    let index_path = directory.join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    index["pendingCandidates"]
        .as_object_mut()
        .unwrap()
        .remove(ID);
    let events = index["events"].as_array_mut().unwrap();
    events.retain(|event| event["kind"] != "issued");
    index["eventSequence"] = serde_json::json!(events.len());
    std::fs::write(&index_path, serde_json::to_vec(&index).unwrap()).unwrap();

    let reopened = CertificateStore::new(directory.clone());
    reopened.initialize().await.unwrap();
    let first_page = reopened.events(None, 20).await.unwrap();
    let first_issued = first_page
        .events
        .iter()
        .filter(|event| event.kind == CertificateEventKind::Issued)
        .collect::<Vec<_>>();
    assert_eq!(first_issued.len(), 1);
    assert_eq!(first_issued[0].operation_id, operation_id);
    let issued_event_id = first_issued[0].id.clone();
    drop(reopened);

    let restarted = CertificateStore::new(directory);
    restarted.initialize().await.unwrap();
    let second_page = restarted.events(None, 20).await.unwrap();
    let second_issued = second_page
        .events
        .iter()
        .filter(|event| event.kind == CertificateEventKind::Issued)
        .collect::<Vec<_>>();
    assert_eq!(second_issued.len(), 1);
    assert_eq!(second_issued[0].operation_id, operation_id);
    assert_eq!(second_issued[0].id, issued_event_id);
}

#[tokio::test]
async fn manual_import_records_accepted_started_and_activated_events() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_manual(
            ID,
            CertificateImportRequest {
                certificate_pem: certificate.cert.pem(),
                private_key_pem: certificate.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .unwrap();
    let operation_id = staged
        .stored
        .metadata
        .current_operation
        .as_ref()
        .unwrap()
        .id
        .clone();
    store.commit_staged(&staged).await.unwrap();

    let page = store.events(None, 20).await.unwrap();
    assert_eq!(
        page.events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec![
            CertificateEventKind::Accepted,
            CertificateEventKind::Started,
            CertificateEventKind::Activated,
        ]
    );
    assert!(
        page.events
            .iter()
            .all(|event| event.operation_id == operation_id)
    );
    assert!(page.events.iter().all(|event| event.certificate_id == ID));
    assert!(
        page.events
            .iter()
            .all(|event| event.operation_kind == Some(OperationKind::Import))
    );
    let metadata = store.get(ID).await.unwrap();
    let operation = metadata.current_operation.unwrap();
    assert_eq!(operation.id, operation_id);
    assert_eq!(operation.stage, CertificateOperationStage::Applied);
    assert!(metadata.last_activated_at.is_some());

    drop(store);
    let reopened = CertificateStore::new(directory);
    reopened.initialize().await.unwrap();
    let recovered = reopened.get(ID).await.unwrap();
    let recovered_operation = recovered.current_operation.unwrap();
    assert_eq!(recovered_operation.id, operation_id);
    assert_eq!(
        recovered_operation.stage,
        CertificateOperationStage::Applied
    );
    assert!(recovered.last_activated_at.is_some());
}

#[tokio::test]
async fn operation_stage_updates_active_timestamp_and_survives_restart() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();

    let first = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_manual(
            ID,
            CertificateImportRequest {
                certificate_pem: first.cert.pem(),
                private_key_pem: first.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();

    let second = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    store
        .stage_manual(
            ID,
            CertificateImportRequest {
                certificate_pem: second.cert.pem(),
                private_key_pem: second.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .unwrap();
    let before = store.get(ID).await.unwrap();
    let operation_id = before.current_operation.as_ref().unwrap().id.clone();
    tokio::time::sleep(Duration::from_secs(2)).await;
    store
        .record_operation_stage(ID, CertificateOperationStage::Applying)
        .await
        .unwrap();
    let after = store.get(ID).await.unwrap();
    assert!(after.updated_at > before.updated_at);
    let operation = after.current_operation.as_ref().unwrap();
    assert_eq!(operation.id, operation_id);
    assert_eq!(operation.stage, CertificateOperationStage::Applying);
    assert!(operation.updated_at > before.current_operation.unwrap().updated_at);

    drop(store);
    let reopened = CertificateStore::new(directory);
    reopened.initialize().await.unwrap();
    let recovered = reopened.get(ID).await.unwrap();
    assert_eq!(
        recovered.current_operation.as_ref().unwrap().stage,
        CertificateOperationStage::Applying
    );
    assert_eq!(recovered.current_operation.unwrap().id, operation_id);
    assert_eq!(recovered.updated_at, after.updated_at);
}

#[tokio::test]
async fn invalid_index_is_corrupt_and_never_an_empty_list() {
    let directory = state_dir();
    let certificates = directory.join("certificates");
    std::fs::create_dir_all(&certificates).unwrap();
    std::fs::write(
        certificates.join("certificate-metadata.json"),
        b"{ definitely not certificate metadata",
    )
    .unwrap();
    let store = CertificateStore::new(directory);
    assert!(matches!(
        store.initialize().await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(store.readiness().await, CertificateStoreReadiness::Corrupt);
    assert!(matches!(
        store.list().await,
        Err(CertificateError::StoreUnavailable)
    ));
}

#[tokio::test]
async fn invalid_cursor_resets_to_oldest_page() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory);
    store.initialize().await.unwrap();
    store.begin_issue(ID, issue_request(), false).await.unwrap();
    let page = store.events(Some("not-a-cursor"), 1).await.unwrap();
    assert!(page.reset_required);
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].kind, CertificateEventKind::Accepted);
}

#[tokio::test]
async fn legacy_candidate_without_operation_id_gets_stable_recovery_id() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    store.begin_issue(ID, issue_request(), false).await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &issue_request(),
            certificate.cert.pem(),
            certificate.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    drop(store);

    let index_path = directory.join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    index["certificates"][ID]["currentOperation"] = serde_json::Value::Null;
    index["pendingCandidates"][ID]["staged"]["currentOperation"] = serde_json::Value::Null;
    std::fs::write(&index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    let sidecar_path = directory.join(format!("certificates/{ID}/candidate.json"));
    let mut sidecar: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&sidecar_path).unwrap()).unwrap();
    sidecar["staged"]["currentOperation"] = serde_json::Value::Null;
    std::fs::write(&sidecar_path, serde_json::to_vec(&sidecar).unwrap()).unwrap();

    let reopened = CertificateStore::new(directory.clone());
    reopened.initialize().await.unwrap();
    let first = reopened
        .get(ID)
        .await
        .unwrap()
        .current_operation
        .unwrap()
        .id;
    let activation = reopened
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    drop(activation);
    drop(reopened);

    let restarted = CertificateStore::new(directory);
    restarted.initialize().await.unwrap();
    let second = restarted
        .get(ID)
        .await
        .unwrap()
        .current_operation
        .unwrap()
        .id;
    assert_eq!(first, second);
    assert!(staged.id() == ID);
}

#[tokio::test]
async fn renewal_events_retain_kind_after_current_operation_changes() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory);
    store.initialize().await.unwrap();
    store.begin_issue(ID, issue_request(), false).await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &issue_request(),
            certificate.cert.pem(),
            certificate.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    let before = store.events(None, 20).await.unwrap();
    let (renewal, _) = store.begin_renewal(ID).await.unwrap();
    let operation_id = renewal.current_operation.unwrap().id;
    store
        .record_operation_stage(ID, CertificateOperationStage::Failed)
        .await
        .unwrap();
    let renewed = store
        .events(before.next_cursor.as_deref(), 20)
        .await
        .unwrap();
    assert_eq!(renewed.events.len(), 3);
    assert_eq!(
        renewed
            .events
            .iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>(),
        vec![
            CertificateEventKind::Accepted,
            CertificateEventKind::Started,
            CertificateEventKind::Failed
        ]
    );
    assert!(renewed.events.iter().all(|event| {
        event.operation_kind == Some(OperationKind::Renew) && event.operation_id == operation_id
    }));
    let mut index = store.index.lock().await;
    operations::append_start_events(&mut index, &operation_id, ID).unwrap();
    assert!(matches!(
        operations::append_event(
            &mut index,
            "0198d98a-0000-7000-8000-000000000192",
            ID,
            CertificateEventKind::Failed,
            CertificateOperationStage::Failed,
            None,
        ),
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(
        operations::events_page(&index, before.next_cursor.as_deref(), 20).unwrap(),
        renewed
    );
    index
        .certificates
        .get_mut(ID)
        .unwrap()
        .metadata
        .current_operation = Some(operations::new_operation(OperationKind::Issue).unwrap());
    let page = operations::events_page(&index, before.next_cursor.as_deref(), 20).unwrap();
    assert_eq!(page, renewed);
}

#[tokio::test]
async fn legacy_journal_without_operation_kind_preserves_events_and_cursor() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()]).unwrap();
    let staged = store
        .stage_manual(
            ID,
            CertificateImportRequest {
                certificate_pem: certificate.cert.pem(),
                private_key_pem: certificate.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    let first_page = store.events(None, 1).await.unwrap();
    drop(store);

    let index_path = directory.join("certificates/certificate-metadata.json");
    let mut persisted: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    for event in persisted["events"].as_array_mut().unwrap() {
        event.as_object_mut().unwrap().remove("operationKind");
    }
    std::fs::write(&index_path, serde_json::to_vec(&persisted).unwrap()).unwrap();
    let reopened = CertificateStore::new(directory);
    reopened.initialize().await.unwrap();
    let page = reopened.events(None, 3).await.unwrap();
    assert_eq!(page.events[0].id, first_page.events[0].id);
    assert!(
        page.events
            .iter()
            .all(|event| event.operation_kind.is_none())
    );
    let resumed = reopened
        .events(first_page.next_cursor.as_deref(), 2)
        .await
        .unwrap();
    assert_eq!(resumed.events, page.events[1..]);
    assert_eq!(resumed.next_cursor, page.next_cursor);
    let index = reopened.index.lock().await;
    assert!(operations::journal_is_valid(&index));
    let serialized = serde_json::to_value(&*index).unwrap();
    assert_eq!(
        serialized["eventJournalVersion"],
        persisted["eventJournalVersion"]
    );
    assert_eq!(serialized["events"], persisted["events"]);
    assert_eq!(serialized["eventSequence"], persisted["eventSequence"]);
}
