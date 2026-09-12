use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::runtime::{
    CertificateEnvironment, CertificateError, CertificateImportRequest, CertificateIssueRequest,
    CertificateSource, CertificateStatus, CertificateStore,
};

use super::fixtures::fail_next_private_key_write_below;

static STORE_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[tokio::test]
async fn retry_attempt_history_continues_after_backoff_has_reached_its_cap() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).unwrap();
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.unwrap();
    let id = "0198d98a-0000-7000-8000-000000000007";
    let request = CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    };
    store.begin_issue(id, request.clone(), false).await.unwrap();
    store.finish_failed(id, CertificateError::AcmeFailed).await;
    drop(store);

    // Resume a long-running failure history with its deadline already elapsed.
    // The delay is capped, but the observable attempt counter must keep growing.
    let path = state_dir.join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    index["certificates"][id]["attemptCount"] = 32.into();
    index["certificates"][id]["retryDelaySeconds"] = 21_600.into();
    index["certificates"][id]["nextAttemptAt"] = "2000-01-01T00:00:00Z".into();
    std::fs::write(&path, serde_json::to_vec(&index).unwrap()).unwrap();

    let restarted = CertificateStore::new(state_dir.clone());
    restarted.initialize().await.unwrap();
    let attempt = restarted.begin_issue(id, request, false).await.unwrap();
    assert_eq!(attempt.attempt_count, 33);
    restarted
        .finish_failed(id, CertificateError::AcmeFailed)
        .await;
    let failed = restarted.get(id).await.unwrap();
    assert_eq!(failed.attempt_count, 33);
    drop(restarted);
    let reopened = CertificateStore::new(state_dir);
    reopened.initialize().await.unwrap();
    assert_eq!(reopened.get(id).await.unwrap().attempt_count, 33);
    assert!(!reopened.renewal_is_allowed(id).await);
    let index: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(index["certificates"][id]["retryDelaySeconds"], 21_600);
}

fn test_state_dir() -> std::path::PathBuf {
    let counter = STORE_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "rentnerproxy-certificate-store-{}-{}-{counter}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos(),
    ))
}

fn acme_request() -> CertificateIssueRequest {
    CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    }
}

fn import_request() -> (CertificateImportRequest, String) {
    let certificate = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()])
        .expect("test certificate should generate");
    (
        CertificateImportRequest {
            certificate_pem: certificate.cert.pem(),
            private_key_pem: certificate.signing_key.serialize_pem(),
            chain_pem: None,
            required_domains: Some(vec!["example.com".to_owned()]),
        },
        certificate.cert.pem(),
    )
}

async fn active_acme_store(state_dir: PathBuf, id: &str) -> (CertificateStore, String, PathBuf) {
    std::fs::create_dir_all(&state_dir).expect("test state directory should exist");
    let store = CertificateStore::new(state_dir);
    store.initialize().await.expect("store should initialize");
    let request = acme_request();
    store
        .begin_issue(id, request.clone(), false)
        .await
        .expect("initial ACME issue should begin");
    let (material, _) = import_request();
    let staged = store
        .stage_acme(
            id,
            &request,
            material.certificate_pem,
            material.private_key_pem,
        )
        .await
        .expect("initial ACME material should stage");
    let metadata = store
        .commit_staged(&staged)
        .await
        .expect("initial ACME material should activate");
    let fingerprint = metadata
        .fingerprint
        .expect("active material should have a fingerprint");
    let active_version = store
        .material(id)
        .await
        .expect("active material should resolve")
        .fullchain_path
        .parent()
        .expect("active version directory should exist")
        .to_owned();
    (store, fingerprint, active_version)
}

async fn stage_acme_candidate(store: &CertificateStore, state_dir: &Path, id: &str) -> PathBuf {
    let (_, renewal_request) = store.begin_renewal(id).await.expect("renewal should begin");
    let (material, _) = import_request();
    let _staged = store
        .stage_acme(
            id,
            &renewal_request,
            material.certificate_pem,
            material.private_key_pem,
        )
        .await
        .expect("renewal material should stage");
    let candidate_manifest = state_dir
        .join("certificates")
        .join(id)
        .join("candidate.json");
    let candidate: serde_json::Value = serde_json::from_slice(
        &std::fs::read(&candidate_manifest).expect("candidate sidecar should exist"),
    )
    .expect("candidate sidecar should be JSON");
    let material_id = candidate["staged"]["materialId"]
        .as_str()
        .expect("candidate should point at material")
        .to_owned();
    candidate_manifest
        .parent()
        .expect("candidate directory should exist")
        .join("versions")
        .join(material_id)
}

fn copy_material_version(source: &Path, destination: &Path) {
    std::fs::create_dir(destination).expect("unreferenced version directory should create");
    for name in ["fullchain.pem", "private-key.pem"] {
        std::fs::copy(source.join(name), destination.join(name))
            .expect("material version file should copy");
    }
}

#[tokio::test]
async fn staged_candidate_preserves_active_material_across_restart() {
    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000010";
    let (store, old_fingerprint, _) = active_acme_store(state_dir.clone(), id).await;
    let candidate_version = stage_acme_candidate(&store, &state_dir, id).await;
    let before_restart = store
        .get(id)
        .await
        .expect("active metadata should remain readable");
    assert_eq!(
        before_restart.fingerprint.as_deref(),
        Some(old_fingerprint.as_str())
    );
    assert!(before_restart.candidate.is_some());
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened
        .initialize()
        .await
        .expect("candidate should recover");
    let metadata = reopened
        .get(id)
        .await
        .expect("metadata should survive restart");
    assert_eq!(
        metadata.fingerprint.as_deref(),
        Some(old_fingerprint.as_str())
    );
    assert_ne!(
        metadata
            .candidate
            .as_ref()
            .map(|candidate| candidate.fingerprint.as_str()),
        Some(old_fingerprint.as_str())
    );
    assert_eq!(
        reopened.pending_candidate_ids().await.unwrap(),
        vec![id.to_owned()]
    );
    assert!(candidate_version.join("fullchain.pem").is_file());
}

#[tokio::test]
async fn candidate_sidecar_recovers_when_pending_index_entry_is_missing() {
    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000011";
    let (store, _, _) = active_acme_store(state_dir.clone(), id).await;
    stage_acme_candidate(&store, &state_dir, id).await;
    drop(store);

    let index_path = state_dir.join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    index
        .as_object_mut()
        .expect("certificate index should be an object")
        .remove("pendingCandidates");
    std::fs::write(&index_path, serde_json::to_vec(&index).unwrap()).unwrap();

    let reopened = CertificateStore::new(state_dir);
    reopened
        .initialize()
        .await
        .expect("sidecar should restore candidate");
    assert_eq!(
        reopened.pending_candidate_ids().await.unwrap(),
        vec![id.to_owned()]
    );
    assert!(reopened.get(id).await.unwrap().candidate.is_some());
}

#[tokio::test]
async fn stale_promoted_candidate_sidecar_is_removed_before_manual_replacement() {
    // A live store must also remove a completed candidate sidecar before a
    // manual replacement changes the active pointer.
    let live_state_dir = test_state_dir();
    let live_id = "0198d98a-0000-7000-8000-000000000017";
    let (live_store, _, _) = active_acme_store(live_state_dir.clone(), live_id).await;
    stage_acme_candidate(&live_store, &live_state_dir, live_id).await;
    drop(live_store);
    let live_manifest_path = live_state_dir
        .join("certificates")
        .join(live_id)
        .join("candidate.json");
    let live_stale_manifest =
        std::fs::read(&live_manifest_path).expect("candidate sidecar should exist");
    let live_store = CertificateStore::new(live_state_dir.clone());
    live_store.initialize().await.unwrap();
    let live_staged = live_store
        .begin_candidate_activation(live_id, false)
        .await
        .unwrap()
        .expect("candidate should activate");
    live_store.commit_staged(&live_staged).await.unwrap();
    std::fs::write(&live_manifest_path, live_stale_manifest)
        .expect("stale sidecar should be restorable");
    let (manual, _) = import_request();
    let manual_staged = live_store
        .stage_manual(live_id, manual)
        .await
        .expect("manual replacement should ignore stale sidecar");
    let manual_metadata = live_store
        .commit_staged(&manual_staged)
        .await
        .expect("manual replacement should commit");
    assert_eq!(manual_metadata.source, CertificateSource::Manual);
    assert!(!live_manifest_path.is_file());
    drop(live_store);

    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000016";
    let (store, _, _) = active_acme_store(state_dir.clone(), id).await;
    stage_acme_candidate(&store, &state_dir, id).await;
    drop(store);

    let manifest_path = state_dir
        .join("certificates")
        .join(id)
        .join("candidate.json");
    let stale_manifest = std::fs::read(&manifest_path).expect("candidate sidecar should exist");
    let store = CertificateStore::new(state_dir.clone());
    store
        .initialize()
        .await
        .expect("candidate should initialize");
    let staged = store
        .begin_candidate_activation(id, false)
        .await
        .unwrap()
        .expect("candidate should activate");
    store
        .commit_staged(&staged)
        .await
        .expect("candidate should promote");
    assert!(store.get(id).await.unwrap().candidate.is_none());

    // Simulate a crash after the active index commit and before sidecar removal.
    std::fs::write(&manifest_path, stale_manifest).expect("stale sidecar should be restorable");
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened
        .initialize()
        .await
        .expect("restart should discard the promoted sidecar");
    assert!(reopened.get(id).await.unwrap().candidate.is_none());
    assert!(!manifest_path.is_file());

    let (manual, _) = import_request();
    let staged = reopened
        .stage_manual(id, manual)
        .await
        .expect("manual replacement should not be blocked by stale sidecar");
    let metadata = reopened
        .commit_staged(&staged)
        .await
        .expect("manual replacement should commit");
    assert_eq!(metadata.source, CertificateSource::Manual);
}

#[tokio::test]
async fn unknown_candidate_version_is_rejected_without_dropping_the_sidecar() {
    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000012";
    let (store, _, _) = active_acme_store(state_dir.clone(), id).await;
    stage_acme_candidate(&store, &state_dir, id).await;
    drop(store);

    let manifest_path = state_dir
        .join("certificates")
        .join(id)
        .join("candidate.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["version"] = serde_json::json!(255);
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

    let reopened = CertificateStore::new(state_dir);
    assert_eq!(
        reopened.initialize().await,
        Err(CertificateError::StoreUnavailable)
    );
    assert!(
        manifest_path.is_file(),
        "rejected candidate must remain for recovery"
    );
}

#[tokio::test]
async fn tampered_candidate_material_is_rejected_and_remains_guarded() {
    for (offset, tamper_fingerprint) in [(0, false), (1, true)] {
        let state_dir = test_state_dir();
        let id = format!("0198d98a-0000-7000-8000-0000000000{offset:02x}");
        let (store, _, _) = active_acme_store(state_dir.clone(), &id).await;
        let candidate_version = stage_acme_candidate(&store, &state_dir, &id).await;
        drop(store);

        if tamper_fingerprint {
            let manifest_path = state_dir
                .join("certificates")
                .join(&id)
                .join("candidate.json");
            let mut manifest: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
            manifest["staged"]["fingerprint"] =
                serde_json::json!(format!("sha256:{}", "f".repeat(64)));
            std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        } else {
            let (material, _) = import_request();
            std::fs::write(
                candidate_version.join("private-key.pem"),
                material.private_key_pem,
            )
            .unwrap();
        }

        let reopened = CertificateStore::new(state_dir);
        reopened
            .initialize()
            .await
            .expect("candidate metadata should parse");
        let expected_error = if tamper_fingerprint {
            CertificateError::StoreUnavailable
        } else {
            CertificateError::KeyMismatch
        };
        assert!(matches!(
            reopened.begin_candidate_activation(&id, false).await,
            Err(error) if error == expected_error
        ));
        assert_eq!(reopened.pending_candidate_ids().await.unwrap(), vec![id]);
    }
}

#[tokio::test]
async fn pending_candidate_blocks_new_issue_renewal_manual_stage_and_delete() {
    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000013";
    let (store, _, _) = active_acme_store(state_dir.clone(), id).await;
    stage_acme_candidate(&store, &state_dir, id).await;
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened.initialize().await.unwrap();
    assert_eq!(
        reopened.begin_issue(id, acme_request(), false).await,
        Err(CertificateError::OperationInProgress)
    );
    assert!(matches!(
        reopened.begin_renewal(id).await,
        Err(CertificateError::OperationInProgress)
    ));
    let (manual, _) = import_request();
    assert!(matches!(
        reopened.stage_manual(id, manual).await,
        Err(CertificateError::OperationInProgress)
    ));
    assert_eq!(
        reopened.delete_if_unused(id, false).await,
        Err(CertificateError::OperationInProgress)
    );
}

#[tokio::test]
async fn garbage_collection_preserves_active_pending_and_leased_versions_until_promotion() {
    let state_dir = test_state_dir();
    let id = "0198d98a-0000-7000-8000-000000000014";
    let (store, _, active_version) = active_acme_store(state_dir.clone(), id).await;
    let versions_dir = state_dir.join("certificates").join(id).join("versions");
    let unreferenced = versions_dir.join("e".repeat(64));
    copy_material_version(&active_version, &unreferenced);
    let candidate_version = stage_acme_candidate(&store, &state_dir, id).await;

    store.collect_garbage().await.unwrap();
    assert!(
        active_version.exists(),
        "leased active material must remain"
    );
    assert!(
        candidate_version.exists(),
        "leased candidate material must remain"
    );
    assert!(
        unreferenced.exists(),
        "all versions for a leased ID must remain"
    );
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened.initialize().await.unwrap();
    reopened.collect_garbage().await.unwrap();
    assert!(
        active_version.exists(),
        "active material must remain while candidate is pending"
    );
    assert!(
        candidate_version.exists(),
        "pending candidate material must remain"
    );
    assert!(
        !unreferenced.exists(),
        "unleased, unreferenced material can be collected without touching active or pending versions"
    );

    let promoted = reopened
        .begin_candidate_activation(id, false)
        .await
        .unwrap()
        .expect("pending candidate should be activatable");
    reopened.commit_staged(&promoted).await.unwrap();
    reopened.collect_garbage().await.unwrap();
    assert!(
        !active_version.exists(),
        "old active material should collect after promotion"
    );
    assert!(
        candidate_version.exists(),
        "promoted material must remain active"
    );
    assert!(
        !unreferenced.exists(),
        "unreferenced material should collect after promotion"
    );
}

#[tokio::test]
async fn candidate_sidecar_recovers_after_index_write_failure() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).unwrap();
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.unwrap();
    let id = "0198d98a-0000-7000-8000-000000000015";
    let request = acme_request();
    store.begin_issue(id, request.clone(), false).await.unwrap();

    let index_path = state_dir.join("certificates/certificate-metadata.json");
    let backup_path = state_dir.join("certificates/certificate-metadata.backup");
    std::fs::rename(&index_path, &backup_path).unwrap();
    std::fs::create_dir(&index_path).unwrap();
    let (material, _) = import_request();
    assert!(matches!(
        store
            .stage_acme(
                id,
                &request,
                material.certificate_pem,
                material.private_key_pem,
            )
            .await,
        Err(CertificateError::StoreUnavailable)
    ));
    let sidecar_path = state_dir
        .join("certificates")
        .join(id)
        .join("candidate.json");
    assert!(
        sidecar_path.is_file(),
        "sidecar must precede the index pointer"
    );
    assert!(matches!(
        store.begin_candidate_activation(id, false).await,
        Err(CertificateError::OperationInProgress)
    ));
    std::fs::remove_dir(&index_path).unwrap();
    std::fs::rename(&backup_path, &index_path).unwrap();
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened.initialize().await.unwrap();
    assert_eq!(
        reopened.pending_candidate_ids().await.unwrap(),
        vec![id.to_owned()]
    );
    assert!(reopened.get(id).await.unwrap().candidate.is_some());
    assert_eq!(reopened.get(id).await.unwrap().last_error_code, None);
}

#[tokio::test]
async fn fresh_store_instance_reads_imported_metadata_material_and_account() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state parent should exist");
    let certificate = rcgen::generate_simple_self_signed(vec!["demo.test".to_owned()])
        .expect("test certificate should generate");
    let id = "0198d98a-0000-7000-8000-000000000001";

    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let staged = store
        .stage_manual(
            id,
            CertificateImportRequest {
                certificate_pem: certificate.cert.pem(),
                private_key_pem: certificate.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["demo.test".to_owned()]),
            },
        )
        .await
        .expect("valid material should stage");
    let imported = store
        .commit_staged(&staged)
        .await
        .expect("staged material should publish");
    store
        .store_acme_account(CertificateEnvironment::Staging, br#"{}"#)
        .await
        .expect("account should persist");
    drop(store);

    let certificates_dir = state_dir.join("certificates");
    let certificate_dir = certificates_dir.join(id);
    let reopened = CertificateStore::new(state_dir.clone());
    reopened
        .initialize()
        .await
        .expect("fresh store must load existing index instead of defaulting it");
    let metadata = reopened
        .get(id)
        .await
        .expect("metadata should survive restart");
    assert_eq!(metadata, imported);
    assert_eq!(metadata.source, CertificateSource::Manual);
    assert_eq!(metadata.status, CertificateStatus::Valid);
    assert_eq!(metadata.domains, vec!["demo.test"]);
    assert!(
        metadata
            .fingerprint
            .unwrap_or_default()
            .starts_with("sha256:")
    );

    let material = reopened
        .material(id)
        .await
        .expect("material should resolve");
    assert!(material.fullchain_path.is_file());
    assert!(material.private_key_path.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let version_dir = material
            .fullchain_path
            .parent()
            .expect("material version directory should exist");
        for directory in [
            state_dir.as_path(),
            certificates_dir.as_path(),
            certificate_dir.as_path(),
            version_dir,
        ] {
            assert_eq!(
                std::fs::metadata(directory)
                    .expect("private directory metadata should read")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        for file in [&material.fullchain_path, &material.private_key_path] {
            assert_eq!(
                std::fs::metadata(file)
                    .expect("private material metadata should read")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    assert_eq!(
        reopened
            .load_acme_account(CertificateEnvironment::Staging)
            .await
            .expect("account should load"),
        Some(br#"{}"#.to_vec())
    );

    reopened
        .delete_if_unused(id, false)
        .await
        .expect("unreferenced certificate should delete");
    assert!(!material.fullchain_path.exists());
    assert!(!material.private_key_path.exists());
    assert!(!certificate_dir.exists());
    assert!(reopened.get(id).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn certificate_store_rejects_symlinked_parents_and_material_files() {
    use std::os::unix::fs::symlink;

    let root = test_state_dir();
    std::fs::create_dir_all(&root).expect("test state parent should exist");
    let redirected = root.join("redirected");
    std::fs::create_dir(&redirected).expect("redirected target should exist");
    symlink(&redirected, root.join("certificates")).expect("test symlink should create");
    assert_eq!(
        CertificateStore::new(root.clone()).initialize().await,
        Err(CertificateError::StoreUnavailable)
    );

    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state parent should exist");
    let certificate = rcgen::generate_simple_self_signed(vec!["demo.test".to_owned()])
        .expect("test certificate should generate");
    let id = "0198d98a-0000-7000-8000-000000000001";
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let staged = store
        .stage_manual(
            id,
            CertificateImportRequest {
                certificate_pem: certificate.cert.pem(),
                private_key_pem: certificate.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["demo.test".to_owned()]),
            },
        )
        .await
        .expect("material should stage");
    store
        .commit_staged(&staged)
        .await
        .expect("material should publish");
    let material = store.material(id).await.expect("material should resolve");
    let original_fullchain =
        std::fs::read(&material.fullchain_path).expect("original fullchain should remain readable");
    let redirected_file = state_dir.join("redirected-fullchain.pem");
    std::fs::write(&redirected_file, &original_fullchain).expect("redirected file should write");
    std::fs::remove_file(&material.fullchain_path)
        .expect("fullchain should remove for symlink test");
    symlink(&redirected_file, &material.fullchain_path).expect("file symlink should create");
    assert!(matches!(
        store.material(id).await,
        Err(CertificateError::StoreUnavailable)
    ));
    std::fs::remove_file(&material.fullchain_path).expect("file symlink should remove");
    std::fs::write(&material.fullchain_path, original_fullchain)
        .expect("regular fullchain should restore");

    let version_dir = material
        .fullchain_path
        .parent()
        .expect("version directory should exist");
    let versions_dir = version_dir
        .parent()
        .expect("versions directory should exist");
    let preserved_versions = state_dir.join("preserved-versions");
    std::fs::rename(versions_dir, &preserved_versions).expect("versions should move");
    symlink(&preserved_versions, versions_dir).expect("parent symlink should create");
    assert!(matches!(
        store.material(id).await,
        Err(CertificateError::StoreUnavailable)
    ));
}

#[tokio::test]
async fn failed_material_staging_cleans_private_temp_and_allows_retry() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state directory should exist");
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let id = "0198d98a-0000-7000-8000-000000000001";
    let certificate = rcgen::generate_simple_self_signed(vec!["demo.test".to_owned()])
        .expect("test certificate should generate");
    let request = CertificateImportRequest {
        certificate_pem: certificate.cert.pem(),
        private_key_pem: certificate.signing_key.serialize_pem(),
        chain_pem: None,
        required_domains: Some(vec!["demo.test".to_owned()]),
    };

    fail_next_private_key_write_below(state_dir.clone());
    assert!(matches!(
        store.stage_manual(id, request.clone()).await,
        Err(CertificateError::StoreUnavailable)
    ));
    let versions_dir = state_dir.join("certificates").join(id).join("versions");
    assert!(
        std::fs::read_dir(&versions_dir)
            .expect("versions directory should remain readable")
            .all(|entry| !entry
                .expect("versions entry should read")
                .file_name()
                .to_string_lossy()
                .starts_with(".staging-"))
    );

    let staged = store
        .stage_manual(id, request)
        .await
        .expect("same material should stage after a cleaned failed write");
    let material = store
        .staged_material(&staged)
        .expect("retried material should be complete");
    assert!(material.fullchain_path.is_file());
    assert!(material.private_key_path.is_file());
    store.discard_staged(&staged).await;
}

#[tokio::test]
async fn certificate_index_limits_preserve_persisted_and_in_memory_metadata() {
    const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
    let certificate = rcgen::generate_simple_self_signed(vec!["demo.test".to_owned()]).unwrap();
    let request = CertificateImportRequest {
        certificate_pem: certificate.cert.pem(),
        private_key_pem: certificate.signing_key.serialize_pem(),
        chain_pem: None,
        required_domains: None,
    };
    let seed_id = "0198d98a-0000-7000-8000-000000000000";
    let new_id = "0198d98a-0000-7000-8000-ffffffffffff";
    for at_byte_limit in [false, true] {
        let state_dir = test_state_dir();
        std::fs::create_dir_all(&state_dir).unwrap();
        let store = CertificateStore::new(state_dir.clone());
        store.initialize().await.unwrap();
        let staged = store.stage_manual(seed_id, request.clone()).await.unwrap();
        store.commit_staged(&staged).await.unwrap();
        let index_path = state_dir.join("certificates/certificate-metadata.json");
        let mut fixture: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
        let mut template = fixture["certificates"][seed_id].clone();
        if at_byte_limit {
            let label = "a".repeat(63);
            let domain = format!("{label}.{label}.{label}.{}.test", "b".repeat(55));
            template["domains"] = serde_json::json!(vec![domain; 100]);
        }
        let entries = fixture["certificates"].as_object_mut().unwrap();
        entries.clear();
        let entry_bytes = serde_json::to_vec(&template).unwrap().len() + seed_id.len() + 4;
        let count = if at_byte_limit {
            (MAX_INDEX_BYTES - 128) / entry_bytes
        } else {
            10_000
        };
        for number in 0..count {
            let id = format!("0198d98a-0000-7000-8000-{number:012x}");
            let mut entry = template.clone();
            entry["id"] = serde_json::json!(id);
            entries.insert(id, entry);
        }
        if at_byte_limit {
            let current_bytes = serde_json::to_vec(&fixture).unwrap().len();
            let mut remaining = MAX_INDEX_BYTES - 64 - current_bytes;
            for entry in fixture["certificates"]
                .as_object_mut()
                .unwrap()
                .values_mut()
            {
                let issuer = entry["issuer"].as_str().unwrap();
                let added = remaining.min(512 - issuer.len());
                entry["issuer"] = serde_json::json!(format!("{issuer}{}", "a".repeat(added)));
                remaining -= added;
                if remaining == 0 {
                    break;
                }
            }
            assert_eq!(
                remaining, 0,
                "fixture should approach the serialized size boundary"
            );
        }
        let original = serde_json::to_vec(&fixture).unwrap();
        assert!(original.len() <= MAX_INDEX_BYTES);
        std::fs::write(&index_path, &original).unwrap();
        let store = CertificateStore::new(state_dir.clone());
        store
            .initialize()
            .await
            .expect("boundary index should load");
        let before = store.list().await.unwrap();
        let staged = store.stage_manual(new_id, request.clone()).await.unwrap();
        assert_eq!(
            store.commit_staged(&staged).await,
            Err(CertificateError::StoreUnavailable)
        );
        store.discard_staged(&staged).await;
        assert_eq!(store.list().await.unwrap(), before);
        assert_eq!(std::fs::read(&index_path).unwrap(), original);

        let issue = crate::runtime::CertificateIssueRequest {
            domains: vec!["example.com".to_owned()],
            environment: CertificateEnvironment::Staging,
            contact_email: None,
            challenge_type: Default::default(),
            dns_provider: None,
            accept_terms: true,
        };
        for _ in 0..2 {
            assert_eq!(
                store.begin_issue(new_id, issue.clone(), false).await,
                Err(CertificateError::StoreUnavailable)
            );
            if at_byte_limit {
                assert_eq!(
                    store.begin_issue(seed_id, issue.clone(), false).await,
                    Err(CertificateError::StoreUnavailable),
                    "issuance must reserve enough room to recover an interrupted operation"
                );
            }
        }
        assert_eq!(store.list().await.unwrap(), before);
        assert_eq!(std::fs::read(index_path).unwrap(), original);
        let reopened = CertificateStore::new(state_dir);
        reopened
            .initialize()
            .await
            .expect("failed growth must leave a restartable index");
        assert_eq!(reopened.list().await.unwrap(), before);
    }
}

#[tokio::test]
async fn acme_retry_metadata_preserves_success_material_across_restart() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state directory should exist");
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let id = "0198d98a-0000-7000-8000-000000000002";
    let request = CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    };
    let leaf = rcgen::generate_simple_self_signed(request.domains.clone())
        .expect("test certificate should generate");

    let started = store
        .begin_issue(id, request.clone(), false)
        .await
        .expect("ACME issue should begin");
    assert_eq!(started.attempt_count, 1);
    assert!(started.last_attempt_at.is_some());
    let staged = store
        .stage_acme(
            id,
            &request,
            leaf.cert.pem(),
            leaf.signing_key.serialize_pem(),
        )
        .await
        .expect("test ACME material should stage");
    let issued = store
        .commit_staged(&staged)
        .await
        .expect("test ACME material should commit");
    assert_eq!(issued.attempt_count, 0);
    assert!(issued.last_success_at.is_some());
    let fingerprint = issued.fingerprint.clone();

    let ca_deadline = time::OffsetDateTime::now_utc() + time::Duration::days(2);
    store
        .defer_acme_retry(id, ca_deadline)
        .await
        .expect("CA retry deadline should persist");
    store
        .defer_acme_retry(
            id,
            time::OffsetDateTime::now_utc() + time::Duration::minutes(1),
        )
        .await
        .expect("a shorter CA deadline should not replace the first one");
    store.finish_failed(id, CertificateError::AcmeFailed).await;
    let failed = store.get(id).await.expect("failed metadata should remain");
    assert_eq!(failed.status, CertificateStatus::Valid);
    assert_eq!(failed.fingerprint, fingerprint);
    assert_eq!(failed.attempt_count, 1);
    assert!(failed.last_attempt_at.is_some());
    assert!(failed.next_attempt_at.is_some());
    assert!(
        time::OffsetDateTime::parse(
            failed.next_attempt_at.as_deref().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .expect("retry deadline should parse")
            >= ca_deadline
    );
    assert!(matches!(
        store.begin_renewal(id).await,
        Err(CertificateError::OperationInProgress)
    ));
    drop(store);

    let reopened = CertificateStore::new(state_dir);
    reopened.initialize().await.expect("store should restart");
    let restarted = reopened
        .get(id)
        .await
        .expect("metadata should survive restart");
    assert_eq!(restarted.next_attempt_at, failed.next_attempt_at);
    assert_eq!(restarted.fingerprint, fingerprint);
    assert!(matches!(
        reopened.begin_renewal(id).await,
        Err(CertificateError::OperationInProgress)
    ));
}

#[tokio::test]
async fn failed_acme_replacement_of_imported_certificate_keeps_old_material_and_backoff() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state directory should exist");
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let id = "0198d98a-0000-7000-8000-000000000003";
    let leaf = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()])
        .expect("test certificate should generate");
    let imported = store
        .stage_manual(
            id,
            CertificateImportRequest {
                certificate_pem: leaf.cert.pem(),
                private_key_pem: leaf.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .expect("manual material should stage");
    let imported = store
        .commit_staged(&imported)
        .await
        .expect("manual material should commit");
    let request = CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    };
    store
        .begin_issue(id, request, false)
        .await
        .expect("replacement issuance should begin");
    let ca_deadline = time::OffsetDateTime::now_utc() + time::Duration::days(2);
    store
        .defer_acme_retry(id, ca_deadline)
        .await
        .expect("CA retry deadline should apply to an active replacement");
    store.finish_failed(id, CertificateError::AcmeFailed).await;
    let failed = store.get(id).await.expect("old metadata should remain");
    assert_eq!(failed.status, CertificateStatus::Valid);
    assert_eq!(failed.fingerprint, imported.fingerprint);
    assert!(failed.next_attempt_at.is_some());
    assert!(
        time::OffsetDateTime::parse(
            failed.next_attempt_at.as_deref().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .expect("retry deadline should parse")
            >= ca_deadline
    );
    let replacement = rcgen::generate_simple_self_signed(vec!["example.com".to_owned()])
        .expect("replacement certificate should generate");
    let replacement = store
        .stage_manual(
            id,
            CertificateImportRequest {
                certificate_pem: replacement.cert.pem(),
                private_key_pem: replacement.signing_key.serialize_pem(),
                chain_pem: None,
                required_domains: Some(vec!["example.com".to_owned()]),
            },
        )
        .await
        .expect("manual replacement should stage during a CA cooldown");
    let replacement = store
        .commit_staged(&replacement)
        .await
        .expect("manual replacement should commit during a CA cooldown");
    assert_eq!(replacement.source, CertificateSource::Manual);
    assert_ne!(replacement.fingerprint, imported.fingerprint);
    assert_eq!(replacement.next_attempt_at, failed.next_attempt_at);
    assert_eq!(
        store
            .begin_issue(
                id,
                CertificateIssueRequest {
                    domains: vec!["example.com".to_owned()],
                    environment: CertificateEnvironment::Staging,
                    contact_email: None,
                    challenge_type: Default::default(),
                    dns_provider: None,
                    accept_terms: true,
                },
                false,
            )
            .await,
        Err(CertificateError::OperationInProgress)
    );
}

#[tokio::test]
async fn acme_account_retry_deadline_blocks_environment_across_certificates_and_restart() {
    let state_dir = test_state_dir();
    std::fs::create_dir_all(&state_dir).expect("test state directory should exist");
    let store = CertificateStore::new(state_dir.clone());
    store.initialize().await.expect("store should initialize");
    let staging_id = "0198d98a-0000-7000-8000-000000000004";
    let other_id = "0198d98a-0000-7000-8000-000000000005";
    let request = |environment| CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    };

    store
        .begin_issue(staging_id, request(CertificateEnvironment::Staging), false)
        .await
        .expect("first staging order should begin");
    let ca_deadline = time::OffsetDateTime::now_utc() + time::Duration::days(2);
    store
        .defer_acme_account_retry(CertificateEnvironment::Staging, ca_deadline)
        .await
        .expect("environment retry deadline should persist");
    store
        .finish_failed(staging_id, CertificateError::AcmeFailed)
        .await;

    assert_eq!(
        store
            .begin_issue(other_id, request(CertificateEnvironment::Staging), false,)
            .await,
        Err(CertificateError::OperationInProgress)
    );
    store
        .begin_issue(other_id, request(CertificateEnvironment::Production), false)
        .await
        .expect("a different ACME environment should remain available");
    store
        .finish_failed(other_id, CertificateError::AcmeFailed)
        .await;
    drop(store);

    let reopened = CertificateStore::new(state_dir.clone());
    reopened.initialize().await.expect("store should restart");
    let restarted_id = "0198d98a-0000-7000-8000-000000000006";
    assert_eq!(
        reopened
            .begin_issue(
                restarted_id,
                request(CertificateEnvironment::Staging),
                false,
            )
            .await,
        Err(CertificateError::OperationInProgress)
    );

    // An index written by an older version has no account cooldown field;
    // deserialization must default it to an empty map.
    let index_path = state_dir.join("certificates/certificate-metadata.json");
    let mut old_index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    old_index
        .as_object_mut()
        .expect("index should be an object")
        .remove("acmeRetryUntil");
    std::fs::write(&index_path, serde_json::to_vec(&old_index).unwrap()).unwrap();
    let migrated = CertificateStore::new(state_dir);
    migrated
        .initialize()
        .await
        .expect("old index should migrate without account cooldown metadata");
    migrated
        .begin_issue(
            restarted_id,
            request(CertificateEnvironment::Staging),
            false,
        )
        .await
        .expect("old index migration should leave staging available");
    migrated
        .finish_failed(restarted_id, CertificateError::AcmeFailed)
        .await;
}
