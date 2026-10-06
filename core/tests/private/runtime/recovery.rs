use super::*;
use crate::runtime::RecoveryWriteFault;

const SNAPSHOT: &str = "active-proxy-snapshot.json";
const AUTHORITY: &str = "active-proxy-snapshot-authority-v1";
const FENCE: &str = "proxy-activation-pending";

fn restrictive_configuration() -> ValidatedProxyConfig {
    let mut config = configuration(4_000);
    config.proxy_hosts.clear();
    config.revision = revision_for_configuration(&config.proxy_hosts, &config.http_settings);
    config
}

async fn restart(settings: &RuntimeSettings) -> (Arc<ProxyRuntime>, Arc<FakeCaddy>) {
    let engine = FakeCaddy::new();
    let runtime = ProxyRuntime::new(settings.clone(), Some(engine.clone()));
    runtime.initialize().await;
    assert!(runtime.is_ready().await);
    (runtime, engine)
}

#[tokio::test]
async fn snapshot_write_failure_never_loads_or_acknowledges_new_policy() {
    for fault in [
        RecoveryWriteFault::BeforeSnapshotWrite,
        RecoveryWriteFault::AfterSnapshotWrite,
        RecoveryWriteFault::BeforeAuthorityWrite,
        RecoveryWriteFault::AfterAuthorityWrite,
    ] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine.clone()));
        runtime.initialize().await;
        runtime.apply(configuration(4_000)).await.unwrap();
        let previous = runtime.active_config().await.unwrap();
        let snapshot = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
        let authority = std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap();
        let loads = engine.load_count.load(Ordering::SeqCst);
        runtime
            .recovery_write_faults
            .lock()
            .unwrap()
            .push_back(fault);

        assert_eq!(
            runtime.apply(restrictive_configuration()).await,
            Err(RuntimeError::ApplyFailed)
        );
        assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
        assert_eq!(*engine.configuration.lock().await, previous.0);
        assert_eq!(runtime.active_config().await.unwrap(), previous);
        assert_eq!(
            std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
            snapshot
        );
        assert_eq!(
            std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap(),
            authority
        );
        runtime.shutdown().await;

        let (restarted, engine) = restart(&settings).await;
        assert_eq!(restarted.active_config().await.unwrap(), previous);
        assert_eq!(*engine.configuration.lock().await, previous.0);
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn failed_snapshot_rollback_keeps_restart_fenced_for_old_and_new_snapshots() {
    for fault in [
        RecoveryWriteFault::BeforeSnapshotWrite,
        RecoveryWriteFault::AfterSnapshotWrite,
        RecoveryWriteFault::BeforeAuthorityWrite,
        RecoveryWriteFault::AfterAuthorityWrite,
    ] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine.clone()));
        runtime.initialize().await;
        runtime.apply(configuration(4_000)).await.unwrap();
        let previous = runtime.active_config().await.unwrap();
        let loads = engine.load_count.load(Ordering::SeqCst);
        runtime
            .recovery_write_faults
            .lock()
            .unwrap()
            .extend([fault, RecoveryWriteFault::BeforeSnapshotWrite]);
        assert_eq!(
            runtime.apply(restrictive_configuration()).await,
            Err(RuntimeError::ApplyFailed)
        );
        assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
        assert_eq!(runtime.active_config().await.unwrap(), previous);
        assert!(settings.state_dir.join(FENCE).is_file());
        runtime.shutdown().await;

        let (restarted, engine) = restart(&settings).await;
        assert_eq!(restarted.status().await.active_revision, None);
        assert!(!engine.configuration.lock().await.contains("demo.test"));
        // A subsequent explicitly verified apply repairs the durable authority.
        restarted.apply(restrictive_configuration()).await.unwrap();
        restarted.shutdown().await;
        let (repaired, _) = restart(&settings).await;
        assert_eq!(
            repaired.status().await.active_revision,
            Some(restrictive_configuration().revision)
        );
        repaired.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn fence_write_failure_prevents_loading_and_recovers_without_public_routes() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    let loads = engine.load_count.load(Ordering::SeqCst);
    std::fs::create_dir(settings.state_dir.join(FENCE)).unwrap();
    assert_eq!(
        runtime.apply(restrictive_configuration()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    runtime.shutdown().await;

    let (restarted, engine) = restart(&settings).await;
    assert_eq!(restarted.status().await.active_revision, None);
    assert!(!engine.configuration.lock().await.contains("demo.test"));
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn restart_during_unconfirmed_activation_uses_baseline_then_committed_policy() {
    let engine = FakeCaddy::new();
    let (_, mut settings) = runtime(None);
    settings.stage_timeout = Duration::from_secs(5);
    let runtime = ProxyRuntime::new(settings.clone(), Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let gate = Arc::new(Notify::new());
    *engine.load_gate.lock().await = Some(gate.clone());
    let applying = Arc::clone(&runtime);
    let started = engine.load_started.notified();
    // Consume the previous successful load's notification before waiting.
    started.await;
    let applying = tokio::spawn(async move { applying.apply(restrictive_configuration()).await });
    engine.load_started.notified().await;
    assert!(settings.state_dir.join(FENCE).is_file());
    let (interrupted, engine_after_crash) = restart(&settings).await;
    assert_eq!(interrupted.status().await.active_revision, None);
    assert!(
        !engine_after_crash
            .configuration
            .lock()
            .await
            .contains("demo.test")
    );
    interrupted.shutdown().await;
    gate.notify_one();
    assert_eq!(applying.await.unwrap(), Ok(ApplyOutcome::Applied));
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(
        restarted.status().await.active_revision,
        Some(restrictive_configuration().revision)
    );
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn fence_removal_failure_rolls_back_both_traffic_and_recovery_authority() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    runtime
        .recovery_write_faults
        .lock()
        .unwrap()
        .push_back(RecoveryWriteFault::BeforeFenceRemoval);
    assert_eq!(
        runtime.apply(restrictive_configuration()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(*engine.configuration.lock().await, previous.0);
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), previous);
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn post_unlink_sync_failure_commits_public_candidate_without_attempting_refence() {
    for fence_reappears in [false, true] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine.clone()));
        runtime.initialize().await;
        runtime
            .import_certificate(CERT_ID, certificate_import_request())
            .await
            .unwrap();
        let candidate = tls_configuration();
        let mut previous = candidate.clone();
        previous.proxy_hosts[0].access_policy = Some(AccessPolicy {
            id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
            mode: AccessPolicyMode::IpRestricted,
            combination: None,
            basic_auth: None,
            forward_auth: None,
            ip_rules: Some(IpRules {
                default_action: IpDefaultAction::Deny,
                allow: vec!["192.0.2.0/24".to_owned()],
                deny: Vec::new(),
            }),
        });
        previous.revision =
            revision_for_configuration(&previous.proxy_hosts, &previous.http_settings);
        runtime.apply(previous).await.unwrap();
        assert!(
            runtime
                .active_config()
                .await
                .unwrap()
                .0
                .contains("192.0.2.0/24")
        );
        runtime.recovery_write_faults.lock().unwrap().extend([
            RecoveryWriteFault::AfterFenceRemoval,
            RecoveryWriteFault::BeforeFenceWrite,
        ]);
        assert_eq!(
            runtime.apply(candidate.clone()).await,
            Ok(ApplyOutcome::Applied)
        );
        let active = runtime.active_config().await.unwrap();
        assert_eq!(active.1, Some(candidate.revision.clone()));
        assert!(!active.0.contains("192.0.2.0/24"));
        assert_eq!(*engine.configuration.lock().await, active.0);
        let snapshot = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
        let persisted = validate_proxy_config(serde_json::from_slice(&snapshot).unwrap()).unwrap();
        assert_eq!(persisted.revision, candidate.revision);
        assert!(persisted.proxy_hosts[0].access_policy.is_none());
        assert!(!settings.state_dir.join(FENCE).exists());
        // A failed re-fence must remain unused: post-unlink is already committed.
        assert!(
            runtime.recovery_write_faults.lock().unwrap().front()
                == Some(&RecoveryWriteFault::BeforeFenceWrite)
        );
        runtime
            .import_certificate(CERT_ID, certificate_import_request())
            .await
            .unwrap();
        let active = runtime.active_config().await.unwrap();
        assert_eq!(*engine.configuration.lock().await, active.0);
        assert_eq!(active.1, Some(candidate.revision.clone()));
        assert_eq!(
            std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
            snapshot
        );
        assert!(
            runtime.recovery_write_faults.lock().unwrap().front()
                == Some(&RecoveryWriteFault::BeforeFenceWrite)
        );
        runtime.shutdown().await;
        // A power interruption may restore an unsynced marker directory entry.
        if fence_reappears {
            std::fs::write(settings.state_dir.join(FENCE), "pending\n").unwrap();
        }
        let (restarted, engine) = restart(&settings).await;
        if fence_reappears {
            assert_eq!(restarted.status().await.active_revision, None);
            assert!(!engine.configuration.lock().await.contains("demo.test"));
        } else {
            assert_eq!(restarted.active_config().await.unwrap(), active);
            assert_eq!(*engine.configuration.lock().await, active.0);
        }
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn rejected_first_load_restores_absent_snapshot_and_baseline_after_restart() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert!(!settings.state_dir.join(SNAPSHOT).exists());
    assert!(!settings.state_dir.join(AUTHORITY).exists());
    assert!(!settings.state_dir.join(FENCE).exists());
    runtime.shutdown().await;
    let (restarted, engine) = restart(&settings).await;
    assert_eq!(restarted.status().await.active_revision, None);
    assert!(!engine.configuration.lock().await.contains("demo.test"));
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn certificate_only_replacement_preserves_policy_snapshot_and_recovers_committed_material() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine));
    runtime.initialize().await;
    runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let config = tls_configuration();
    runtime.apply(config.clone()).await.unwrap();
    let snapshot = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
    // The policy is already durable; replacement commits only its material pointer.
    runtime
        .recovery_write_faults
        .lock()
        .unwrap()
        .push_back(RecoveryWriteFault::BeforeSnapshotWrite);
    let replacement = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let active = runtime.active_config().await.unwrap();
    assert_eq!(
        std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
        snapshot
    );
    assert!(!settings.state_dir.join(FENCE).exists());
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), active);
    assert_eq!(
        restarted.certificate(CERT_ID).await.unwrap().fingerprint,
        replacement.fingerprint
    );
    assert_eq!(
        restarted.status().await.active_revision,
        Some(config.revision)
    );
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn certificate_replacement_waits_for_pending_policy_recovery_to_be_repaired() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let config = tls_configuration();
    runtime.apply(config.clone()).await.unwrap();
    runtime.recovery_write_faults.lock().unwrap().extend([
        RecoveryWriteFault::AfterSnapshotWrite,
        RecoveryWriteFault::BeforeSnapshotWrite,
    ]);
    assert_eq!(
        runtime.apply(restrictive_configuration()).await,
        Err(RuntimeError::ApplyFailed)
    );
    let loads = engine.load_count.load(Ordering::SeqCst);
    assert_eq!(
        runtime
            .import_certificate(CERT_ID, certificate_import_request())
            .await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert_eq!(
        runtime.certificate(CERT_ID).await.unwrap().fingerprint,
        first.fingerprint
    );
    assert!(settings.state_dir.join(FENCE).is_file());
    assert_eq!(runtime.apply(config).await, Ok(ApplyOutcome::Unchanged));
    runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let previous = runtime.active_config().await.unwrap();
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), previous);
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn unchanged_apply_storage_failure_preserves_verified_recovery_without_a_fence() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    let loads = engine.load_count.load(Ordering::SeqCst);
    runtime
        .recovery_write_faults
        .lock()
        .unwrap()
        .push_back(RecoveryWriteFault::BeforeSnapshotWrite);
    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert!(!settings.state_dir.join(FENCE).exists());
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), previous);
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn unchanged_retry_repairs_fenced_recovery_after_failed_snapshot_rollback() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    runtime.recovery_write_faults.lock().unwrap().extend([
        RecoveryWriteFault::AfterSnapshotWrite,
        RecoveryWriteFault::BeforeSnapshotWrite,
    ]);
    assert_eq!(
        runtime.apply(restrictive_configuration()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert!(settings.state_dir.join(FENCE).is_file());
    let loads = engine.load_count.load(Ordering::SeqCst);
    let probes = engine.probe_count.load(Ordering::SeqCst);
    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Ok(ApplyOutcome::Unchanged)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert_eq!(engine.probe_count.load(Ordering::SeqCst), probes + 1);
    assert!(!settings.state_dir.join(FENCE).exists());
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), previous);
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn rejected_load_and_probe_failure_restore_recovery_before_restart() {
    for rejection in [true, false] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine.clone()));
        runtime.initialize().await;
        runtime.apply(restrictive_configuration()).await.unwrap();
        let previous = runtime.active_config().await.unwrap();
        let snapshot = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
        let authority = std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap();
        if rejection {
            engine
                .loads
                .lock()
                .await
                .push_back(Err(EngineError::Rejected));
        } else {
            engine
                .probes
                .lock()
                .await
                .push_back(Err(EngineError::InvalidResponse));
        }
        assert_eq!(
            runtime.apply(configuration(4_000)).await,
            Err(RuntimeError::ApplyFailed)
        );
        assert_eq!(runtime.active_config().await.unwrap(), previous);
        assert_eq!(*engine.configuration.lock().await, previous.0);
        assert_eq!(
            std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
            snapshot
        );
        assert_eq!(
            std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap(),
            authority
        );
        runtime.shutdown().await;
        let (restarted, _) = restart(&settings).await;
        assert_eq!(restarted.active_config().await.unwrap(), previous);
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn legacy_v7_snapshot_requires_explicit_desired_apply_before_offline_recovery() {
    let (runtime, settings) = runtime(Some(FakeCaddy::new()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    runtime.shutdown().await;
    std::fs::remove_file(settings.state_dir.join(AUTHORITY)).unwrap();
    let legacy = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
    assert!(validate_proxy_config(serde_json::from_slice(&legacy).unwrap()).is_ok());
    let (upgraded, engine) = restart(&settings).await;
    assert_eq!(upgraded.status().await.active_revision, None);
    assert!(!engine.configuration.lock().await.contains("demo.test"));
    assert!(!settings.state_dir.join(AUTHORITY).exists());
    assert_eq!(
        std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
        legacy
    );
    let desired = restrictive_configuration();
    assert_eq!(
        upgraded.apply(desired.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    assert_eq!(
        std::fs::read_to_string(settings.state_dir.join(AUTHORITY)).unwrap(),
        format!("durable-apply-v1\n{}\n", desired.revision)
    );
    let active = upgraded.active_config().await.unwrap();
    upgraded.shutdown().await;
    let (offline, engine) = restart(&settings).await;
    assert_eq!(offline.active_config().await.unwrap(), active);
    assert_eq!(
        offline.status().await.active_revision,
        Some(desired.revision)
    );
    assert!(!engine.configuration.lock().await.contains("demo.test"));
    offline.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn malformed_mismatched_oversized_or_nonregular_authority_closes_recovery() {
    for invalid in 0..4 {
        let (runtime, settings) = runtime(Some(FakeCaddy::new()));
        runtime.initialize().await;
        runtime.apply(configuration(4_000)).await.unwrap();
        runtime.shutdown().await;
        let authority = settings.state_dir.join(AUTHORITY);
        match invalid {
            0 => std::fs::write(
                &authority,
                format!("durable-apply-v0\n{}\n", configuration(4_000).revision),
            )
            .unwrap(),
            1 => std::fs::write(
                &authority,
                format!("durable-apply-v1\n{}\n", configuration(4_001).revision),
            )
            .unwrap(),
            2 => std::fs::write(&authority, [b'a'; 129]).unwrap(),
            _ => {
                std::fs::remove_file(&authority).unwrap();
                std::fs::create_dir(&authority).unwrap();
            }
        }
        let (restarted, engine) = restart(&settings).await;
        assert_eq!(restarted.status().await.active_revision, None);
        assert!(!engine.configuration.lock().await.contains("demo.test"));
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn matching_authority_label_does_not_authorize_modified_policy_contents() {
    let (runtime, settings) = runtime(Some(FakeCaddy::new()));
    runtime.initialize().await;
    runtime.apply(restrictive_configuration()).await.unwrap();
    runtime.shutdown().await;
    let snapshot = settings.state_dir.join(SNAPSHOT);
    let mut request: ProxyConfigRequest =
        serde_json::from_slice(&std::fs::read(&snapshot).unwrap()).unwrap();
    // Add public routes while retaining the revision label and its authority.
    request.proxy_hosts = configuration(4_000).proxy_hosts;
    std::fs::write(snapshot, serde_json::to_vec(&request).unwrap()).unwrap();
    let (restarted, engine) = restart(&settings).await;
    assert_eq!(restarted.status().await.active_revision, None);
    assert!(!engine.configuration.lock().await.contains("demo.test"));
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[tokio::test]
async fn unchanged_apply_repairs_missing_or_mismatched_authority_after_confirmation() {
    for missing in [false, true] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine.clone()));
        runtime.initialize().await;
        let config = configuration(4_000);
        runtime.apply(config.clone()).await.unwrap();
        let previous = runtime.active_config().await.unwrap();
        let authority = settings.state_dir.join(AUTHORITY);
        if missing {
            std::fs::remove_file(&authority).unwrap();
        } else {
            std::fs::write(&authority, "invalid authority").unwrap();
        }
        let loads = engine.load_count.load(Ordering::SeqCst);
        let probes = engine.probe_count.load(Ordering::SeqCst);
        assert_eq!(
            runtime.apply(config.clone()).await,
            Ok(ApplyOutcome::Unchanged)
        );
        assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
        assert_eq!(engine.probe_count.load(Ordering::SeqCst), probes + 1);
        assert!(!settings.state_dir.join(FENCE).exists());
        assert_eq!(
            std::fs::read_to_string(&authority).unwrap(),
            format!("durable-apply-v1\n{}\n", config.revision)
        );
        runtime.shutdown().await;
        let (restarted, _) = restart(&settings).await;
        assert_eq!(restarted.active_config().await.unwrap(), previous);
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[tokio::test]
async fn certificate_replacement_requires_authority_for_current_policy() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let config = tls_configuration();
    runtime.apply(config.clone()).await.unwrap();
    std::fs::write(
        settings.state_dir.join(AUTHORITY),
        format!("durable-apply-v1\n{}\n", configuration(4_001).revision),
    )
    .unwrap();
    let loads = engine.load_count.load(Ordering::SeqCst);
    assert_eq!(
        runtime
            .import_certificate(CERT_ID, certificate_import_request())
            .await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert_eq!(
        runtime.certificate(CERT_ID).await.unwrap().fingerprint,
        first.fingerprint
    );
    assert_eq!(
        runtime.apply(config.clone()).await,
        Ok(ApplyOutcome::Unchanged)
    );
    let authority = std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap();
    let snapshot = std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap();
    runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(settings.state_dir.join(AUTHORITY)).unwrap(),
        authority
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join(SNAPSHOT)).unwrap(),
        snapshot
    );
    let active = runtime.active_config().await.unwrap();
    runtime.shutdown().await;
    let (restarted, _) = restart(&settings).await;
    assert_eq!(restarted.active_config().await.unwrap(), active);
    restarted.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn symlinked_authority_never_authorizes_snapshot_recovery() {
    for dangling in [false, true] {
        let (runtime, settings) = runtime(Some(FakeCaddy::new()));
        runtime.initialize().await;
        runtime.apply(configuration(4_000)).await.unwrap();
        runtime.shutdown().await;
        let authority = settings.state_dir.join(AUTHORITY);
        let contents = std::fs::read(&authority).unwrap();
        std::fs::remove_file(&authority).unwrap();
        let target = settings.state_dir.join("authority-target");
        if !dangling {
            std::fs::write(&target, contents).unwrap();
        }
        std::os::unix::fs::symlink(&target, &authority).unwrap();
        let (restarted, engine) = restart(&settings).await;
        assert_eq!(restarted.status().await.active_revision, None);
        assert!(!engine.configuration.lock().await.contains("demo.test"));
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn symlinked_fence_never_authorizes_snapshot_recovery() {
    for dangling in [false, true] {
        let engine = FakeCaddy::new();
        let (runtime, settings) = runtime(Some(engine));
        runtime.initialize().await;
        runtime.apply(configuration(4_000)).await.unwrap();
        runtime.shutdown().await;
        let target = settings.state_dir.join("missing-fence-target");
        if !dangling {
            std::fs::write(&target, "pending").unwrap();
        }
        std::os::unix::fs::symlink(&target, settings.state_dir.join(FENCE)).unwrap();
        let (restarted, engine) = restart(&settings).await;
        assert_eq!(restarted.status().await.active_revision, None);
        assert!(!engine.configuration.lock().await.contains("demo.test"));
        restarted.shutdown().await;
        std::fs::remove_dir_all(&settings.state_dir).unwrap();
    }
}
