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
    models::{ApplyOutcome, ProxyConfigRequest, ProxyHost, ValidatedProxyConfig},
    proxy::{revision_for_hosts, validate_proxy_config},
    runtime::{
        EngineError, EngineFuture, ProxyEngine, ProxyRuntime, RuntimeError, RuntimeSettings,
        clock::{civil_from_days, utc_now},
        renderer::{RenderSettings, render_config},
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
            if call > 0 {
                if let Some(delay) = self.second_test_delay {
                    tokio::time::sleep(delay).await;
                }
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
    let hosts = vec![ProxyHost {
        id: "00000000-0000-0000-0000-000000000000".to_owned(),
        domains: vec!["demo.test".to_owned()],
        forward_scheme: "http".to_owned(),
        forward_host: "backend".to_owned(),
        forward_port: port,
    }];
    validate_proxy_config(ProxyConfigRequest {
        version: 1,
        revision: revision_for_hosts(&hosts),
        proxy_hosts: hosts,
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
