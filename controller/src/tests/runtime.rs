use super::fixtures::{host, request};
use crate::{
    models::{
        ApplyOutcome, ProxyConfigRequest, ProxyHttpSettings, TrustedCa, UpstreamTls,
        ValidatedProxyConfig,
    },
    proxy::{
        revision_for_configuration_with_trusted_cas, revision_from_config, validate_proxy_config,
        validate_trusted_ca_pem,
    },
    runtime::{
        CertificateError, CertificateImportRequest, EngineError, EngineFuture, ProxyEngine,
        ProxyRuntime, RuntimeError, RuntimeSettings,
        clock::{civil_from_days, utc_now},
    },
};
use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, Notify};
const HOST_ID: &str = "00000000-0000-0000-0000-000000000000";
const CERT_ID: &str = "0198d98a-0000-7000-8000-000000000010";
static NEXT: AtomicU64 = AtomicU64::new(0);

struct FakeCaddy {
    running: AtomicBool,
    configuration: Mutex<String>,
    loads: Mutex<VecDeque<Result<(), EngineError>>>,
    probes: Mutex<VecDeque<Result<(), EngineError>>>,
    starts: Mutex<VecDeque<Result<(), EngineError>>>,
    load_count: AtomicUsize,
    start_count: AtomicUsize,
    probe_count: AtomicUsize,
    delay_ms: AtomicU64,
    start_delay_ms: AtomicU64,
    load_started: Notify,
}
impl FakeCaddy {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            running: AtomicBool::new(false),
            configuration: Mutex::new(String::new()),
            loads: Mutex::new(VecDeque::new()),
            probes: Mutex::new(VecDeque::new()),
            starts: Mutex::new(VecDeque::new()),
            load_count: AtomicUsize::new(0),
            start_count: AtomicUsize::new(0),
            probe_count: AtomicUsize::new(0),
            delay_ms: AtomicU64::new(0),
            start_delay_ms: AtomicU64::new(0),
            load_started: Notify::new(),
        })
    }
    async fn next(queue: &Mutex<VecDeque<Result<(), EngineError>>>) -> Result<(), EngineError> {
        queue.lock().await.pop_front().unwrap_or(Ok(()))
    }
}
impl ProxyEngine for FakeCaddy {
    fn start<'a>(&'a self, json: &'a str, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.start_count.fetch_add(1, Ordering::SeqCst);
            Self::next(&self.starts).await?;
            *self.configuration.lock().await = json.to_owned();
            self.running.store(true, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(
                self.start_delay_ms.load(Ordering::SeqCst),
            ))
            .await;
            Ok(())
        })
    }
    fn load<'a>(&'a self, json: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.load_count.fetch_add(1, Ordering::SeqCst);
            self.load_started.notify_one();
            tokio::time::sleep(Duration::from_millis(self.delay_ms.load(Ordering::SeqCst))).await;
            let result = Self::next(&self.loads).await;
            if result.is_ok() || result == Err(EngineError::InvalidResponse) {
                *self.configuration.lock().await = json.to_owned();
            }
            result
        })
    }
    fn probe<'a>(&'a self, revision: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.probe_count.fetch_add(1, Ordering::SeqCst);
            Self::next(&self.probes).await?;
            let json = self.configuration.lock().await;
            let active = revision_from_config(&json).unwrap_or_else(|| "none".to_owned());
            if self.running.load(Ordering::SeqCst) && active == revision {
                Ok(())
            } else {
                Err(EngineError::InvalidResponse)
            }
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
fn runtime(engine: Option<Arc<dyn ProxyEngine>>) -> (Arc<ProxyRuntime>, RuntimeSettings) {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-caddy-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let mut settings = RuntimeSettings::new(path, 18_080);
    settings.stage_timeout = Duration::from_millis(500);
    settings.lock_wait = Duration::from_secs(2);
    settings.recovery_interval = Duration::from_millis(20);
    (ProxyRuntime::new(settings.clone(), engine), settings)
}
fn configuration(port: u16) -> ValidatedProxyConfig {
    validate_proxy_config(request(vec![host(
        HOST_ID,
        &["demo.test"],
        "http",
        "backend",
        port,
    )]))
    .unwrap()
}
fn tls_configuration() -> ValidatedProxyConfig {
    let mut proxy = host(HOST_ID, &["demo.test"], "http", "backend", 4_000);
    proxy.certificate_id = Some(CERT_ID.to_owned());
    proxy.force_https = true;
    validate_proxy_config(request(vec![proxy])).unwrap()
}
fn trusted_ca() -> TrustedCa {
    let mut parameters = rcgen::CertificateParams::new(vec!["test-ca.internal".to_owned()])
        .expect("test CA names should be valid");
    parameters.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    parameters.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
    let key_pair = rcgen::KeyPair::generate().expect("test CA key should generate");
    let parsed = validate_trusted_ca_pem(
        &parameters
            .self_signed(&key_pair)
            .expect("test CA certificate should generate")
            .pem(),
    )
    .expect("test CA should validate");
    TrustedCa {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        pem: parsed.pem,
        fingerprint_sha256: parsed.fingerprint_sha256,
    }
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

fn upstream_configuration(ca: TrustedCa) -> ValidatedProxyConfig {
    let mut proxy = host(HOST_ID, &["demo.test"], "https", "backend.internal", 4_443);
    proxy.upstream_tls = Some(UpstreamTls {
        verify: true,
        server_name: None,
        trusted_ca_id: Some(ca.id.clone()),
    });
    let hosts = vec![proxy];
    let settings = ProxyHttpSettings::default();
    validate_proxy_config(ProxyConfigRequest {
        version: 7,
        revision: revision_for_configuration_with_trusted_cas(
            &hosts,
            &settings,
            std::slice::from_ref(&ca),
        ),
        proxy_hosts: hosts,
        redirect_hosts: vec![],
        http_settings: settings,
        trusted_cas: vec![ca],
    })
    .unwrap()
}

#[tokio::test]
async fn rejected_load_keeps_verified_traffic_revision_and_snapshot() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    let snapshot = std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    assert_eq!(*engine.configuration.lock().await, previous.0);
    assert_eq!(
        std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap(),
        snapshot
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), 2);
    assert!(runtime.is_ready().await);
}

#[tokio::test]
async fn successful_admin_response_requires_real_revision_confirmation() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    engine
        .probes
        .lock()
        .await
        .push_back(Err(EngineError::TimedOut));
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), previous);
    assert_eq!(*engine.configuration.lock().await, previous.0);
    assert!(runtime.is_ready().await);
}

#[tokio::test]
async fn ambiguous_admin_acknowledgement_restarts_from_verified_state() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::InvalidResponse));
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(*engine.configuration.lock().await, previous.0);
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 2);
    assert!(runtime.is_ready().await);
}

#[tokio::test]
async fn failed_recovery_stays_not_ready_until_owned_worker_recovers() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let expected = configuration(4_000);
    runtime.apply(expected.clone()).await.unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::InvalidResponse));
    engine
        .starts
        .lock()
        .await
        .push_back(Err(EngineError::Unavailable));
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert!(!runtime.is_ready().await);
    runtime.start_recovery_worker().await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while !runtime.is_ready().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        runtime.status().await.active_revision,
        Some(expected.revision)
    );
    runtime.shutdown().await;
}

#[tokio::test]
async fn child_exit_lowers_readiness_and_automatically_recovers() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    runtime.start_recovery_worker().await;
    engine.running.store(false, Ordering::SeqCst);
    assert!(!runtime.is_ready().await);
    tokio::time::timeout(Duration::from_secs(2), async {
        while !runtime.is_ready().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let latest = configuration(4_001);
    runtime.apply(latest.clone()).await.unwrap();
    assert_eq!(
        runtime.status().await.active_revision,
        Some(latest.revision)
    );
    runtime.shutdown().await;
}

#[tokio::test]
async fn startup_accepts_only_v7_recovery_snapshots() {
    let engine = FakeCaddy::new();
    let (first, settings) = runtime(Some(engine));
    first.initialize().await;
    let expected = configuration(4_000);
    first.apply(expected.clone()).await.unwrap();
    first.shutdown().await;
    let engine = FakeCaddy::new();
    let second = ProxyRuntime::new(settings.clone(), Some(engine.clone()));
    second.initialize().await;
    assert_eq!(
        second.status().await.active_revision,
        Some(expected.revision)
    );
    second.shutdown().await;
    let path = settings.state_dir.join("active-proxy-snapshot.json");
    let mut snapshot: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    for version in 1..=6 {
        snapshot["version"] = version.into();
        std::fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();
        let runtime = ProxyRuntime::new(settings.clone(), Some(FakeCaddy::new()));
        runtime.initialize().await;
        assert_eq!(runtime.status().await.active_revision, None);
        assert!(runtime.is_ready().await);
        runtime.shutdown().await;
    }
}

#[tokio::test]
async fn restart_keeps_verified_routes_after_certificate_expiry_but_rejects_new_activations() {
    let (runtime, settings) = runtime(Some(FakeCaddy::new()));
    runtime.initialize().await;
    runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let mut hosts = tls_configuration().proxy_hosts;
    let http_id = "0198d98a-0000-7000-8000-000000000011";
    hosts.push(host(http_id, &["unrelated.test"], "http", "backend", 4_001));
    let verified = validate_proxy_config(request(hosts)).unwrap();
    runtime.apply(verified.clone()).await.unwrap();
    let before = runtime.active_config().await.unwrap();
    runtime.shutdown().await;

    // Simulate time passing for the stored certificate; this does not change desired state.
    let index_path = settings
        .state_dir
        .join("certificates/certificate-metadata.json");
    let mut index: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
    index["certificates"][CERT_ID]["expiresAt"] = "2000-01-01T00:00:00Z".into();
    std::fs::write(&index_path, serde_json::to_vec(&index).unwrap()).unwrap();

    let recovered = ProxyRuntime::new(settings.clone(), Some(FakeCaddy::new()));
    recovered.initialize().await;
    assert!(recovered.is_ready().await);
    assert_eq!(recovered.active_config().await.unwrap(), before);
    assert!(recovered.active_host_config(http_id).await.is_ok());
    assert!(recovered.active_host_config(HOST_ID).await.is_ok());
    assert_eq!(
        recovered.apply(verified.clone()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(recovered.active_config().await.unwrap(), before);
    recovered.shutdown().await;

    // Recovery relaxes only expiry, never the stored certificate's domain ownership.
    index["certificates"][CERT_ID]["domains"] = serde_json::json!(["other.test"]);
    std::fs::write(index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    let mismatched = ProxyRuntime::new(settings, Some(FakeCaddy::new()));
    mismatched.initialize().await;
    assert_eq!(mismatched.status().await.active_revision, None);
    mismatched.shutdown().await;
}

#[tokio::test]
async fn unavailable_startup_heals_without_user_action() {
    let engine = FakeCaddy::new();
    engine
        .starts
        .lock()
        .await
        .extend([Err(EngineError::Unavailable), Err(EngineError::Unavailable)]);
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    assert!(!runtime.is_ready().await);
    runtime.start_recovery_worker().await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while !runtime.is_ready().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    runtime.shutdown().await;
}

#[tokio::test]
async fn unchanged_configuration_is_probed_without_reloading() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let config = configuration(4_000);
    assert_eq!(
        runtime.apply(config.clone()).await,
        Ok(ApplyOutcome::Applied)
    );
    assert_eq!(runtime.apply(config).await, Ok(ApplyOutcome::Unchanged));
    assert_eq!(engine.load_count.load(Ordering::SeqCst), 1);
    assert_eq!(engine.probe_count.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn queued_stale_applies_are_coalesced_to_the_latest_configuration() {
    let engine = FakeCaddy::new();
    engine.delay_ms.store(80, Ordering::SeqCst);
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.apply(configuration(4_000)).await })
    };
    tokio::time::timeout(Duration::from_secs(2), engine.load_started.notified())
        .await
        .expect("apply reaches Caddy load");
    let stale = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.apply(configuration(4_001)).await })
    };
    tokio::task::yield_now().await;
    let latest_config = configuration(4_002);
    let latest = {
        let runtime = runtime.clone();
        let config = latest_config.clone();
        tokio::spawn(async move { runtime.apply(config).await })
    };
    first.await.unwrap().unwrap();
    assert_eq!(stale.await.unwrap(), Err(RuntimeError::Busy));
    latest.await.unwrap().unwrap();
    assert_eq!(
        runtime.status().await.active_revision,
        Some(latest_config.revision)
    );
    assert_eq!(engine.load_count.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn cancelled_caller_does_not_cancel_inflight_apply_and_shutdown_drains_it() {
    let engine = FakeCaddy::new();
    engine.delay_ms.store(50, Ordering::SeqCst);
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let task = {
        let runtime = runtime.clone();
        tokio::spawn(async move { runtime.apply(configuration(4_000)).await })
    };
    tokio::time::timeout(Duration::from_secs(2), engine.load_started.notified())
        .await
        .expect("apply reaches Caddy load");
    task.abort();
    let _ = task.await;
    runtime.shutdown().await;
    assert_eq!(
        runtime.status().await.active_revision,
        Some(configuration(4_000).revision)
    );
    assert!(!engine.running.load(Ordering::SeqCst));
    assert_eq!(
        runtime.apply(configuration(4_001)).await,
        Err(RuntimeError::Unavailable)
    );
    assert_eq!(runtime.recover().await, Err(RuntimeError::Unavailable));
}

#[tokio::test]
async fn certificate_replacement_changes_material_without_changing_desired_revision() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let config = tls_configuration();
    runtime.apply(config.clone()).await.unwrap();
    let before = runtime.active_config().await.unwrap();
    let next = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    let after = runtime.active_config().await.unwrap();
    assert_ne!(next.fingerprint, first.fingerprint);
    assert_ne!(after.0, before.0);
    assert_eq!(after.1, Some(config.revision));
    assert!(!after.0.contains("BEGIN PRIVATE KEY"));
    assert_eq!(
        runtime.delete_certificate(CERT_ID).await,
        Err(CertificateError::InUse)
    );
}

#[tokio::test]
async fn rejected_certificate_replacement_preserves_pointer_and_active_material() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    runtime.apply(tls_configuration()).await.unwrap();
    let before = runtime.active_config().await.unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    assert_eq!(
        runtime
            .import_certificate(CERT_ID, certificate_import_request())
            .await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(
        runtime.certificate(CERT_ID).await.unwrap().fingerprint,
        first.fingerprint
    );
    assert_eq!(runtime.active_config().await.unwrap(), before);
    assert!(runtime.is_ready().await);
}

#[tokio::test]
async fn missing_certificate_never_replaces_active_configuration() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    let before = runtime.active_config().await.unwrap();
    assert_eq!(
        runtime.apply(tls_configuration()).await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), before);
    assert_eq!(engine.load_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn cancelled_certificate_import_still_completes_verified_activation() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let first = runtime
        .import_certificate(CERT_ID, certificate_import_request())
        .await
        .unwrap();
    runtime.apply(tls_configuration()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), engine.load_started.notified())
        .await
        .expect("apply reaches Caddy load");
    engine.delay_ms.store(50, Ordering::SeqCst);
    let task = {
        let runtime = runtime.clone();
        tokio::spawn(async move {
            runtime
                .import_certificate(CERT_ID, certificate_import_request())
                .await
        })
    };
    tokio::time::timeout(Duration::from_secs(2), engine.load_started.notified())
        .await
        .expect("apply reaches Caddy load");
    task.abort();
    let _ = task.await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while runtime.certificate(CERT_ID).await.unwrap().fingerprint == first.fingerprint {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(runtime.is_ready().await);
}

#[tokio::test]
async fn ca_preview_is_pure_and_corruption_is_detected_even_on_unchanged_apply() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    let ca = trusted_ca();
    let config = upstream_configuration(ca.clone());
    runtime.preview_config(&config).await.unwrap();
    let root = settings.state_dir.join("trusted-cas").join(&ca.id);
    assert!(!root.exists());
    runtime.apply(config.clone()).await.unwrap();
    let before = runtime.active_config().await.unwrap();
    let ca_path = std::fs::read_dir(&root)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(ca_path, b"broken trust material").unwrap();
    assert_eq!(runtime.apply(config).await, Err(RuntimeError::ApplyFailed));
    assert_eq!(runtime.active_config().await.unwrap(), before);
    assert_eq!(engine.load_count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn active_host_inspection_uses_only_verified_host_sources() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    assert_eq!(
        runtime.active_host_config(HOST_ID).await,
        Err(RuntimeError::HostConfigNotFound)
    );
    runtime.apply(configuration(4_000)).await.unwrap();
    let before = runtime.active_host_config(HOST_ID).await.unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    runtime.apply(configuration(4_001)).await.unwrap_err();
    assert_eq!(runtime.active_host_config(HOST_ID).await.unwrap(), before);
    for id in ["../x", "/etc/passwd", "bad-id"] {
        assert_eq!(
            runtime.active_host_config(id).await,
            Err(RuntimeError::HostConfigNotFound)
        );
    }
}

#[tokio::test]
async fn no_engine_is_not_ready() {
    let (runtime, _) = runtime(None);
    runtime.initialize().await;
    assert!(!runtime.is_ready().await);
    assert_eq!(
        runtime.apply(configuration(4_000)).await,
        Err(RuntimeError::Unavailable)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn symlinked_state_root_is_rejected_before_process_start() {
    use std::os::unix::fs::symlink;
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    let outside = settings.state_dir.with_extension("outside");
    std::fs::create_dir_all(&outside).unwrap();
    symlink(&outside, &settings.state_dir).unwrap();
    runtime.initialize().await;
    assert!(!runtime.is_ready().await);
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn planted_snapshot_symlink_never_reads_or_overwrites_external_file() {
    use std::os::unix::fs::symlink;
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine));
    runtime.initialize().await;
    let external = settings.state_dir.with_extension("external");
    std::fs::write(&external, "preserve outside").unwrap();
    symlink(
        &external,
        settings.state_dir.join("active-proxy-snapshot.json"),
    )
    .unwrap();
    runtime.apply(configuration(4_000)).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(external).unwrap(),
        "preserve outside"
    );
    assert!(runtime.is_ready().await);
}

#[test]
fn timestamps_are_utc_and_calendar_conversion_is_stable() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(civil_from_days(19_782), (2024, 2, 29));
    assert!(utc_now().ends_with('Z'));
}

#[tokio::test]
async fn failed_readiness_of_a_running_child_triggers_verified_recovery() {
    let engine = FakeCaddy::new();
    let (runtime, _) = runtime(Some(engine.clone()));
    runtime.initialize().await;
    runtime.apply(configuration(4_000)).await.unwrap();
    engine
        .probes
        .lock()
        .await
        .push_back(Err(EngineError::InvalidResponse));
    assert!(!runtime.is_ready().await);
    assert!(!runtime.status().await.available);
    assert!(engine.running.load(Ordering::SeqCst));
    runtime.recover().await.unwrap();
    assert!(runtime.is_ready().await);
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 2);
    assert_eq!(
        runtime.status().await.active_revision,
        Some(configuration(4_000).revision)
    );
}

#[tokio::test]
async fn timed_out_start_reaps_the_tracked_child_before_returning() {
    let engine = FakeCaddy::new();
    engine.start_delay_ms.store(100, Ordering::SeqCst);
    let (_, mut settings) = runtime(None);
    settings.stage_timeout = Duration::from_millis(10);
    let runtime = ProxyRuntime::new(settings, Some(engine.clone()));
    runtime.initialize().await;
    assert!(!engine.running.load(Ordering::SeqCst));
    assert!(!runtime.is_ready().await);
    engine.start_delay_ms.store(0, Ordering::SeqCst);
    runtime.recover().await.unwrap();
    assert!(runtime.is_ready().await);
}

#[cfg(unix)]
#[tokio::test]
async fn planted_caddy_autosave_symlink_is_rejected_before_process_start() {
    use std::os::unix::fs::symlink;
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    let autosave_dir = settings.state_dir.join("caddy/config/caddy");
    std::fs::create_dir_all(&autosave_dir).unwrap();
    let external = settings.state_dir.with_extension("external");
    std::fs::write(&external, "preserve outside").unwrap();
    symlink(&external, autosave_dir.join("autosave.json")).unwrap();
    runtime.initialize().await;
    assert!(!runtime.is_ready().await);
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 0);
    assert_eq!(
        std::fs::read_to_string(external).unwrap(),
        "preserve outside"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn windows_state_root_junction_is_rejected_before_process_start() {
    use std::os::windows::process::CommandExt;
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    let outside = settings.state_dir.with_extension("outside");
    std::fs::create_dir_all(&outside).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&settings.state_dir)
        .arg(&outside)
        .creation_flags(0x0800_0000)
        .output()
        .unwrap();
    assert!(output.status.success(), "junction fixture creation failed");
    runtime.initialize().await;
    assert!(!runtime.is_ready().await);
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 0);
    assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
    std::fs::remove_dir(settings.state_dir).unwrap();
}
