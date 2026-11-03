use super::super::*;

const ID: &str = "0198d98a-0000-7000-8000-000000000881";

struct Directory(PathBuf);

impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn store() -> (CertificateStore, Directory) {
    let directory = std::env::temp_dir().join(format!(
        "certificate-staging-boundaries-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    (store, Directory(directory))
}

fn request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".into()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: AcmeChallengeType::Http01,
        dns_mode: DnsValidationMode::Provider,
        dns_provider: None,
        accept_terms: true,
    }
}

fn material() -> CertificateImportRequest {
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".into()]).unwrap();
    CertificateImportRequest {
        certificate_pem: certificate.cert.pem(),
        private_key_pem: certificate.signing_key.serialize_pem(),
        chain_pem: None,
        required_domains: None,
    }
}

#[tokio::test]
async fn manual_replacement_persistence_failure_restores_active_state_journal_and_lease() {
    let (store, directory) = store().await;
    let request = request();
    store.begin_issue(ID, request.clone(), false).await.unwrap();
    let pem = material();
    let staged = store
        .stage_acme(ID, &request, pem.certificate_pem, pem.private_key_pem)
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .acme
        .as_mut()
        .unwrap()
        .cancel_requested = true;
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    let index_path = directory.0.join("certificates/certificate-metadata.json");
    let persisted = std::fs::read(&index_path).unwrap();
    std::fs::remove_file(&index_path).unwrap();
    std::fs::create_dir(&index_path).unwrap();
    assert!(matches!(
        store.stage_manual(ID, material()).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
    std::fs::remove_dir(&index_path).unwrap();
    std::fs::write(&index_path, persisted).unwrap();
    let staged = store.stage_manual(ID, material()).await.unwrap();
    assert!(!staged.is_acme());
    let index = store.index.lock().await;
    let active = &index.certificates[ID];
    assert!(!active.acme.as_ref().unwrap().cancel_requested);
    assert_eq!(
        active.metadata.current_operation.as_ref().unwrap().kind,
        OperationKind::Import
    );
    assert_eq!(
        index.events.len(),
        before["events"].as_array().unwrap().len() + 2
    );
}

#[tokio::test]
async fn acme_staging_rejects_missing_idle_cancelled_and_duplicate_candidates() {
    for scenario in 0..5 {
        let (store, _directory) = store().await;
        let request = request();
        if scenario > 0 {
            store.begin_issue(ID, request.clone(), false).await.unwrap();
            let mut index = store.index.lock().await;
            let active = index.certificates.get_mut(ID).unwrap();
            match scenario {
                1 => active.metadata.operation = CertificateOperation::Idle,
                2 => {
                    let acme = active.acme.as_mut().unwrap();
                    acme.challenge_type = AcmeChallengeType::Dns01;
                    acme.dns_mode = DnsValidationMode::Delegated;
                    acme.cancel_requested = true;
                    active.metadata.challenge_type = Some(AcmeChallengeType::Dns01);
                }
                3 => active.metadata.current_operation = None,
                _ => {}
            }
        }
        if scenario == 4 {
            let pem = material();
            store
                .stage_acme(ID, &request, pem.certificate_pem, pem.private_key_pem)
                .await
                .unwrap();
        }
        let before = serde_json::to_value(&*store.index.lock().await).unwrap();
        let pem = material();
        let error = store
            .stage_acme(ID, &request, pem.certificate_pem, pem.private_key_pem)
            .await
            .err()
            .unwrap();
        assert_eq!(
            error,
            match scenario {
                0 => CertificateError::NotFound,
                2 => CertificateError::AcmeCancelled,
                _ => CertificateError::OperationInProgress,
            }
        );
        assert_eq!(
            serde_json::to_value(&*store.index.lock().await).unwrap(),
            before
        );
        if scenario == 3 {
            store.acquire_lease(ID).await.unwrap();
            store.release_lease(ID).await;
        }
    }
}

#[tokio::test]
async fn invalid_import_material_and_domain_limits_leave_store_empty_and_release_leases() {
    let (store, _directory) = store().await;
    for scenario in 0..6 {
        let mut pem = material();
        let id = if scenario == 0 { "not-an-id" } else { ID };
        match scenario {
            1 => pem.certificate_pem = "x".repeat(MAX_CERTIFICATE_PEM_BYTES + 1),
            2 => pem.private_key_pem = "x".repeat(MAX_PRIVATE_KEY_PEM_BYTES + 1),
            3 => pem.chain_pem = Some("x".repeat(MAX_CERTIFICATE_PEM_BYTES + 1)),
            4 => pem.required_domains = Some(vec!["example.com".into(); 101]),
            5 => pem.required_domains = Some(vec!["other.example.com".into()]),
            _ => {}
        }
        assert!(matches!(
            store.stage_manual(id, pem).await,
            Err(CertificateError::InvalidCertificate | CertificateError::DomainMismatch)
        ));
        assert!(store.index.lock().await.certificates.is_empty());
        store.acquire_lease(id).await.unwrap();
        store.release_lease(id).await;
    }
}

#[tokio::test]
async fn non_directory_material_parents_reject_import_and_release_the_lease_for_repair() {
    for blocked in [ID.to_owned(), format!("{ID}/versions")] {
        let (store, directory) = store().await;
        let obstacle = directory.0.join("certificates").join(blocked);
        std::fs::create_dir_all(obstacle.parent().unwrap()).unwrap();
        std::fs::write(&obstacle, b"not a directory").unwrap();
        let pem = material();
        assert!(matches!(
            store.stage_manual(ID, pem.clone()).await,
            Err(CertificateError::StoreUnavailable)
        ));
        assert!(store.index.lock().await.certificates.is_empty());
        std::fs::remove_file(&obstacle).unwrap();
        let staged = store.stage_manual(ID, pem).await.unwrap();
        assert!(staged.covers_domains(&["example.com".into()]));
        store.commit_staged(&staged).await.unwrap();
    }
}

#[tokio::test]
async fn invalid_live_context_preserves_durable_candidate_for_restart_recovery() {
    let (store, directory) = store().await;
    let request = request();
    store.begin_issue(ID, request.clone(), false).await.unwrap();
    let index_path = directory.0.join("certificates/certificate-metadata.json");
    let persisted = std::fs::read(&index_path).unwrap();
    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .acme = None;
    let pem = material();
    assert!(matches!(
        store
            .stage_acme(ID, &request, pem.certificate_pem, pem.private_key_pem)
            .await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(std::fs::read(&index_path).unwrap(), persisted);
    let active = store.get(ID).await.unwrap();
    assert_eq!(active.status, CertificateStatus::Pending);
    assert!(active.fingerprint.is_none());
    assert!(
        directory
            .0
            .join("certificates")
            .join(ID)
            .join(CANDIDATE_MANIFEST_FILE)
            .is_file()
    );
    let restarted = CertificateStore::new(directory.0.clone());
    restarted.initialize().await.unwrap();
    assert_eq!(restarted.pending_candidate_ids().await.unwrap(), [ID]);
    let candidate = restarted
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    assert!(candidate.stored.acme.is_some());
    assert!(candidate.covers_domains(&request.domains));
    let committed = restarted.commit_staged(&candidate).await.unwrap();
    assert_eq!(committed.status, CertificateStatus::Valid);
    assert!(committed.fingerprint.is_some());
}
