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
