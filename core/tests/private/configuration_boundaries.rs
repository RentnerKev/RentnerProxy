use super::*;

#[test]
fn rollback_storage_failures_keep_recovery_fenced_until_repaired() {
    let root = std::env::temp_dir().join(format!(
        "rentnerproxy-rollback-boundaries-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let runtime = ProxyRuntime::new(crate::runtime::RuntimeSettings::new(root.clone(), 0), None);
    let snapshot = root.join(ACTIVE_CONFIGURATION_FILE);
    std::fs::write(&snapshot, b"retain snapshot").unwrap();
    runtime
        .recovery_write_faults
        .lock()
        .unwrap()
        .push_back(crate::runtime::RecoveryWriteFault::BeforeFenceWrite);
    runtime.restore_recovery_configuration(None);
    assert_eq!(std::fs::read(&snapshot).unwrap(), b"retain snapshot");
    assert!(!root.join(ACTIVE_CONFIGURATION_FENCE).exists());
    std::fs::remove_file(&snapshot).unwrap();
    std::fs::create_dir(&snapshot).unwrap();
    runtime.restore_recovery_configuration(None);
    assert!(runtime.configuration_activation_is_fenced());
    assert!(snapshot.is_dir());
    std::fs::remove_dir(&snapshot).unwrap();
    runtime
        .recovery_write_faults
        .lock()
        .unwrap()
        .push_back(crate::runtime::RecoveryWriteFault::BeforeFenceRemoval);
    runtime.restore_recovery_configuration(None);
    assert!(runtime.configuration_activation_is_fenced());
    runtime.restore_recovery_configuration(None);
    assert!(!runtime.configuration_activation_is_fenced());
    assert!(!snapshot.exists());
    assert!(!root.join(ACTIVE_CONFIGURATION_AUTHORITY_FILE).exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn system_trust_bundle_requires_nonempty_readable_regular_file() {
    let root = std::env::temp_dir().join(format!(
        "rentnerproxy-ca-bundle-boundaries-{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let bundle = root.join("bundle.pem");
    assert!(!is_readable_system_ca_bundle(&bundle));
    assert!(!is_readable_system_ca_bundle(&root));
    assert!(!is_readable_system_ca_bundle(Path::new("relative.pem")));
    std::fs::write(&bundle, []).unwrap();
    assert!(!is_readable_system_ca_bundle(&bundle));
    std::fs::write(&bundle, b"certificate bundle").unwrap();
    assert!(is_readable_system_ca_bundle(&bundle));
    #[cfg(unix)]
    {
        let linked = root.join("linked.pem");
        std::os::unix::fs::symlink(&bundle, &linked).unwrap();
        assert!(!is_readable_system_ca_bundle(&linked));
    }
    std::fs::remove_dir_all(root).unwrap();
}
