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
        dns_provider: None,
        accept_terms: true,
    }
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

    // Model a stop after the durable sidecar write but before the index write: the sidecar
    // remains, while the pending pointer and its in-memory Issued event are absent on disk.
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
