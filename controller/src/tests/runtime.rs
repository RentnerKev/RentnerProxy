use std::{
    collections::VecDeque,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use tokio::sync::Mutex;

use crate::{
    models::{
        ApplyOutcome, ProxyConfigRequest, ProxyHost, ProxyHttpSettings, ValidatedProxyConfig,
    },
    proxy::{revision_for_configuration, validate_proxy_config},
    runtime::{
        CertificateError, CertificateImportRequest, EngineError, EngineFuture, ProxyEngine,
        ProxyRuntime, RuntimeError, RuntimeSettings,
        clock::{civil_from_days, utc_now},
        renderer::{MAX_RENDERED_PROXY_CONFIG_BYTES, RenderSettings, render_config},
    },
};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

struct FakeEngine {
    test_results: Mutex<VecDeque<Result<(), EngineError>>>,
    reload_results: Mutex<VecDeque<Result<(), EngineError>>>,
    tested_paths: Mutex<Vec<PathBuf>>,
    reload_count: AtomicUsize,
    running: AtomicBool,
    test_calls: AtomicUsize,
    second_test_delay: Option<Duration>,
    reload_delay: Option<Duration>,
}

impl FakeEngine {
    fn succeeds() -> Self {
        Self {
            test_results: Mutex::new(VecDeque::from([Ok(())])),
            reload_results: Mutex::new(VecDeque::from([Ok(())])),
            tested_paths: Mutex::new(Vec::new()),
            reload_count: AtomicUsize::new(0),
            running: AtomicBool::new(false),
            test_calls: AtomicUsize::new(0),
            second_test_delay: None,
            reload_delay: None,
        }
    }

    async fn next_result(
        queue: &Mutex<VecDeque<Result<(), EngineError>>>,
    ) -> Result<(), EngineError> {
        queue.lock().await.pop_front().unwrap_or(Ok(()))
    }
}

impl ProxyEngine for FakeEngine {
    fn test_config<'a>(&'a self, path: &'a Path) -> EngineFuture<'a> {
        Box::pin(async move {
            self.tested_paths.lock().await.push(path.to_path_buf());
            let call = self.test_calls.fetch_add(1, Ordering::SeqCst);
            if call > 0
                && let Some(delay) = self.second_test_delay
            {
                tokio::time::sleep(delay).await;
            }
            Self::next_result(&self.test_results).await
        })
    }

    fn start<'a>(&'a self, _: &'a Path, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.running.store(true, Ordering::SeqCst);
            Ok(())
        })
    }

    fn reload<'a>(&'a self, _: &'a Path, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.reload_count.fetch_add(1, Ordering::SeqCst);
            if let Some(delay) = self.reload_delay {
                tokio::time::sleep(delay).await;
            }
            Self::next_result(&self.reload_results).await
        })
    }

    fn shutdown<'a>(&'a self) -> EngineFuture<'a> {
        Box::pin(async move {
            self.running.store(false, Ordering::SeqCst);
            Ok(())
        })
    }

    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move { self.running.load(Ordering::SeqCst) })
    }
}

fn test_runtime(engine: Option<Arc<dyn ProxyEngine>>) -> (Arc<ProxyRuntime>, RuntimeSettings) {
    let suffix = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-runtime-test-{}-{suffix}",
        std::process::id()
    ));
    let mut settings = RuntimeSettings::new(path, 18_080);
    settings.lock_wait = Duration::from_millis(30);
    settings.stage_timeout = Duration::from_millis(50);
    let runtime = ProxyRuntime::new(settings.clone(), engine);
    (runtime, settings)
}

fn configuration(port: u16) -> ValidatedProxyConfig {
    configuration_with_settings(port, ProxyHttpSettings::default())
}

fn configuration_with_settings(
    port: u16,
    http_settings: ProxyHttpSettings,
) -> ValidatedProxyConfig {
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: port,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
        certificate_id: None,
        force_https: false,
    }];
    let version = if http_settings.is_empty() { 1 } else { 2 };
    validate_proxy_config(ProxyConfigRequest {
        version,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    })
    .unwrap()
}
fn configuration_with_advanced(port: u16, advanced_config: &str) -> ValidatedProxyConfig {
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: port,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: advanced_config.to_owned(),
        certificate_id: None,
        force_https: false,
    }];
    let http_settings = ProxyHttpSettings::default();
    validate_proxy_config(ProxyConfigRequest {
        version: 3,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    })
    .unwrap()
}

#[tokio::test]
async fn candidate_is_tested_before_active_configuration_changes() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, settings) = test_runtime(Some(engine.clone()));
    runtime.initialize().await;
    let before = std::fs::read(settings.state_dir.join("active.conf")).unwrap();

    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Ok(ApplyOutcome::Applied)
    );
    assert!(
        engine
            .tested_paths
            .lock()
            .await
            .iter()
            .any(|path| path.ends_with("candidate.conf"))
    );
    assert_ne!(
        std::fs::read(settings.state_dir.join("active.conf")).unwrap(),
        before
    );
}

fn tls_configuration(certificate_id: &str) -> ValidatedProxyConfig {
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: 4_000,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
        certificate_id: Some(certificate_id.to_owned()),
        force_https: true,
    }];
    let http_settings = ProxyHttpSettings::default();
    validate_proxy_config(ProxyConfigRequest {
        version: 4,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    })
    .expect("TLS configuration should validate")
}

fn certificate_import_request() -> CertificateImportRequest {
    let certificate = rcgen::generate_simple_self_signed(vec!["demo.test".to_owned()])
        .expect("test certificate should generate");
    CertificateImportRequest {
        certificate_pem: certificate.cert.pem(),
        private_key_pem: certificate.signing_key.serialize_pem(),
        chain_pem: None,
        required_domains: Some(vec!["demo.test".to_owned()]),
    }
}

#[tokio::test]
async fn failed_certificate_replacement_preserves_active_material_and_configuration() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([
            Ok(()),
            Ok(()),
            Err(EngineError::CommandFailed),
        ])),
        reload_results: Mutex::new(VecDeque::from([Ok(())])),
        ..FakeEngine::succeeds()
    });
    let (runtime, settings) = test_runtime(Some(engine));
    runtime.initialize().await;
    let certificate_id = "0198d98a-0000-7000-8000-000000000001";
    runtime
        .import_certificate(certificate_id, certificate_import_request())
        .await
        .expect("initial certificate should import before it is assigned");
    let configuration = tls_configuration(certificate_id);
    assert_eq!(
        runtime.apply(configuration).await,
        Ok(ApplyOutcome::Applied)
    );
    let before_metadata = runtime
        .certificate(certificate_id)
        .await
        .expect("initial metadata should exist");
    let before_active = std::fs::read(settings.state_dir.join("active.conf"))
        .expect("active configuration should exist");

    assert_eq!(
        runtime
            .import_certificate(certificate_id, certificate_import_request())
            .await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(
        runtime
            .certificate(certificate_id)
            .await
            .expect("old metadata should remain"),
        before_metadata
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join("active.conf"))
            .expect("active configuration should remain"),
        before_active
    );
}
#[tokio::test]
async fn tls_missing_material_and_reload_failure_preserve_active_material_pointer() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([Ok(()), Ok(()), Ok(())])),
        reload_results: Mutex::new(VecDeque::from([
            Ok(()),
            Err(EngineError::CommandFailed),
            Ok(()),
        ])),
        ..FakeEngine::succeeds()
    });
    let (runtime, settings) = test_runtime(Some(engine));
    runtime.initialize().await;
    let certificate_id = "0198d98a-0000-7000-8000-000000000001";
    runtime
        .import_certificate(certificate_id, certificate_import_request())
        .await
        .expect("initial certificate should import before it is assigned");
    let configuration = tls_configuration(certificate_id);
    runtime
        .apply(configuration.clone())
        .await
        .expect("initial TLS configuration should apply");
    let before_metadata = runtime
        .certificate(certificate_id)
        .await
        .expect("initial metadata should exist");
    let before_active = std::fs::read(settings.state_dir.join("active.conf"))
        .expect("active TLS configuration should exist");

    assert_eq!(
        runtime
            .apply(tls_configuration("0198d98a-0000-7000-8000-000000000002"))
            .await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join("active.conf"))
            .expect("missing material must not replace active configuration"),
        before_active
    );

    assert_eq!(
        runtime
            .import_certificate(certificate_id, certificate_import_request())
            .await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(
        runtime
            .certificate(certificate_id)
            .await
            .expect("failed TLS reload must keep old metadata pointer"),
        before_metadata
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join("active.conf"))
            .expect("failed TLS reload must restore active configuration"),
        before_active
    );
    assert_eq!(
        runtime.status().await.active_revision,
        Some(configuration.revision)
    );
}

#[tokio::test]
async fn canceled_import_continues_to_a_complete_active_tls_version() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([Ok(()), Ok(()), Ok(())])),
        reload_results: Mutex::new(VecDeque::from([Ok(()), Ok(()), Ok(())])),
        second_test_delay: Some(Duration::from_millis(100)),
        ..FakeEngine::succeeds()
    });
    let suffix = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
    let state_dir = std::env::temp_dir().join(format!(
        "rentnerproxy-runtime-canceled-import-test-{}-{suffix}",
        std::process::id()
    ));
    let mut settings = RuntimeSettings::new(state_dir, 18_080);
    settings.lock_wait = Duration::from_secs(1);
    settings.stage_timeout = Duration::from_secs(1);
    let runtime = ProxyRuntime::new(settings.clone(), Some(engine.clone()));
    runtime.initialize().await;
    let certificate_id = "0198d98a-0000-7000-8000-000000000001";
    runtime
        .import_certificate(certificate_id, certificate_import_request())
        .await
        .expect("initial certificate should import before it is assigned");
    runtime
        .apply(tls_configuration(certificate_id))
        .await
        .expect("initial TLS configuration should apply");
    let before_active = std::fs::read(settings.state_dir.join("active.conf"))
        .expect("initial TLS configuration should exist");
    let before_fingerprint = runtime
        .certificate(certificate_id)
        .await
        .expect("initial TLS metadata should exist")
        .fingerprint;

    let import_runtime = runtime.clone();
    let aborted_import = tokio::spawn(async move {
        import_runtime
            .import_certificate(certificate_id, certificate_import_request())
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while engine.test_calls.load(Ordering::SeqCst) < 3 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("replacement import should reach the delayed config test");
    aborted_import.abort();
    let _ = aborted_import.await;

    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let active = std::fs::read(settings.state_dir.join("active.conf"))
                .expect("active TLS configuration should remain readable");
            let metadata = runtime
                .certificate(certificate_id)
                .await
                .expect("TLS metadata should remain readable");
            if active != before_active && metadata.fingerprint != before_fingerprint {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("detached import should complete after caller cancellation");
    runtime
        .import_certificate(certificate_id, certificate_import_request())
        .await
        .expect("completed detached import must release its certificate lease");
}
#[tokio::test]
async fn invalid_candidate_preserves_active_configuration() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([Ok(()), Err(EngineError::CommandFailed)])),
        ..FakeEngine::succeeds()
    });
    let (runtime, settings) = test_runtime(Some(engine));
    runtime.initialize().await;
    let before = std::fs::read(settings.state_dir.join("active.conf")).unwrap();

    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join("active.conf")).unwrap(),
        before
    );
}

#[tokio::test]
async fn reload_failure_rolls_back_and_failed_recovery_does_not_advance_revision() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([Ok(()), Ok(())])),
        reload_results: Mutex::new(VecDeque::from([Err(EngineError::CommandFailed), Ok(())])),
        ..FakeEngine::succeeds()
    });
    let (runtime, settings) = test_runtime(Some(engine.clone()));
    runtime.initialize().await;
    let before = std::fs::read(settings.state_dir.join("active.conf")).unwrap();
    let attempted = configuration(4_000);

    assert_eq!(
        runtime.apply(attempted.clone()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(
        std::fs::read(settings.state_dir.join("active.conf")).unwrap(),
        before
    );
    assert_eq!(engine.reload_count.load(Ordering::SeqCst), 2);
    assert_ne!(
        runtime.status().await.active_revision.as_deref(),
        Some(attempted.revision.as_str())
    );
}

#[tokio::test]
async fn custom_http_settings_follow_normal_apply_and_rollback() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([Ok(()), Ok(())])),
        reload_results: Mutex::new(VecDeque::from([Err(EngineError::CommandFailed), Ok(())])),
        ..FakeEngine::succeeds()
    });
    let (runtime, settings) = test_runtime(Some(engine.clone()));
    runtime.initialize().await;
    let before = std::fs::read(settings.state_dir.join("active.conf")).unwrap();
    let attempted = configuration_with_settings(
        4_000,
        ProxyHttpSettings {
            client_max_body_size_bytes: Some(10_485_760),
            proxy_read_timeout_seconds: Some(300),
            ..ProxyHttpSettings::default()
        },
    );

    assert_eq!(
        runtime.apply(attempted.clone()).await,
        Err(RuntimeError::ApplyFailed)
    );
    let active = std::fs::read(settings.state_dir.join("active.conf")).unwrap();
    assert_eq!(active, before);
    assert!(!String::from_utf8_lossy(&active).contains("rentnerproxy: managed HTTP settings"));
    assert_eq!(engine.reload_count.load(Ordering::SeqCst), 2);
    assert_ne!(
        runtime.status().await.active_revision.as_deref(),
        Some(attempted.revision.as_str())
    );
}

#[tokio::test]
async fn idempotence_timeout_and_serialization_are_safe() {
    let engine = Arc::new(FakeEngine {
        second_test_delay: Some(Duration::from_millis(100)),
        ..FakeEngine::succeeds()
    });
    let (runtime, _) = test_runtime(Some(engine));
    runtime.initialize().await;
    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Err(RuntimeError::ApplyFailed)
    );

    let engine = Arc::new(FakeEngine {
        reload_delay: Some(Duration::from_millis(80)),
        ..FakeEngine::succeeds()
    });
    let (runtime, _) = test_runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first_runtime = runtime.clone();
    let first = tokio::spawn(async move { first_runtime.apply(configuration(4_000)).await });
    tokio::time::sleep(Duration::from_millis(5)).await;
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::Busy)
    );
    assert_eq!(first.await.unwrap(), Err(RuntimeError::ApplyFailed));

    let normal_engine = Arc::new(FakeEngine::succeeds());
    let (normal, _) = test_runtime(Some(normal_engine.clone()));
    normal.initialize().await;
    let config = configuration(4_000);
    assert_eq!(
        normal.apply(config.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    assert_eq!(normal.apply(config).await, Ok(ApplyOutcome::Unchanged));
    assert_eq!(normal_engine.reload_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn active_config_rejects_sources_over_hard_limit() {
    let (runtime, settings) = test_runtime(None);
    runtime.initialize().await;
    std::fs::write(
        settings.state_dir.join("active.conf"),
        vec![b'x'; MAX_RENDERED_PROXY_CONFIG_BYTES + 1],
    )
    .unwrap();

    assert_eq!(
        runtime.active_config().await,
        Err(RuntimeError::ConfigTooLarge)
    );
}

#[tokio::test]
async fn preview_rejects_rendered_sources_over_hard_limit() {
    let (runtime, _) = test_runtime(None);
    let configuration = ValidatedProxyConfig {
        revision: format!("sha256:{}", "0".repeat(64)),
        proxy_hosts: vec![ProxyHost {
            id: "00000000-0000-0000-0000-000000000000".to_owned(),
            domains: vec!["a".repeat(MAX_RENDERED_PROXY_CONFIG_BYTES)],
            forward_scheme: "http".to_owned(),
            forward_host: "backend".to_owned(),
            forward_port: 4_000,
            http_settings: ProxyHttpSettings::default(),
            advanced_config: String::new(),
            certificate_id: None,
            force_https: false,
        }],
        http_settings: ProxyHttpSettings::default(),
    };

    assert_eq!(
        runtime.preview_config(&configuration).await,
        Err(RuntimeError::ConfigTooLarge)
    );
}

#[tokio::test]
async fn startup_recovers_persisted_state_and_missing_engine_is_unavailable() {
    let (initial, settings) = test_runtime(None);
    initial.initialize().await;
    let config = configuration(4_000);
    let rendered = render_config(
        Some(&config),
        &RenderSettings {
            http_port: settings.http_port,
            probe_socket: settings.probe_socket(),
        },
    )
    .unwrap();
    std::fs::write(settings.state_dir.join("active.conf"), rendered.as_bytes()).unwrap();
    std::fs::write(
        settings.state_dir.join("last-good.conf"),
        rendered.as_bytes(),
    )
    .unwrap();

    let restarted = ProxyRuntime::new(settings.clone(), None);
    restarted.initialize().await;
    assert_eq!(
        restarted.status().await.active_revision,
        Some(config.revision)
    );
    assert_eq!(
        restarted.apply(configuration(4_001)).await,
        Err(RuntimeError::Unavailable)
    );
}

#[tokio::test]
async fn startup_restores_last_good_for_missing_or_invalid_active_files() {
    let (initial, settings) = test_runtime(None);
    initial.initialize().await;
    let config = configuration(4_000);
    let rendered = render_config(
        Some(&config),
        &RenderSettings {
            http_port: settings.http_port,
            probe_socket: settings.probe_socket(),
        },
    )
    .unwrap();
    std::fs::write(
        settings.state_dir.join("last-good.conf"),
        rendered.as_bytes(),
    )
    .unwrap();
    std::fs::remove_file(settings.state_dir.join("active.conf")).unwrap();

    let missing_active =
        ProxyRuntime::new(settings.clone(), Some(Arc::new(FakeEngine::succeeds())));
    missing_active.initialize().await;
    assert_eq!(
        missing_active.status().await.active_revision,
        Some(config.revision.clone())
    );

    std::fs::write(
        settings.state_dir.join("active.conf"),
        b"not nginx configuration",
    )
    .unwrap();
    let invalid_active = ProxyRuntime::new(
        settings.clone(),
        Some(Arc::new(FakeEngine {
            test_results: Mutex::new(VecDeque::from([Err(EngineError::CommandFailed), Ok(())])),
            ..FakeEngine::succeeds()
        })),
    );
    invalid_active.initialize().await;
    assert_eq!(
        invalid_active.status().await.active_revision,
        Some(config.revision)
    );
}

#[tokio::test]
async fn matching_revision_requires_a_live_engine() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, _) = test_runtime(Some(engine.clone()));
    runtime.initialize().await;
    let config = configuration(4_000);
    assert_eq!(
        runtime.apply(config.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    engine.running.store(false, Ordering::SeqCst);
    assert_eq!(runtime.apply(config).await, Err(RuntimeError::Unavailable));
}

#[test]
fn timestamps_are_utc_and_calendar_conversion_is_stable() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(civil_from_days(11_323), (2001, 1, 1));
    assert!(utc_now().ends_with('Z'));
}

#[tokio::test]
async fn active_host_source_is_written_only_after_a_successful_apply() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, settings) = test_runtime(Some(engine));
    runtime.initialize().await;
    let configuration = configuration_with_advanced(
        4_000,
        "# expert config\nadd_header X-Test \"active\" always;\n",
    );

    assert_eq!(
        runtime.apply(configuration.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    let (source, active_revision) = runtime
        .active_host_config("00000000-0000-0000-0000-000000000000")
        .await
        .unwrap();
    assert_eq!(active_revision, configuration.revision);
    assert!(source.starts_with("    server {\n"));
    assert!(source.contains("add_header X-Test \"active\" always;"));
    assert!(!source.contains("host HTTP settings begin"));
    let active = std::fs::read_to_string(settings.state_dir.join("active.conf")).unwrap();
    assert!(active.contains(source.as_str()));
}

#[tokio::test]
async fn rejected_candidate_keeps_the_previous_host_source() {
    let engine = Arc::new(FakeEngine {
        test_results: Mutex::new(VecDeque::from([
            Ok(()),
            Ok(()),
            Err(EngineError::CommandFailed),
        ])),
        ..FakeEngine::succeeds()
    });
    let (runtime, _) = test_runtime(Some(engine));
    runtime.initialize().await;
    let first = configuration_with_advanced(4_000, "add_header X-Revision \"first\";");
    assert_eq!(
        runtime.apply(first.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    let (before, before_revision) = runtime
        .active_host_config("00000000-0000-0000-0000-000000000000")
        .await
        .unwrap();

    let rejected = configuration_with_advanced(4_001, "add_header X-Revision \"second\";");
    assert_eq!(
        runtime.apply(rejected).await,
        Err(RuntimeError::ApplyFailed)
    );
    let (after, after_revision) = runtime
        .active_host_config("00000000-0000-0000-0000-000000000000")
        .await
        .unwrap();
    assert_eq!(after, before);
    assert_eq!(after_revision, before_revision);
    assert!(after.contains("X-Revision \"first\""));
}

#[tokio::test]
async fn active_host_source_returns_not_found_for_stale_or_unreadable_sidecars() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, settings) = test_runtime(Some(engine));
    runtime.initialize().await;
    assert_eq!(
        runtime
            .apply(configuration_with_advanced(4_000, "return 204;"))
            .await,
        Ok(ApplyOutcome::Applied)
    );
    let sidecar = settings.state_dir.join("active-host-sources.json");
    std::fs::write(
        &sidecar,
        br#"{"revision":"sha256:0000000000000000000000000000000000000000000000000000000000000000","hostSources":{}}"#,
    )
    .unwrap();
    assert_eq!(
        runtime
            .active_host_config("00000000-0000-0000-0000-000000000000")
            .await,
        Err(RuntimeError::HostConfigNotFound)
    );

    std::fs::write(&sidecar, b"{").unwrap();
    assert_eq!(
        runtime
            .active_host_config("00000000-0000-0000-0000-000000000000")
            .await,
        Err(RuntimeError::HostConfigNotFound)
    );

    std::fs::remove_file(&sidecar).unwrap();
    std::fs::create_dir(&sidecar).unwrap();
    assert_eq!(
        runtime
            .active_host_config("00000000-0000-0000-0000-000000000000")
            .await,
        Err(RuntimeError::HostConfigNotFound)
    );
}

#[tokio::test]
async fn active_host_sources_keep_two_hosts_isolated() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, _) = test_runtime(Some(engine));
    runtime.initialize().await;
    let hosts = vec![
        ProxyHost {
            id: "00000000-0000-0000-0000-000000000000".to_owned(),
            domains: vec!["first.test".to_owned()],
            forward_scheme: "http".to_owned(),
            forward_host: "first-backend".to_owned(),
            forward_port: 4_000,
            http_settings: ProxyHttpSettings::default(),
            advanced_config: "add_header X-Host first;".to_owned(),
            certificate_id: None,
            force_https: false,
        },
        ProxyHost {
            id: "10000000-0000-0000-0000-000000000000".to_owned(),
            domains: vec!["second.test".to_owned()],
            forward_scheme: "http".to_owned(),
            forward_host: "second-backend".to_owned(),
            forward_port: 4_001,
            http_settings: ProxyHttpSettings::default(),
            advanced_config: "add_header X-Host second;".to_owned(),
            certificate_id: None,
            force_https: false,
        },
    ];
    let http_settings = ProxyHttpSettings::default();
    let configuration = validate_proxy_config(ProxyConfigRequest {
        version: 3,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    })
    .unwrap();
    assert_eq!(
        runtime.apply(configuration).await,
        Ok(ApplyOutcome::Applied)
    );

    let (first, _) = runtime
        .active_host_config("00000000-0000-0000-0000-000000000000")
        .await
        .unwrap();
    let (second, _) = runtime
        .active_host_config("10000000-0000-0000-0000-000000000000")
        .await
        .unwrap();
    assert!(first.contains("first-backend"));
    assert!(first.contains("X-Host first"));
    assert!(!first.contains("second-backend"));
    assert!(!first.contains("X-Host second"));
    assert!(second.contains("second-backend"));
    assert!(second.contains("X-Host second"));
    assert!(!second.contains("first-backend"));
    assert!(!second.contains("X-Host first"));
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_a_symlink_state_root_before_starting_the_engine() {
    let engine = Arc::new(FakeEngine::succeeds());
    let (runtime, settings) = test_runtime(Some(engine.clone()));
    let target = settings.state_dir.with_extension("target");
    std::fs::create_dir_all(&target).expect("test target should create");
    std::os::unix::fs::symlink(&target, &settings.state_dir)
        .expect("test state symlink should create");

    runtime.initialize().await;

    let status = runtime.status().await;
    assert!(!status.available);
    assert!(!status.running);
    assert_eq!(engine.test_calls.load(Ordering::SeqCst), 0);
    assert!(!target.join("active.conf").exists());
}
