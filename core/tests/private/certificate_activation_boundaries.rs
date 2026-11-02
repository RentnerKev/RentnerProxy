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
