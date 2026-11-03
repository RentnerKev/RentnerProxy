use super::*;

struct TestDirectory(std::path::PathBuf);

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn active_store() -> (CertificateStore, TestDirectory) {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    store.initialize().await.unwrap();
    let request = issue_request();
    store.begin_issue(ID, request.clone(), false).await.unwrap();
    let material = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &request,
            material.cert.pem(),
            material.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    (store, TestDirectory(directory))
}

async fn retryable_candidate() -> (CertificateStore, StagedCertificate, TestDirectory) {
    let (store, directory) = active_store().await;
    let (_, request) = store.begin_renewal(ID).await.unwrap();
    let material = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    let staged = store
        .stage_acme(
            ID,
            &request,
            material.cert.pem(),
            material.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    store
        .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
        .await;
    (store, staged, directory)
}

async fn assert_lease_released(store: &CertificateStore) {
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
}

#[tokio::test]
async fn candidate_validation_rejects_corrupt_recovery_metadata() {
    let (store, _, _directory) = retryable_candidate().await;
    let candidate = store.index.lock().await.pending_candidates[ID].clone();
    assert!(recovery::candidate_is_valid(ID, &candidate));
    for mutation in 0..25 {
        let mut bad = candidate.clone();
        match mutation {
            0 => bad.version += 1,
            1 => bad.staged.metadata.id = "another-id".into(),
            2 => bad.staged.metadata.source = CertificateSource::Manual,
            3 => bad.staged.metadata.environment = None,
            4 => bad.staged.metadata.status = CertificateStatus::Failed,
            5 => bad.staged.metadata.operation = CertificateOperation::Issuing,
            6 => bad.staged.metadata.domains.clear(),
            7 => bad.staged.metadata.domains = vec!["not a domain".into()],
            8 => bad.staged.material_id = None,
            9 => bad.staged.material_id = Some("z".repeat(64)),
            10 => bad.staged.metadata.fingerprint = None,
            11 => bad.staged.metadata.issued_at = Some("invalid".into()),
            12 => bad.staged.metadata.expires_at = Some("invalid".into()),
            13 => bad.staged.metadata.updated_at = "invalid".into(),
            14 => bad.staged.metadata.issuer = Some("x".repeat(513)),
            15 => bad.staged.next_attempt_at = Some("invalid".into()),
            16 => bad.staged.retry_delay_seconds = Some(0),
            17 => bad.base_material_id = Some("short".into()),
            18 => bad.activation_operation = CertificateOperation::Idle,
            19 => bad.activation.next_attempt_at = Some("invalid".into()),
            20 => bad.activation.last_attempt_at = Some("invalid".into()),
            21 => bad.activation.last_error_code = Some("x".repeat(129)),
            22 => bad.activation.retry_delay_seconds = Some(0),
            23 => bad.staged.acme = None,
            _ => bad.staged.metadata.domains = vec!["example.com".into(); 101],
        }
        assert!(
            !recovery::candidate_is_valid(ID, &bad),
            "mutation {mutation}"
        );
    }
    assert!(!recovery::candidate_is_valid("../invalid", &candidate));
    let mut extended = candidate;
    extended.staged.next_attempt_at = Some("2030-01-01T00:00:00Z".into());
    extended.staged.retry_delay_seconds = Some(MIN_ACME_RETRY_DELAY_SECONDS);
    extended.activation.retry_delay_seconds = Some(MIN_CANDIDATE_RETRY_DELAY_SECONDS);
    assert!(recovery::candidate_is_valid(ID, &extended));
}

#[tokio::test]
async fn candidate_commit_rolls_back_journal_and_material_on_persistence_failure() {
    let (store, _, directory) = retryable_candidate().await;
    let staged = store
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    let path = directory
        .0
        .join("certificates")
        .join(CERTIFICATE_INDEX_FILE);
    let bytes = std::fs::read(&path).unwrap();
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    let fingerprint = store.get(ID).await.unwrap().fingerprint;
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(matches!(
        store.commit_staged(&staged).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
    assert_eq!(store.get(ID).await.unwrap().fingerprint, fingerprint);
    assert!(
        directory
            .0
            .join("certificates")
            .join(ID)
            .join(CANDIDATE_MANIFEST_FILE)
            .is_file()
    );
    std::fs::remove_dir(&path).unwrap();
    std::fs::write(path, bytes).unwrap();
    let committed = store.commit_staged(&staged).await.unwrap();
    assert_ne!(committed.fingerprint, fingerprint);
    assert!(store.pending_candidate_ids().await.unwrap().is_empty());
    assert_lease_released(&store).await;
}

#[tokio::test]
async fn stale_candidate_commit_cannot_replace_missing_or_changed_active_material() {
    let (store, staged, _directory) = retryable_candidate().await;
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    let mut wrong = staged.clone();
    wrong.stored.material_id = Some("0".repeat(64));
    assert!(matches!(
        store.commit_staged(&wrong).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
    let active = store.index.lock().await.certificates.remove(ID).unwrap();
    assert!(matches!(
        store.commit_staged(&staged).await,
        Err(CertificateError::StoreUnavailable)
    ));
    store
        .index
        .lock()
        .await
        .certificates
        .insert(ID.into(), active.clone());
    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .material_id = None;
    assert!(matches!(
        store.commit_staged(&staged).await,
        Err(CertificateError::StoreUnavailable)
    ));
    store
        .index
        .lock()
        .await
        .certificates
        .insert(ID.into(), active);
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
}

#[tokio::test]
async fn legacy_candidate_recovery_reconstructs_missing_operation_and_sidecar() {
    for indexed_only in [false, true] {
        let (store, _, _directory) = retryable_candidate().await;
        let directory = store.certificates_dir().unwrap();
        let mut index = store.index.lock().await;
        let mut candidate = index.pending_candidates[ID].clone();
        candidate.staged.metadata.current_operation = None;
        index
            .certificates
            .get_mut(ID)
            .unwrap()
            .metadata
            .current_operation = None;
        if indexed_only {
            index.pending_candidates.insert(ID.into(), candidate);
            recovery::remove_candidate_manifest(&directory, ID).unwrap();
        } else {
            recovery::persist_candidate_manifest(&directory, ID, &candidate).unwrap();
            index.pending_candidates.remove(ID);
        }
        assert!(recovery::reconcile_candidate_manifests(&directory, &mut index).unwrap());
        let restored = &index.pending_candidates[ID];
        let operation = restored.staged.metadata.current_operation.as_ref().unwrap();
        assert_eq!(operation.kind, OperationKind::Renew);
        assert_eq!(
            index.certificates[ID]
                .metadata
                .current_operation
                .as_ref()
                .unwrap()
                .id,
            operation.id
        );
        if !indexed_only {
            assert!(
                index
                    .events
                    .iter()
                    .any(|event| event.operation_id == operation.id
                        && event.kind == CertificateEventKind::Issued)
            );
        }
        assert!(
            recovery::read_candidate_manifest(&directory, ID)
                .unwrap()
                .is_some()
        );
        let operation_id = operation.id.clone();
        let event_count = index.events.len();
        recovery::reconcile_candidate_manifests(&directory, &mut index).unwrap();
        assert_eq!(
            index.pending_candidates[ID]
                .staged
                .metadata
                .current_operation
                .as_ref()
                .unwrap()
                .id,
            operation_id
        );
        assert_eq!(index.events.len(), event_count);
    }
}

#[tokio::test]
async fn recovered_candidate_cannot_cross_an_active_material_generation() {
    let (store, _, _directory) = retryable_candidate().await;
    let directory = store.certificates_dir().unwrap();
    let mut index = store.index.lock().await;
    let candidate = index.pending_candidates[ID].clone();
    let active = index.certificates[ID].clone();
    index.certificates.get_mut(ID).unwrap().material_id = Some("0".repeat(64));
    assert!(matches!(
        recovery::reconcile_candidate_manifests(&directory, &mut index),
        Err(CertificateError::StoreUnavailable)
    ));
    index.pending_candidates.remove(ID);
    assert!(matches!(
        recovery::reconcile_candidate_manifests(&directory, &mut index),
        Err(CertificateError::StoreUnavailable)
    ));
    index.certificates.insert(ID.into(), active);
    recovery::remove_candidate_manifest(&directory, ID).unwrap();
    index.pending_candidates.insert(ID.into(), candidate);
    index.certificates.get_mut(ID).unwrap().material_id = Some("0".repeat(64));
    assert!(matches!(
        recovery::reconcile_candidate_manifests(&directory, &mut index),
        Err(CertificateError::StoreUnavailable)
    ));
}

#[tokio::test]
async fn deleting_certificate_rolls_back_renamed_material_when_index_write_fails() {
    let (store, directory) = active_store().await;
    let certificates = directory.0.join("certificates");
    let index_path = certificates.join(CERTIFICATE_INDEX_FILE);
    let bytes = std::fs::read(&index_path).unwrap();
    let before = store.get(ID).await.unwrap();
    let material = store.material(ID).await.unwrap();
    std::fs::remove_file(&index_path).unwrap();
    std::fs::create_dir(&index_path).unwrap();
    assert!(matches!(
        store.delete_if_unused(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(store.get(ID).await.unwrap(), before);
    assert!(certificates.join(ID).is_dir());
    assert!(material.fullchain_path.is_file());
    assert_lease_released(&store).await;
    std::fs::remove_dir(&index_path).unwrap();
    std::fs::write(index_path, bytes).unwrap();
    store.delete_if_unused(ID, false).await.unwrap();
    assert!(matches!(
        store.get(ID).await,
        Err(CertificateError::NotFound)
    ));
    assert!(!certificates.join(ID).exists());
    assert_lease_released(&store).await;
}

#[tokio::test]
async fn lost_or_nonregular_material_directory_cannot_be_deleted_as_a_valid_certificate() {
    let (store, directory) = active_store().await;
    let path = directory.0.join("certificates").join(ID);
    let moved = directory.0.join("saved-certificate");
    let before = store.get(ID).await.unwrap();
    std::fs::rename(&path, &moved).unwrap();
    assert!(matches!(
        store.delete_if_unused(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(store.get(ID).await.unwrap(), before);
    assert_lease_released(&store).await;
    std::fs::write(&path, b"invalid directory").unwrap();
    assert!(matches!(
        store.delete_if_unused(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(std::fs::read(&path).unwrap(), b"invalid directory");
    assert_eq!(store.get(ID).await.unwrap(), before);
    assert_lease_released(&store).await;
    std::fs::remove_file(&path).unwrap();
    std::fs::rename(moved, path).unwrap();
    assert!(store.material(ID).await.is_ok());
}

#[tokio::test]
async fn stale_or_busy_candidate_activation_preserves_material_and_releases_lease() {
    let (store, _, _directory) = retryable_candidate().await;
    let (active, candidate, events) = {
        let mut index = store.index.lock().await;
        (
            index.certificates.remove(ID).unwrap(),
            index.pending_candidates[ID].clone(),
            index.events.clone(),
        )
    };
    assert!(matches!(
        store.begin_candidate_activation(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_lease_released(&store).await;
    store
        .index
        .lock()
        .await
        .certificates
        .insert(ID.to_owned(), active.clone());

    store
        .index
        .lock()
        .await
        .pending_candidates
        .get_mut(ID)
        .unwrap()
        .base_material_id = None;
    assert!(matches!(
        store.begin_candidate_activation(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_lease_released(&store).await;
    store
        .index
        .lock()
        .await
        .pending_candidates
        .insert(ID.to_owned(), candidate.clone());

    store
        .index
        .lock()
        .await
        .certificates
        .get_mut(ID)
        .unwrap()
        .metadata
        .operation = CertificateOperation::Renewing;
    assert!(matches!(
        store.begin_candidate_activation(ID, false).await,
        Err(CertificateError::OperationInProgress)
    ));
    assert_lease_released(&store).await;
    {
        let mut index = store.index.lock().await;
        index.certificates.insert(ID.to_owned(), active.clone());
        assert_eq!(index.pending_candidates[ID], candidate);
        assert_eq!(index.events, events);
    }
    assert_eq!(
        store.get(ID).await.unwrap().fingerprint,
        active.metadata.fingerprint
    );
    let staged = store
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    let committed = store.commit_staged(&staged).await.unwrap();
    assert_ne!(committed.fingerprint, active.metadata.fingerprint);
    assert!(store.pending_candidate_ids().await.unwrap().is_empty());
}

#[tokio::test]
async fn scheduled_activation_honors_backoff_but_explicit_retry_can_publish_candidate() {
    let (store, _, _directory) = retryable_candidate().await;
    let deadline = (OffsetDateTime::now_utc() + time::Duration::days(1))
        .format(&Rfc3339)
        .unwrap();
    store
        .index
        .lock()
        .await
        .pending_candidates
        .get_mut(ID)
        .unwrap()
        .activation
        .next_attempt_at = Some(deadline);
    let before = store.index.lock().await.pending_candidates[ID].clone();
    assert!(before.activation.next_attempt_at.is_some());
    assert!(
        store
            .begin_candidate_activation(ID, true)
            .await
            .unwrap()
            .is_none()
    );
    assert_lease_released(&store).await;
    assert_eq!(store.index.lock().await.pending_candidates[ID], before);

    let staged = store
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    let attempted = store.index.lock().await.pending_candidates[ID].clone();
    assert_eq!(
        attempted.activation.attempt_count,
        before.activation.attempt_count + 1
    );
    assert!(attempted.activation.next_attempt_at.is_none());
    assert!(attempted.activation.last_error_code.is_none());
    let published = store.commit_staged(&staged).await.unwrap();
    assert_eq!(published.status, CertificateStatus::Valid);
    assert_eq!(published.operation, CertificateOperation::Idle);
    assert!(store.pending_candidate_ids().await.unwrap().is_empty());
}

#[tokio::test]
async fn activation_manifest_write_failure_preserves_candidate_and_allows_repaired_retry() {
    let (store, _, directory) = retryable_candidate().await;
    let manifest = directory
        .0
        .join("certificates")
        .join(ID)
        .join(CANDIDATE_MANIFEST_FILE);
    let bytes = std::fs::read(&manifest).unwrap();
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    std::fs::remove_file(&manifest).unwrap();
    std::fs::create_dir(&manifest).unwrap();

    assert!(matches!(
        store.begin_candidate_activation(ID, false).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_lease_released(&store).await;
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );

    std::fs::remove_dir(&manifest).unwrap();
    std::fs::write(&manifest, bytes).unwrap();
    let staged = store
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    assert!(!manifest.exists());
    assert_eq!(
        store.get(ID).await.unwrap().status,
        CertificateStatus::Valid
    );
}

#[tokio::test]
async fn delayed_failure_from_stale_or_completed_candidate_cannot_change_current_state() {
    let (store, staged, _directory) = retryable_candidate().await;
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    let mut stale = staged.clone();
    stale.stored.material_id = Some("stale-material".to_owned());
    store
        .finish_candidate_failed(&stale, CertificateError::AcmeFailed)
        .await;
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
    assert_lease_released(&store).await;

    let staged = store
        .begin_candidate_activation(ID, false)
        .await
        .unwrap()
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    let published = serde_json::to_value(&*store.index.lock().await).unwrap();
    store
        .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
        .await;
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        published
    );
    assert_lease_released(&store).await;
}

#[tokio::test]
async fn invalid_issue_requests_leave_metadata_journal_and_leases_unchanged() {
    let directory = state_dir();
    std::fs::create_dir_all(&directory).unwrap();
    let store = CertificateStore::new(directory.clone());
    let _directory = TestDirectory(directory);
    store.initialize().await.unwrap();
    let mut terms = issue_request();
    terms.accept_terms = false;
    let mut dns = issue_request();
    dns.challenge_type = AcmeChallengeType::Dns01;
    let mut duplicate = issue_request();
    duplicate.domains.push(duplicate.domains[0].clone());
    for (request, expected) in [
        (terms, CertificateError::TermsRequired),
        (dns, CertificateError::AcmeDnsRequired),
        (duplicate, CertificateError::AcmeDomainInvalid),
    ] {
        let error = store.begin_issue(ID, request, false).await.unwrap_err();
        assert_eq!(error.code(), expected.code());
        assert!(store.list().await.unwrap().is_empty());
        assert!(store.events(None, 20).await.unwrap().events.is_empty());
        assert_lease_released(&store).await;
    }
    assert!(store.begin_issue(ID, issue_request(), false).await.is_ok());
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
}

#[tokio::test]
async fn renewal_index_write_failure_restores_live_metadata_and_journal_until_repaired() {
    let (store, directory) = active_store().await;
    let path = directory
        .0
        .join("certificates")
        .join(CERTIFICATE_INDEX_FILE);
    let bytes = std::fs::read(&path).unwrap();
    let before = serde_json::to_value(&*store.index.lock().await).unwrap();
    let fingerprint = store.get(ID).await.unwrap().fingerprint;
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(matches!(
        store.begin_renewal(ID).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_lease_released(&store).await;
    assert_eq!(
        serde_json::to_value(&*store.index.lock().await).unwrap(),
        before
    );
    assert_eq!(store.get(ID).await.unwrap().fingerprint, fingerprint);
    std::fs::remove_dir(&path).unwrap();
    std::fs::write(&path, bytes).unwrap();
    assert!(store.begin_renewal(ID).await.is_ok());
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    assert_eq!(store.get(ID).await.unwrap().fingerprint, fingerprint);
}
