//! Explicitly started by the cross-language Beta 2 integration runner. The
//! injected provider/discovery URLs exist only in this test build.
use super::Engine;
use crate::{
    config::Config,
    runtime::{CaddyProcess, ProxyEngine, ProxyRuntime, RuntimeSettings, dns_connections::Store},
    server::{AppState, app_with_state},
};
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{OwnedRwLockWriteGuard, RwLock};

const PAUSE_REQUEST: &str = "ddns-scheduler-pause-request.json";
const PAUSE_ACK: &str = "ddns-scheduler-paused.json";
const PAUSE_ACK_TEMP: &str = "ddns-scheduler-paused.json.tmp";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SchedulerPause {
    nonce: String,
}

fn pause_request(directory: &Path) -> io::Result<Option<String>> {
    let path = directory.join(PAUSE_REQUEST);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid scheduler pause request",
        )
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 256 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(257)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 256 {
        return Err(invalid());
    }
    let request: SchedulerPause = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if request.nonce.len() != 32
        || !request
            .nonce
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(invalid());
    }
    Ok(Some(request.nonce))
}

fn remove_pause_ack(directory: &Path) -> io::Result<()> {
    for name in [PAUSE_ACK, PAUSE_ACK_TEMP] {
        match std::fs::remove_file(directory.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn acknowledge_pause(directory: &Path, nonce: &str) -> io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(directory.join(PAUSE_ACK_TEMP))?;
    file.write_all(&serde_json::to_vec(&SchedulerPause {
        nonce: nonce.to_owned(),
    })?)?;
    drop(file);
    std::fs::rename(directory.join(PAUSE_ACK_TEMP), directory.join(PAUSE_ACK))
}

async fn acquire_pause(
    directory: &Path,
    gate: &Arc<RwLock<()>>,
    nonce: &str,
) -> io::Result<Option<OwnedRwLockWriteGuard<()>>> {
    let acquire = Arc::clone(gate).write_owned();
    tokio::pin!(acquire);
    loop {
        if directory.join("stop").exists() || pause_request(directory)?.as_deref() != Some(nonce) {
            return Ok(None);
        }
        tokio::select! {
            lease = &mut acquire => return Ok(Some(lease)),
            _ = tokio::time::sleep(Duration::from_millis(50)) => {},
        }
    }
}

struct FixturePauseLease<'a> {
    runtime: &'a ProxyRuntime,
    held: Option<OwnedRwLockWriteGuard<()>>,
}

impl Drop for FixturePauseLease<'_> {
    fn drop(&mut self) {
        self.runtime.begin_shutdown();
        drop(self.held.take());
    }
}

async fn wait_for_fixture_stop(
    directory: &Path,
    gate: Arc<RwLock<()>>,
    runtime: &ProxyRuntime,
) -> io::Result<()> {
    let mut lease = FixturePauseLease {
        runtime,
        held: None,
    };
    let mut held_nonce = None;
    let result = async {
        while !directory.join("stop").exists() {
            let request = pause_request(directory)?;
            if request != held_nonce {
                drop(lease.held.take());
                held_nonce = None;
                remove_pause_ack(directory)?;
                if let Some(nonce) = request {
                    lease.held = acquire_pause(directory, &gate, &nonce).await?;
                    if lease.held.is_some()
                        && !directory.join("stop").exists()
                        && pause_request(directory)?.as_deref() == Some(nonce.as_str())
                    {
                        acknowledge_pause(directory, &nonce)?;
                        held_nonce = Some(nonce);
                    } else {
                        drop(lease.held.take());
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok(())
    }
    .await;
    drop(lease);
    let cleanup = remove_pause_ack(directory);
    result.and(cleanup)
}

fn pause_test_directory() -> PathBuf {
    let mut nonce = [0; 16];
    aws_lc_rs::rand::fill(&mut nonce).unwrap();
    let name: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let directory = std::env::temp_dir().join(format!("rentnerproxy-beta2-pause-{name}"));
    std::fs::create_dir(&directory).unwrap();
    directory
}

#[test]
fn scheduler_pause_requests_require_strict_bounded_nonce_objects() {
    let directory = pause_test_directory();
    assert_eq!(pause_request(&directory).unwrap(), None);
    let nonce = "a".repeat(32);
    std::fs::write(
        directory.join(PAUSE_REQUEST),
        format!(r#"{{"nonce":"{nonce}"}}"#),
    )
    .unwrap();
    assert_eq!(pause_request(&directory).unwrap(), Some(nonce.clone()));
    for invalid in [
        "{}".to_owned(),
        format!(r#"{{"nonce":"{nonce}","other":true}}"#),
        format!(r#"{{"nonce":"{nonce}","nonce":"{nonce}"}}"#),
        format!(r#"{{"nonce":"{}"}}"#, "A".repeat(32)),
        format!(r#"{{"nonce":"{}"}}"#, "a".repeat(31)),
        " ".repeat(257),
    ] {
        std::fs::write(directory.join(PAUSE_REQUEST), invalid).unwrap();
        assert_eq!(
            pause_request(&directory).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
    std::fs::remove_file(directory.join(PAUSE_REQUEST)).unwrap();
    std::fs::create_dir(directory.join(PAUSE_REQUEST)).unwrap();
    assert_eq!(
        pause_request(&directory).unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
    std::fs::remove_dir_all(directory).unwrap();
}

async fn drive_until(
    driver: &mut (impl std::future::Future<Output = io::Result<()>> + Unpin),
    condition: impl Fn() -> bool,
) {
    tokio::time::timeout(Duration::from_secs(3), async {
        tokio::select! {
            result = driver => panic!("fixture driver ended before the condition: {result:?}"),
            _ = async {
                while !condition() {
                    tokio::task::yield_now().await;
                }
            } => {},
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn scheduler_pause_ack_is_atomic_lease_bound_and_released_on_request_removal_or_stop() {
    use std::{
        future::{Future, poll_fn},
        task::Poll,
    };

    let directory = pause_test_directory();
    let runtime = ProxyRuntime::new(
        RuntimeSettings::new(directory.join("controller"), 8080),
        None,
    );
    let gate = Arc::new(RwLock::new(()));
    let tick = Arc::clone(&gate).read_owned().await;
    let nonce = "a".repeat(32);
    std::fs::write(
        directory.join(PAUSE_REQUEST),
        format!(r#"{{"nonce":"{nonce}"}}"#),
    )
    .unwrap();
    let mut driver = Box::pin(wait_for_fixture_stop(
        &directory,
        Arc::clone(&gate),
        &runtime,
    ));
    assert!(poll_fn(|context| Poll::Ready(driver.as_mut().poll(context).is_pending())).await);
    assert!(!directory.join(PAUSE_ACK).exists());
    drop(tick);
    drive_until(&mut driver, || directory.join(PAUSE_ACK).exists()).await;
    let ack: SchedulerPause =
        serde_json::from_slice(&std::fs::read(directory.join(PAUSE_ACK)).unwrap()).unwrap();
    assert_eq!(ack.nonce, nonce);
    assert!(gate.try_read().is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(directory.join(PAUSE_ACK))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    std::fs::remove_file(directory.join(PAUSE_REQUEST)).unwrap();
    drive_until(&mut driver, || !directory.join(PAUSE_ACK).exists()).await;
    assert!(gate.try_read().is_ok());
    let nonce = "b".repeat(32);
    std::fs::write(
        directory.join(PAUSE_REQUEST),
        format!(r#"{{"nonce":"{nonce}"}}"#),
    )
    .unwrap();
    drive_until(&mut driver, || directory.join(PAUSE_ACK).exists()).await;
    let ack: SchedulerPause =
        serde_json::from_slice(&std::fs::read(directory.join(PAUSE_ACK)).unwrap()).unwrap();
    assert_eq!(ack.nonce, nonce);
    std::fs::write(directory.join("stop"), "").unwrap();
    tokio::time::timeout(Duration::from_secs(3), driver)
        .await
        .unwrap()
        .unwrap();
    assert!(gate.try_read().is_ok());
    assert!(!directory.join(PAUSE_ACK).exists());
    assert!(runtime.stopping.load(std::sync::atomic::Ordering::SeqCst));
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn scheduler_pause_does_not_ack_a_request_withdrawn_while_the_tick_is_running() {
    use std::{
        future::{Future, poll_fn},
        task::Poll,
    };

    let directory = pause_test_directory();
    let runtime = ProxyRuntime::new(
        RuntimeSettings::new(directory.join("controller"), 8080),
        None,
    );
    let gate = Arc::new(RwLock::new(()));
    let tick = Arc::clone(&gate).read_owned().await;
    std::fs::write(
        directory.join(PAUSE_REQUEST),
        format!(r#"{{"nonce":"{}"}}"#, "a".repeat(32)),
    )
    .unwrap();
    let mut driver = Box::pin(wait_for_fixture_stop(
        &directory,
        Arc::clone(&gate),
        &runtime,
    ));
    assert!(poll_fn(|context| Poll::Ready(driver.as_mut().poll(context).is_pending())).await);
    std::fs::remove_file(directory.join(PAUSE_REQUEST)).unwrap();
    drop(tick);
    assert!(poll_fn(|context| Poll::Ready(driver.as_mut().poll(context).is_pending())).await);
    assert!(!directory.join(PAUSE_ACK).exists());
    assert!(gate.try_write().is_ok());
    std::fs::write(directory.join("stop"), "").unwrap();
    tokio::time::timeout(Duration::from_secs(3), driver)
        .await
        .unwrap()
        .unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn scheduler_pause_acquisition_cancels_cooperatively_when_the_fixture_stops() {
    use std::{
        future::{Future, poll_fn},
        task::Poll,
    };

    let directory = pause_test_directory();
    let runtime = ProxyRuntime::new(
        RuntimeSettings::new(directory.join("controller"), 8080),
        None,
    );
    let gate = Arc::new(RwLock::new(()));
    let tick = Arc::clone(&gate).read_owned().await;
    std::fs::write(
        directory.join(PAUSE_REQUEST),
        format!(r#"{{"nonce":"{}"}}"#, "a".repeat(32)),
    )
    .unwrap();
    let mut driver = Box::pin(wait_for_fixture_stop(
        &directory,
        Arc::clone(&gate),
        &runtime,
    ));
    assert!(poll_fn(|context| Poll::Ready(driver.as_mut().poll(context).is_pending())).await);
    std::fs::write(directory.join("stop"), "").unwrap();
    tokio::time::timeout(Duration::from_secs(3), driver)
        .await
        .unwrap()
        .unwrap();
    assert!(!directory.join(PAUSE_ACK).exists());
    assert!(runtime.stopping.load(std::sync::atomic::Ordering::SeqCst));
    drop(tick);
    assert!(gate.try_write().is_ok());
    std::fs::remove_dir_all(directory).unwrap();
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureConfiguration {
    run_id: String,
    controller_token: String,
    directory: PathBuf,
    provider_url: String,
    ipv4_url: String,
    ipv6_url: String,
    http_port: u16,
    https_port: u16,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "started by .github/scripts/ci/beta2/run.ts with isolated PostgreSQL/Valkey and Caddy"]
async fn beta2_integration_controller() {
    let configuration_path = PathBuf::from(
        std::env::var_os("RENTNERPROXY_BETA2_FIXTURE").expect("explicit fixture configuration"),
    );
    let configuration: FixtureConfiguration =
        serde_json::from_slice(&std::fs::read(configuration_path).unwrap()).unwrap();
    assert!(configuration.run_id.len() == 32);
    assert!(configuration.controller_token.len() == 64);
    assert!(
        configuration
            .controller_token
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    );
    assert_ne!(configuration.controller_token, configuration.run_id);
    assert!(
        configuration
            .run_id
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    );
    // The Linux launcher owns /tmp independently of the caller's TMPDIR.
    assert_eq!(
        configuration.directory.parent(),
        Some(std::path::Path::new("/tmp"))
    );
    assert_eq!(
        configuration
            .directory
            .file_name()
            .unwrap()
            .to_str()
            .unwrap(),
        format!("rentnerproxy-beta2-{}", configuration.run_id)
    );
    for endpoint in [
        &configuration.provider_url,
        &configuration.ipv4_url,
        &configuration.ipv6_url,
    ] {
        let endpoint = reqwest::Url::parse(endpoint).unwrap();
        assert_eq!(endpoint.scheme(), "http");
        assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
    }
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("explicit Caddy fixture binary"),
    )
    .canonicalize()
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let state = configuration.directory.join("controller");
    remove_pause_ack(&configuration.directory).unwrap();
    match std::fs::remove_file(configuration.directory.join(PAUSE_REQUEST)) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => panic!("stale scheduler request cleanup failed: {error}"),
    }
    let mut settings = RuntimeSettings::new(state.clone(), configuration.http_port);
    settings.https_port = configuration.https_port;
    settings.controller_addr = address;
    let engine: Arc<dyn ProxyEngine> = Arc::new(CaddyProcess::new(binary, state.clone()));
    let mut runtime = ProxyRuntime::new(settings, Some(engine));
    let owner = Arc::get_mut(&mut runtime).unwrap();
    owner.dns_connections = Store::fixture(state, configuration.provider_url);
    owner.ddns = Engine {
        discovery_urls: Some([configuration.ipv4_url, configuration.ipv6_url]),
        ..Engine::new()
    };
    runtime.initialize().await;
    runtime.start_recovery_worker().await;
    let scheduler_gate = Arc::new(RwLock::new(()));
    runtime
        .start_ddns_scheduler_with_gate(Arc::clone(&scheduler_gate))
        .await;
    runtime.docker_discovery.start().await;
    let token = Config::from_values(
        None,
        Some(&configuration.controller_token),
        None,
        None,
        None,
        false,
    )
    .unwrap()
    .controller_token
    .unwrap();
    let app = app_with_state(AppState::new(runtime.clone(), Some(token)));
    let (stop, stopping) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopping.await;
            })
            .await
            .unwrap();
    });
    std::fs::write(
        configuration.directory.join("ready.json"),
        serde_json::to_vec(&serde_json::json!({"url":format!("http://{address}")})).unwrap(),
    )
    .unwrap();
    let completed = tokio::time::timeout(
        Duration::from_secs(600),
        wait_for_fixture_stop(&configuration.directory, scheduler_gate, &runtime),
    )
    .await;
    remove_pause_ack(&configuration.directory).unwrap();
    runtime.begin_shutdown();
    let _ = stop.send(());
    runtime.shutdown().await;
    tokio::time::timeout(Duration::from_secs(10), server)
        .await
        .unwrap()
        .unwrap();
    assert!(
        completed.is_ok(),
        "integration runner exceeded its fixture lifetime"
    );
    completed
        .unwrap()
        .expect("scheduler pause handshake failed");
}
