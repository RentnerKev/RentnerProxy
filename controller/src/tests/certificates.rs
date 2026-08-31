use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::runtime::{
    CertificateEnvironment, CertificateError, CertificateImportRequest, CertificateSource,
    CertificateStatus, CertificateStore,
};

use super::fixtures::fail_next_private_key_write_below;

static STORE_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

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
