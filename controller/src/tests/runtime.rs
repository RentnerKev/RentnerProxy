use super::fixtures::{host, request};
use crate::{
    models::{
        AccessPolicy, AccessPolicyMode, ApplyOutcome, BasicAuth, BasicAuthAccount, IpDefaultAction,
        IpRules, ProxyConfigRequest, ProxyHttpSettings, TrustedCa, UpstreamTls,
        ValidatedProxyConfig,
    },
    proxy::{
        revision_for_configuration, revision_for_configuration_with_trusted_cas,
        revision_from_config, validate_proxy_config, validate_trusted_ca_pem,
    },
    runtime::{
        CertificateEnvironment, CertificateError, CertificateImportRequest,
        CertificateIssueRequest, CertificateStore, EngineError, EngineFuture, ProxyEngine,
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
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    block_certificate_index: Mutex<Option<std::path::PathBuf>>,
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
            block_certificate_index: Mutex::new(None),
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
            if let Some(index) = self.block_certificate_index.lock().await.take() {
                std::fs::rename(&index, index.with_extension("saved")).unwrap();
                std::fs::create_dir(&index).unwrap();
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
        "rentnerproxy-caddy-test-{}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
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

#[cfg(unix)]
#[tokio::test]
async fn startup_rejects_dangling_access_log_symlink_before_starting_caddy() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    std::fs::create_dir_all(settings.state_dir.join("logs")).unwrap();
    let target = settings.state_dir.join("unexpected-log-target");
    std::os::unix::fs::symlink(&target, settings.state_dir.join("logs/access.log")).unwrap();
    runtime.initialize().await;
    assert_eq!(engine.start_count.load(Ordering::SeqCst), 0);
    assert!(!target.exists());
    assert!(!runtime.status().await.running);
    runtime.shutdown().await;
    std::fs::remove_dir_all(&settings.state_dir).unwrap();
}

fn basic_auth_configuration(port: u16, password_hash: &str) -> ValidatedProxyConfig {
    let mut configuration = configuration(port);
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        mode: AccessPolicyMode::Authenticated,
        combination: None,
        basic_auth: Some(BasicAuth {
            accounts: vec![BasicAuthAccount {
                username: "admin".to_owned(),
                password_hash: password_hash.to_owned(),
            }],
        }),
        ip_rules: None,
    });
    configuration.revision =
        revision_for_configuration(&configuration.proxy_hosts, &configuration.http_settings);
    configuration
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
async fn rejected_apply_keeps_the_last_known_protected_configuration() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;

    let mut protected = configuration(4_000);
    protected.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Deny,
            allow: vec!["192.0.2.0/24".to_owned()],
            deny: Vec::new(),
        }),
    });
    protected.revision =
        revision_for_configuration(&protected.proxy_hosts, &protected.http_settings);
    runtime.apply(protected).await.unwrap();
    let previous = runtime.active_config().await.unwrap();
    assert!(previous.0.contains("192.0.2.0/24"));
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
    assert_eq!(
        std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap(),
        snapshot
    );
    assert!(engine.configuration.lock().await.contains("192.0.2.0/24"));
}

#[tokio::test]
async fn restart_restores_verified_ip_rules_routes() {
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine));
    runtime.initialize().await;
    let mut configuration = configuration(4_000);
    configuration.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Allow,
            allow: Vec::new(),
            deny: vec!["203.0.113.0/24".to_owned()],
        }),
    });
    configuration.revision =
        revision_for_configuration(&configuration.proxy_hosts, &configuration.http_settings);
    runtime.apply(configuration.clone()).await.unwrap();
    let active = runtime.active_config().await.unwrap();
    runtime.shutdown().await;

    let restarted = ProxyRuntime::new(settings, Some(FakeCaddy::new()));
    restarted.initialize().await;
    assert_eq!(restarted.active_config().await.unwrap(), active);
    assert!(
        restarted
            .active_config()
            .await
            .unwrap()
            .0
            .contains("203.0.113.0/24")
    );
    restarted.shutdown().await;
}

#[tokio::test]
async fn basic_auth_rotation_is_transactional_and_removal_closes_the_host() {
    const OLD_HASH: &str = "$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$MrQeoLQVkaRjr94luEbHZECFRREjHzNciGTu9rBCN+Y";
    const NEW_HASH: &str = "$argon2id$v=19$m=47104,t=1,p=1$AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE$2Sv5yy5t9jVZXrcpynqzCfolhbNUZMTb2108vmc7xk4";
    let engine = FakeCaddy::new();
    let (runtime, settings) = runtime(Some(engine.clone()));
    runtime.initialize().await;

    let old = basic_auth_configuration(4_000, OLD_HASH);
    runtime.apply(old).await.unwrap();
    let old_active = runtime.active_config().await.unwrap();
    let old_snapshot =
        std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap();
    assert!(old_active.0.contains(OLD_HASH));
    assert!(old_active.0.contains("\"authentication\""));
    assert!(
        old_snapshot
            .windows(OLD_HASH.len())
            .any(|window| window == OLD_HASH.as_bytes())
    );

    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    assert_eq!(
        runtime
            .apply(basic_auth_configuration(4_001, NEW_HASH))
            .await,
        Err(RuntimeError::ApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), old_active);
    assert_eq!(*engine.configuration.lock().await, old_active.0);
    assert_eq!(
        std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap(),
        old_snapshot
    );

    runtime
        .apply(basic_auth_configuration(4_001, NEW_HASH))
        .await
        .unwrap();
    let new_active = runtime.active_config().await.unwrap();
    let new_snapshot =
        std::fs::read(settings.state_dir.join("active-proxy-snapshot.json")).unwrap();
    assert!(new_active.0.contains(NEW_HASH));
    assert!(!new_active.0.contains(OLD_HASH));
    assert!(
        new_snapshot
            .windows(NEW_HASH.len())
            .any(|window| window == NEW_HASH.as_bytes())
    );
    assert!(
        !new_snapshot
            .windows(OLD_HASH.len())
            .any(|window| window == OLD_HASH.as_bytes())
    );

    let mut removed = configuration(4_002);
    removed.proxy_hosts[0].access_policy = Some(AccessPolicy {
        id: "0198d98a-0000-7000-8000-000000000001".to_owned(),
        mode: AccessPolicyMode::Authenticated,
        combination: None,
        basic_auth: None,
        ip_rules: None,
    });
    removed.revision = revision_for_configuration(&removed.proxy_hosts, &removed.http_settings);
    runtime.apply(removed).await.unwrap();
    let closed = runtime.active_config().await.unwrap();
    assert!(closed.0.contains("\"status_code\":403"));
    assert!(!closed.0.contains(NEW_HASH));
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

async fn runtime_with_issued_candidate(
    engine: Arc<FakeCaddy>,
) -> (Arc<ProxyRuntime>, RuntimeSettings, String) {
    let (_, settings) = runtime(None);
    std::fs::create_dir_all(&settings.state_dir).unwrap();
    let store = CertificateStore::new(settings.state_dir.clone());
    store.initialize().await.unwrap();
    let request = CertificateIssueRequest {
        domains: vec!["example.com".to_owned()],
        environment: CertificateEnvironment::Staging,
        contact_email: None,
        challenge_type: Default::default(),
        dns_provider: None,
        accept_terms: true,
    };
    store
        .begin_issue(CERT_ID, request.clone(), false)
        .await
        .unwrap();
    let first = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    let staged = store
        .stage_acme(
            CERT_ID,
            &request,
            first.cert.pem(),
            first.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    let old = store
        .commit_staged(&staged)
        .await
        .unwrap()
        .fingerprint
        .unwrap();
    drop(store);
    let initial = ProxyRuntime::new(settings.clone(), Some(engine.clone()));
    initial.initialize().await;
    let mut host = host(HOST_ID, &["example.com"], "http", "backend", 4_000);
    host.certificate_id = Some(CERT_ID.to_owned());
    host.force_https = true;
    initial
        .apply(validate_proxy_config(super::fixtures::request(vec![host])).unwrap())
        .await
        .unwrap();
    initial.shutdown().await;
    drop(initial);

    let store = CertificateStore::new(settings.state_dir.clone());
    store.initialize().await.unwrap();
    store.begin_renewal(CERT_ID).await.unwrap();
    let next = rcgen::generate_simple_self_signed(request.domains.clone()).unwrap();
    store
        .stage_acme(
            CERT_ID,
            &request,
            next.cert.pem(),
            next.signing_key.serialize_pem(),
        )
        .await
        .unwrap();
    // Crash after issuance, before activation. No ACME account or server exists:
    // successful recovery can only reuse this exact persisted material.
    drop(store);
    let reopened = ProxyRuntime::new(settings.clone(), Some(engine));
    reopened.initialize().await;
    assert_eq!(
        reopened
            .certificate(CERT_ID)
            .await
            .unwrap()
            .fingerprint
            .as_deref(),
        Some(old.as_str())
    );
    (reopened, settings, old)
}

#[tokio::test]
async fn issued_candidate_survives_load_rejection_and_restart_without_an_acme_order() {
    let engine = FakeCaddy::new();
    let (runtime, settings, old) = runtime_with_issued_candidate(engine.clone()).await;
    let before = runtime.active_config().await.unwrap();
    engine
        .loads
        .lock()
        .await
        .push_back(Err(EngineError::Rejected));
    assert_eq!(
        runtime.retry_certificate_candidate(CERT_ID, false).await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), before);
    assert_eq!(
        runtime
            .certificate(CERT_ID)
            .await
            .unwrap()
            .fingerprint
            .as_deref(),
        Some(old.as_str())
    );
    runtime.shutdown().await;
    let reopened = ProxyRuntime::new(settings, Some(engine));
    reopened.initialize().await;
    let applied = reopened
        .start_acme_renewal(
            CERT_ID.to_owned(),
            crate::server::challenges::ChallengeStore::new(),
        )
        .await
        .unwrap();
    assert_ne!(applied.fingerprint.as_deref(), Some(old.as_str()));
    assert!(
        reopened
            .retry_certificate_candidate(CERT_ID, false)
            .await
            .unwrap()
            .is_none()
    );
    assert!(reopened.is_ready().await);
}

#[tokio::test]
async fn issued_candidate_survives_uncertain_load_and_probe_failure() {
    for probe_failure in [false, true] {
        let engine = FakeCaddy::new();
        let (runtime, _, old) = runtime_with_issued_candidate(engine.clone()).await;
        let before = runtime.active_config().await.unwrap();
        if probe_failure {
            engine
                .probes
                .lock()
                .await
                .push_back(Err(EngineError::InvalidResponse));
        } else {
            engine.delay_ms.store(700, Ordering::SeqCst);
        }
        assert_eq!(
            runtime.retry_certificate_candidate(CERT_ID, false).await,
            Err(CertificateError::RuntimeApplyFailed)
        );
        engine.delay_ms.store(0, Ordering::SeqCst);
        assert_eq!(runtime.active_config().await.unwrap(), before);
        assert_eq!(
            runtime
                .certificate(CERT_ID)
                .await
                .unwrap()
                .fingerprint
                .as_deref(),
            Some(old.as_str())
        );
        let applied = runtime
            .retry_certificate_candidate(CERT_ID, false)
            .await
            .unwrap()
            .unwrap();
        assert_ne!(applied.fingerprint.as_deref(), Some(old.as_str()));
        assert!(runtime.is_ready().await);
    }
}

#[tokio::test]
async fn candidate_metadata_commit_failure_restores_traffic_and_retains_material() {
    let engine = FakeCaddy::new();
    let (runtime, settings, old) = runtime_with_issued_candidate(engine.clone()).await;
    let before = runtime.active_config().await.unwrap();
    let index = settings
        .state_dir
        .join("certificates/certificate-metadata.json");
    *engine.block_certificate_index.lock().await = Some(index.clone());
    assert_eq!(
        runtime.retry_certificate_candidate(CERT_ID, false).await,
        Err(CertificateError::RuntimeApplyFailed)
    );
    assert_eq!(runtime.active_config().await.unwrap(), before);
    assert_eq!(*engine.configuration.lock().await, before.0);
    assert_eq!(
        runtime
            .certificate(CERT_ID)
            .await
            .unwrap()
            .fingerprint
            .as_deref(),
        Some(old.as_str())
    );
    std::fs::remove_dir(&index).unwrap();
    std::fs::rename(index.with_extension("saved"), &index).unwrap();
    runtime.shutdown().await;
    let reopened = ProxyRuntime::new(settings, Some(engine));
    reopened.initialize().await;
    let applied = reopened
        .retry_certificate_candidate(CERT_ID, false)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(applied.fingerprint.as_deref(), Some(old.as_str()));
    assert!(reopened.is_ready().await);
}

#[tokio::test]
async fn candidate_activation_uses_latest_host_configuration_and_serializes_delete() {
    let engine = FakeCaddy::new();
    let (runtime, _, old) = runtime_with_issued_candidate(engine.clone()).await;
    let mut updated = host(HOST_ID, &["example.com"], "http", "new-backend", 4_001);
    updated.certificate_id = Some(CERT_ID.to_owned());
    updated.force_https = true;
    let updated = validate_proxy_config(request(vec![updated])).unwrap();
    runtime.apply(updated.clone()).await.unwrap();
    engine.delay_ms.store(50, Ordering::SeqCst);
    let pending = {
        let runtime = Arc::clone(&runtime);
        tokio::spawn(async move { runtime.retry_certificate_candidate(CERT_ID, false).await })
    };
    tokio::task::yield_now().await;
    assert_eq!(
        runtime.delete_certificate(CERT_ID).await,
        Err(CertificateError::InUse)
    );
    let applied = pending.await.unwrap().unwrap().unwrap();
    assert_ne!(applied.fingerprint.as_deref(), Some(old.as_str()));
    let (json, revision) = runtime.active_config().await.unwrap();
    assert_eq!(revision, Some(updated.revision));
    assert!(json.contains("new-backend:4001"));
}

#[tokio::test]
async fn candidate_retry_after_host_unbinding_does_not_restore_obsolete_routes() {
    let engine = FakeCaddy::new();
    let (runtime, _, old) = runtime_with_issued_candidate(engine.clone()).await;
    runtime.apply(configuration(4_002)).await.unwrap();
    let current = runtime.active_config().await.unwrap();
    let loads = engine.load_count.load(Ordering::SeqCst);
    let applied = runtime
        .retry_certificate_candidate(CERT_ID, false)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(applied.fingerprint.as_deref(), Some(old.as_str()));
    assert_eq!(runtime.active_config().await.unwrap(), current);
    assert_eq!(engine.load_count.load(Ordering::SeqCst), loads);
    assert!(!current.0.contains("/certificates/"));
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
