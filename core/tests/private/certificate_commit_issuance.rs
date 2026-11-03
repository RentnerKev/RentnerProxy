use super::super::*;

const ID: &str = "0198d98a-0000-7000-8000-000000000771";

struct Directory(PathBuf);
impl Drop for Directory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn store() -> (CertificateStore, Directory) {
    let path = std::env::temp_dir().join(format!(
        "certificate-commit-issuance-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let store = CertificateStore::new(path.clone());
    store.initialize().await.unwrap();
    (store, Directory(path))
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

async fn active_store() -> (CertificateStore, Directory) {
    let (store, directory) = store().await;
    store.begin_issue(ID, request(), false).await.unwrap();
    let pem = material();
    let staged = store
        .stage_acme(ID, &request(), pem.certificate_pem, pem.private_key_pem)
        .await
        .unwrap();
    store.commit_staged(&staged).await.unwrap();
    (store, directory)
}

async fn index_value(store: &CertificateStore) -> serde_json::Value {
    serde_json::to_value(&*store.index.lock().await).unwrap()
}

fn block_index(directory: &Directory) -> (PathBuf, Vec<u8>) {
    let path = directory.0.join("certificates/certificate-metadata.json");
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    (path, bytes)
}

fn repair_index(path: &std::path::Path, bytes: &[u8]) {
    std::fs::remove_dir(path).unwrap();
    std::fs::write(path, bytes).unwrap();
}

#[tokio::test]
async fn commit_persistence_failure_restores_metadata_and_journal_then_allows_retry() {
    for previous in [false, true] {
        for acme in [false, true] {
            if previous && acme {
                continue;
            }
            let (store, directory) = if previous {
                active_store().await
            } else {
                store().await
            };
            let pem = material();
            let staged = if acme {
                store.begin_issue(ID, request(), false).await.unwrap();
                store
                    .stage_acme(ID, &request(), pem.certificate_pem, pem.private_key_pem)
                    .await
                    .unwrap()
            } else {
                store.stage_manual(ID, pem).await.unwrap()
            };
            let before = index_value(&store).await;
            let (path, bytes) = block_index(&directory);
            assert!(matches!(
                store.commit_staged(&staged).await,
                Err(CertificateError::StoreUnavailable)
            ));
            assert_eq!(index_value(&store).await, before);
            repair_index(&path, &bytes);
            let committed = store.commit_staged(&staged).await.unwrap();
            assert_eq!(committed.status, CertificateStatus::Valid);
            assert_eq!(
                committed.current_operation.unwrap().stage,
                CertificateOperationStage::Applied
            );
            assert!(store.pending_candidate_ids().await.unwrap().is_empty());
            store.acquire_lease(ID).await.unwrap();
            store.release_lease(ID).await;
            let reopened = CertificateStore::new(directory.0.clone());
            reopened.initialize().await.unwrap();
            assert_eq!(
                reopened.get(ID).await.unwrap().fingerprint,
                committed.fingerprint
            );
        }
    }
}

#[tokio::test]
async fn renewal_persistence_failure_rolls_back_attempt_and_releases_lease() {
    let (store, directory) = active_store().await;
    let before = index_value(&store).await;
    let (path, bytes) = block_index(&directory);
    assert!(matches!(
        store.begin_renewal(ID).await,
        Err(CertificateError::StoreUnavailable)
    ));
    assert_eq!(index_value(&store).await, before);
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
    repair_index(&path, &bytes);
    let (metadata, request) = store.begin_renewal(ID).await.unwrap();
    assert_eq!(metadata.operation, CertificateOperation::Renewing);
    assert_eq!(request.domains, vec!["example.com"]);
}

#[tokio::test]
async fn renewal_rejects_inconsistent_metadata_without_journal_or_lease_changes() {
    let (store, _directory) = active_store().await;
    let original = store.index.lock().await.certificates[ID].clone();
    for case in 0..6 {
        let mut bad = original.clone();
        let expected = match case {
            0 => {
                bad.metadata.source = CertificateSource::Manual;
                CertificateError::InvalidCertificate
            }
            1 => {
                bad.metadata.operation = CertificateOperation::Issuing;
                CertificateError::OperationInProgress
            }
            2 => {
                bad.metadata.environment = None;
                CertificateError::AcmeFailed
            }
            3 => {
                bad.acme = None;
                CertificateError::InvalidCertificate
            }
            4 => {
                bad.next_attempt_at = Some(
                    (OffsetDateTime::now_utc() + time::Duration::days(1))
                        .format(&Rfc3339)
                        .unwrap(),
                );
                CertificateError::OperationInProgress
            }
            _ => {
                bad.metadata.current_operation = None;
                CertificateError::OperationInProgress
            }
        };
        store.index.lock().await.certificates.insert(ID.into(), bad);
        let before = index_value(&store).await;
        let result = if case == 5 {
            store.begin_acme_retry(ID).await
        } else {
            store.begin_renewal(ID).await
        };
        assert!(
            matches!(result, Err(error) if error == expected),
            "case {case}"
        );
        assert_eq!(index_value(&store).await, before);
        store.acquire_lease(ID).await.unwrap();
        store.release_lease(ID).await;
    }
    store
        .index
        .lock()
        .await
        .certificates
        .insert(ID.into(), original);
    assert!(store.begin_renewal(ID).await.is_ok());
}

#[tokio::test]
async fn deletion_rejects_in_use_busy_or_unknown_certificates() {
    let (store, _directory) = active_store().await;
    assert_eq!(
        store.delete_if_unused(ID, true).await,
        Err(CertificateError::InUse)
    );
    let missing = "0198d98a-0000-7000-8000-000000000772";
    assert_eq!(
        store.delete_if_unused(missing, false).await,
        Err(CertificateError::NotFound)
    );
    store.acquire_lease(missing).await.unwrap();
    store.release_lease(missing).await;
    let (renewal, _) = store.begin_renewal(ID).await.unwrap();
    store.release_lease(ID).await;
    assert_eq!(
        store.delete_if_unused(ID, false).await,
        Err(CertificateError::OperationInProgress)
    );
    assert_eq!(store.get(ID).await.unwrap(), renewal);
}

#[tokio::test]
async fn failed_initial_issue_without_material_remains_deletable() {
    let (store, _directory) = store().await;
    store.begin_issue(ID, request(), false).await.unwrap();
    store.finish_failed(ID, CertificateError::AcmeFailed).await;
    assert!(matches!(
        store.material(ID).await,
        Err(CertificateError::NotFound)
    ));
    store.delete_if_unused(ID, false).await.unwrap();
    assert_eq!(store.get(ID).await, Err(CertificateError::NotFound));
}

#[test]
fn dns_connection_adoption_failure_stays_closed_and_recovers_without_losing_configs() {
    use base64::Engine as _;
    const CHILD: &str = "RENTNERPROXY_CERTIFICATE_ADOPTION_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "runtime::certificates::commit::tests::dns_connection_adoption_failure_stays_closed_and_recovers_without_losing_configs"])
            .env(CHILD, "1")
            .env("APP_ENCRYPTION_KEY", base64::engine::general_purpose::STANDARD.encode([9_u8; 32]))
            .env_remove("APP_ENCRYPTION_KEY_FILE")
            .output().unwrap();
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
            let (store, directory) = store().await;
            let original = DnsProviderConfig::Cloudflare {
                zone_id: "a".repeat(32),
                api_token: "isolated-adoption-test-token".into(),
            };
            let connection = DnsProviderConfig::Connection {
                provider: crate::runtime::dns::capabilities::ProviderId::Cloudflare,
                connection_id: "0198d98a-0000-7000-8000-000000000772".into(),
                zone_id: "a".repeat(32),
            };
            let mut issue = request();
            issue.challenge_type = AcmeChallengeType::Dns01;
            issue.dns_provider = Some(original.clone());
            store.begin_issue(ID, issue.clone(), false).await.unwrap();
            let pem = material();
            let staged = store
                .stage_acme(ID, &issue, pem.certificate_pem, pem.private_key_pem)
                .await
                .unwrap();
            store.commit_staged(&staged).await.unwrap();
            let (_, renewal) = store.begin_renewal(ID).await.unwrap();
            let pem = material();
            let staged = store
                .stage_acme(ID, &renewal, pem.certificate_pem, pem.private_key_pem)
                .await
                .unwrap();
            let configurations = store.dns_configurations().await.unwrap();
            assert_eq!(configurations.len(), 2);
            assert!(
                configurations
                    .iter()
                    .all(|(id, config, available)| id == ID && config == &original && !available)
            );
            store.commit_staged(&staged).await.unwrap();
            let authoritative = index_value(&store).await;
            store.index.lock().await.event_journal_version = 0;
            assert_eq!(
                store.adopt_dns_connection(ID, &original, &connection).await,
                Err(CertificateError::StoreUnavailable)
            );
            assert_eq!(store.readiness().await, CertificateStoreReadiness::Ready);
            assert_eq!(index_value(&store).await, authoritative);
            let before = index_value(&store).await;
            let (path, bytes) = block_index(&directory);
            assert_eq!(
                store.adopt_dns_connection(ID, &original, &connection).await,
                Err(CertificateError::StoreUnavailable)
            );
            assert_eq!(
                store.readiness().await,
                CertificateStoreReadiness::InitializationFailed
            );
            assert_eq!(index_value(&store).await, before);
            assert!(matches!(
                store.dns_configurations().await,
                Err(CertificateError::StoreUnavailable)
            ));
            store.acquire_lease(ID).await.unwrap();
            store.release_lease(ID).await;
            repair_index(&path, &bytes);
            store.initialize().await.unwrap();
            store
                .adopt_dns_connection(ID, &original, &connection)
                .await
                .unwrap();
            assert_eq!(
                store.dns_configurations().await.unwrap(),
                vec![(ID.into(), connection.clone(), true)]
            );
            assert_eq!(
                store
                    .adopt_dns_connection(
                        "0198d98a-0000-7000-8000-000000000773",
                        &original,
                        &connection
                    )
                    .await,
                Err(CertificateError::NotFound)
            );
            store
                .index
                .lock()
                .await
                .certificates
                .get_mut(ID)
                .unwrap()
                .acme = None;
            assert_eq!(
                store.adopt_dns_connection(ID, &original, &connection).await,
                Err(CertificateError::DnsProviderInvalid)
            );
            store.acquire_lease(ID).await.unwrap();
            store.release_lease(ID).await;
        });
}

#[tokio::test]
async fn operation_stage_storage_failures_restore_active_candidate_and_journal() {
    for candidate in [false, true] {
        for manifest_failure in [false, true] {
            if !candidate && manifest_failure {
                continue;
            }
            let (store, directory) = if candidate {
                active_store().await
            } else {
                store().await
            };
            if candidate {
                let (_, issue) = store.begin_renewal(ID).await.unwrap();
                let pem = material();
                store
                    .stage_acme(ID, &issue, pem.certificate_pem, pem.private_key_pem)
                    .await
                    .unwrap();
            } else {
                store.begin_issue(ID, request(), false).await.unwrap();
            }
            store
                .index
                .lock()
                .await
                .certificates
                .get_mut(ID)
                .unwrap()
                .metadata
                .last_error_code = Some(CertificateError::AcmeFailed.code().into());
            let before = index_value(&store).await;
            let path = if manifest_failure {
                directory
                    .0
                    .join("certificates")
                    .join(ID)
                    .join("candidate.json")
            } else {
                directory.0.join("certificates/certificate-metadata.json")
            };
            let bytes = std::fs::read(&path).unwrap();
            std::fs::remove_file(&path).unwrap();
            std::fs::create_dir(&path).unwrap();
            assert_eq!(
                store
                    .record_operation_stage(ID, CertificateOperationStage::Failed)
                    .await,
                Err(CertificateError::StoreUnavailable)
            );
            assert_eq!(index_value(&store).await, before);
            repair_index(&path, &bytes);
            store
                .record_operation_stage(ID, CertificateOperationStage::Failed)
                .await
                .unwrap();
            let failed = store.get(ID).await.unwrap();
            assert_eq!(
                failed.current_operation.unwrap().stage,
                CertificateOperationStage::Failed
            );
            let events = store.events(None, 200).await.unwrap().events;
            assert_eq!(events.last().unwrap().kind, CertificateEventKind::Failed);
            assert_eq!(
                events.last().unwrap().error_code.as_deref(),
                Some(CertificateError::AcmeFailed.code())
            );
            if candidate {
                let index = store.index.lock().await;
                let saved =
                    recovery::read_candidate_manifest(&store.certificates_dir().unwrap(), ID)
                        .unwrap()
                        .unwrap();
                assert_eq!(saved, index.pending_candidates[ID]);
            }
        }
    }
}

#[tokio::test]
async fn interrupted_legacy_attempt_recovery_adds_missing_attempt_time_and_keeps_later_backoff() {
    let (store, directory) = active_store().await;
    let later = (OffsetDateTime::now_utc() + time::Duration::days(1))
        .format(&Rfc3339)
        .unwrap();
    let fingerprint = store.get(ID).await.unwrap().fingerprint;
    {
        let mut index = store.index.lock().await;
        index.event_journal_version = 0;
        let certificate = index.certificates.get_mut(ID).unwrap();
        certificate.metadata.operation = CertificateOperation::Renewing;
        certificate.metadata.last_attempt_at = None;
        certificate.metadata.attempt_count = 0;
        certificate.next_attempt_at = Some(later.clone());
        certificate.retry_delay_seconds = None;
        let path = directory.0.join("certificates/certificate-metadata.json");
        std::fs::write(path, serde_json::to_vec(&*index).unwrap()).unwrap();
    }
    let restored = CertificateStore::new(directory.0.clone());
    restored.initialize().await.unwrap();
    let recovered = restored.get(ID).await.unwrap();
    assert_eq!(recovered.operation, CertificateOperation::Idle);
    assert_eq!(recovered.status, CertificateStatus::Valid);
    assert_eq!(recovered.fingerprint, fingerprint);
    assert_eq!(recovered.next_attempt_at, Some(later));
    assert_eq!(recovered.attempt_count, 1);
    assert!(recovered.last_attempt_at.is_some());
    assert_eq!(
        recovered.current_operation.unwrap().stage,
        CertificateOperationStage::RetryScheduled
    );
    assert_eq!(
        restored.index.lock().await.event_journal_version,
        default_event_journal_version()
    );
    let after_recovery = index_value(&restored).await;
    let reopened = CertificateStore::new(directory.0.clone());
    reopened.initialize().await.unwrap();
    assert_eq!(index_value(&reopened).await, after_recovery);
}

#[tokio::test]
async fn explicit_renewal_preserves_acme_configuration_and_material_without_new_terms() {
    let (store, _directory) = active_store().await;
    let previous = store.index.lock().await.certificates[ID].clone();
    let mut renewal = request();
    renewal.accept_terms = false;
    let accepted = store.begin_issue(ID, renewal, true).await.unwrap();
    assert_eq!(accepted.operation, CertificateOperation::Renewing);
    assert_eq!(
        accepted.current_operation.unwrap().kind,
        OperationKind::Renew
    );
    let updated = store.index.lock().await.certificates[ID].clone();
    assert_eq!(updated.acme, previous.acme);
    assert_eq!(updated.material_id, previous.material_id);
    assert_eq!(updated.metadata.fingerprint, previous.metadata.fingerprint);
    assert_eq!(
        updated.metadata.last_success_at,
        previous.metadata.last_success_at
    );
    assert_eq!(
        updated.metadata.attempt_count,
        previous.metadata.attempt_count + 1
    );
}

#[tokio::test]
async fn terminal_manual_operations_never_resume_automatic_renewal() {
    let (store, _directory) = active_store().await;
    let original = store.index.lock().await.certificates[ID].clone();
    for stage in [
        CertificateOperationStage::NeedsAttention,
        CertificateOperationStage::Cancelled,
        CertificateOperationStage::Expired,
    ] {
        let mut manual = original.clone();
        manual.acme.as_mut().unwrap().dns_mode = DnsValidationMode::Manual;
        manual.acme.as_mut().unwrap().challenge_type = AcmeChallengeType::Dns01;
        manual.metadata.challenge_type = Some(AcmeChallengeType::Dns01);
        manual.metadata.current_operation.as_mut().unwrap().stage = stage;
        store
            .index
            .lock()
            .await
            .certificates
            .insert(ID.into(), manual);
        assert!(!store.renewal_is_allowed(ID).await, "{stage:?}");
    }
    store
        .index
        .lock()
        .await
        .certificates
        .insert(ID.into(), original);
    assert!(store.renewal_is_allowed(ID).await);
}

#[tokio::test]
async fn legacy_staged_acme_commit_resets_backoff_and_preserves_existing_material() {
    let (store, _directory) = active_store().await;
    let previous = store.index.lock().await.certificates[ID].clone();
    let mut stored = previous.clone();
    stored.metadata.attempt_count = 12;
    stored.next_attempt_at = Some(
        (OffsetDateTime::now_utc() + time::Duration::days(1))
            .format(&Rfc3339)
            .unwrap(),
    );
    stored.retry_delay_seconds = Some(1800);
    let staged = StagedCertificate {
        id: ID.into(),
        stored,
    };
    let committed = store.commit_staged(&staged).await.unwrap();
    assert_eq!(committed.fingerprint, previous.metadata.fingerprint);
    assert_eq!(committed.last_attempt_at, previous.metadata.last_attempt_at);
    assert_eq!(committed.attempt_count, 0);
    assert!(committed.next_attempt_at.is_none());
    assert!(committed.last_success_at.is_some());
    let current = store.index.lock().await.certificates[ID].clone();
    assert_eq!(current.material_id, previous.material_id);
    assert!(current.retry_delay_seconds.is_none());
    assert_eq!(current.acme, previous.acme);
}

#[tokio::test]
async fn activation_ignores_already_promoted_material_and_rejects_operationless_corruption() {
    let (store, _directory) = active_store().await;
    let (_, issue) = store.begin_renewal(ID).await.unwrap();
    let pem = material();
    let staged = store
        .stage_acme(ID, &issue, pem.certificate_pem, pem.private_key_pem)
        .await
        .unwrap();
    store
        .finish_candidate_failed(&staged, CertificateError::RuntimeApplyFailed)
        .await;
    let original = store.index.lock().await.pending_candidates[ID].clone();
    {
        let mut index = store.index.lock().await;
        let active_material = index.certificates[ID].material_id.clone();
        index
            .pending_candidates
            .get_mut(ID)
            .unwrap()
            .staged
            .material_id = active_material;
    }
    let before = index_value(&store).await;
    assert!(
        store
            .begin_candidate_activation(ID, false)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(index_value(&store).await, before);
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
    {
        let mut index = store.index.lock().await;
        index.pending_candidates.insert(ID.into(), original);
        index
            .pending_candidates
            .get_mut(ID)
            .unwrap()
            .staged
            .metadata
            .current_operation = None;
    }
    let material = store.staged_material(&staged).unwrap();
    std::fs::write(&material.fullchain_path, "corrupt-candidate-certificate").unwrap();
    let before = index_value(&store).await;
    assert!(store.begin_candidate_activation(ID, false).await.is_err());
    assert_eq!(index_value(&store).await, before);
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
}

#[tokio::test]
async fn discarding_a_failed_first_issue_keeps_failure_metadata_and_releases_the_lease() {
    let (store, _directory) = store().await;
    store.begin_issue(ID, request(), false).await.unwrap();
    let pem = material();
    let staged = store
        .stage_acme(ID, &request(), pem.certificate_pem, pem.private_key_pem)
        .await
        .unwrap();
    let mut stale = staged.clone();
    stale.stored.metadata.current_operation = None;
    let before = index_value(&store).await;
    store.discard_staged(&stale).await;
    assert_eq!(index_value(&store).await, before);
    store.acquire_lease(ID).await.unwrap();
    store.discard_staged(&staged).await;
    let failed = store.get(ID).await.unwrap();
    assert_eq!(failed.status, CertificateStatus::Failed);
    assert_eq!(
        failed.last_error_code.as_deref(),
        Some(CertificateError::RuntimeApplyFailed.code())
    );
    assert_eq!(
        failed.current_operation.unwrap().stage,
        CertificateOperationStage::Failed
    );
    store.acquire_lease(ID).await.unwrap();
    store.release_lease(ID).await;
}
