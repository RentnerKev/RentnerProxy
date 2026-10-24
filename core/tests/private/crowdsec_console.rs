use super::super::{ActiveProvider, DesiredProvider, SUPERVISOR_STATUS_FILE};
use super::*;
use crate::runtime::RuntimeSettings;
use std::{path::PathBuf, sync::Arc};

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    root: PathBuf,
}

impl Fixture {
    async fn managed() -> Self {
        let mut nonce = [0; 16];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!(
            "rentnerproxy-console-{:x}",
            u128::from_le_bytes(nonce)
        ));
        let runtime = ProxyRuntime::new(RuntimeSettings::new(root.clone(), 18080), None);
        fs::create_dir_all(&runtime.settings.crowdsec_control_dir).unwrap();
        {
            let mut state = runtime.crowdsec.lock().await;
            state.desired = DesiredProvider::Managed {
                community_enabled: true,
            };
            state.active = ActiveProvider::Managed {
                api_key: SecretString::new("test-bouncer-key-1234".into()),
            };
        }
        let fixture = Self { runtime, root };
        fixture.status("ready", "connected", "not_enrolled");
        fixture
    }

    fn status(&self, state: &str, community: &str, console: &str) {
        fs::write(self.runtime.settings.crowdsec_control_dir.join(SUPERVISOR_STATUS_FILE),
            serde_json::to_vec(&serde_json::json!({"state":state,"restarts":0,"community":community,"console":console})).unwrap()).unwrap();
    }

    fn request(&self) -> PathBuf {
        self.runtime
            .settings
            .crowdsec_control_dir
            .join(CONSOLE_ENROLLMENT_REQUEST_FILE)
    }

    fn result(&self) -> PathBuf {
        self.runtime
            .settings
            .crowdsec_control_dir
            .join(CONSOLE_ENROLLMENT_RESULT_FILE)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn key() -> SecretString {
    SecretString::new("test-enrollment-key-1234".into())
}

#[tokio::test]
async fn enrollment_rejects_invalid_key_before_touching_control_files() {
    let fixture = Fixture::managed().await;
    assert_eq!(
        fixture
            .runtime
            .enroll_crowdsec_console(&SecretString::new("invalid".into()))
            .await,
        Err(CrowdSecError::InvalidConfiguration)
    );
    assert!(!fixture.request().exists());
}

#[tokio::test]
async fn enrollment_observes_shutdown_and_application_lock() {
    let mut fixture = Fixture::managed().await;
    fixture.runtime.stopping.store(true, Ordering::SeqCst);
    assert_eq!(
        fixture.runtime.enroll_crowdsec_console(&key()).await,
        Err(CrowdSecError::RuntimeUnavailable)
    );
    fixture.runtime.stopping.store(false, Ordering::SeqCst);
    Arc::get_mut(&mut fixture.runtime)
        .unwrap()
        .settings
        .lock_wait = Duration::ZERO;
    let _guard = fixture.runtime.apply_lock.lock().await;
    assert_eq!(
        fixture.runtime.enroll_crowdsec_console(&key()).await,
        Err(CrowdSecError::Busy)
    );
    assert!(!fixture.request().exists());
}

#[tokio::test]
async fn enrollment_requires_online_managed_provider() {
    let fixture = Fixture::managed().await;
    for (desired, active) in [
        (DesiredProvider::Disabled, ActiveProvider::Disabled),
        (
            DesiredProvider::Managed {
                community_enabled: false,
            },
            ActiveProvider::Managed { api_key: key() },
        ),
        (
            DesiredProvider::Managed {
                community_enabled: true,
            },
            ActiveProvider::Disabled,
        ),
    ] {
        {
            let mut state = fixture.runtime.crowdsec.lock().await;
            state.desired = desired;
            state.active = active;
        }
        assert_eq!(
            fixture.runtime.enroll_crowdsec_console(&key()).await,
            Err(CrowdSecError::InvalidConfiguration)
        );
        assert!(!fixture.request().exists());
    }
}

#[tokio::test]
async fn enrollment_requires_ready_connected_and_enrollable_supervisor() {
    let fixture = Fixture::managed().await;
    for (state, community, console) in [
        ("starting", "connected", "not_enrolled"),
        ("ready", "disabled", "not_enrolled"),
        ("ready", "connected", "pending"),
        ("ready", "connected", "connected"),
    ] {
        fixture.status(state, community, console);
        assert_eq!(
            fixture.runtime.enroll_crowdsec_console(&key()).await,
            Err(CrowdSecError::InvalidConfiguration)
        );
        assert!(!fixture.request().exists());
    }
    fs::write(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join(SUPERVISOR_STATUS_FILE),
        b"invalid",
    )
    .unwrap();
    assert_eq!(
        fixture.runtime.enroll_crowdsec_console(&key()).await,
        Err(CrowdSecError::RuntimeUnavailable)
    );
}

#[tokio::test]
async fn enrollment_preserves_existing_request_and_result_when_busy() {
    let fixture = Fixture::managed().await;
    fs::write(fixture.request(), b"existing-request").unwrap();
    fs::write(fixture.result(), b"existing-result").unwrap();
    assert_eq!(
        fixture.runtime.enroll_crowdsec_console(&key()).await,
        Err(CrowdSecError::Busy)
    );
    assert_eq!(fs::read(fixture.request()).unwrap(), b"existing-request");
    assert_eq!(fs::read(fixture.result()).unwrap(), b"existing-result");
}

#[tokio::test]
async fn enrollment_matches_nonce_and_accepts_pending_or_reports_failure() {
    for (console, result_state, expected) in [
        ("not_enrolled", "pending", Ok(())),
        ("degraded", "pending", Ok(())),
        (
            "not_enrolled",
            "failed",
            Err(CrowdSecError::ConnectionFailed),
        ),
    ] {
        let fixture = Fixture::managed().await;
        fixture.status("ready", "connected", console);
        fs::write(fixture.result(), b"stale-invalid-result").unwrap();
        let enrollment_key = key();
        let enrollment = fixture.runtime.enroll_crowdsec_console(&enrollment_key);
        tokio::pin!(enrollment);
        // Poll until the request is published and the enrollment starts waiting.
        tokio::select! { biased; result = &mut enrollment => panic!("premature result: {result:?}"), () = std::future::ready(()) => {} }
        assert!(!fixture.result().exists());
        let request = fs::read_to_string(fixture.request()).unwrap();
        let lines = request.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len(), 32);
        assert!(lines[0].bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(lines[1], enrollment_key.expose());
        fs::write(
            fixture.result(),
            serde_json::to_vec(&serde_json::json!({"id": "unrelated", "state": "pending"}))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            read_enrollment_result(&fixture.result(), lines[0]),
            Ok(None)
        );
        fs::write(
            fixture.result(),
            serde_json::to_vec(&serde_json::json!({"id":lines[0], "state":result_state})).unwrap(),
        )
        .unwrap();
        assert_eq!(
            timeout(Duration::from_secs(2), enrollment).await.unwrap(),
            expected
        );
    }
}

#[tokio::test]
async fn enrollment_rejects_malformed_and_oversized_results() {
    for body in [
        b"invalid".to_vec(),
        br#"{"id":"x","state":"pending","unexpected":true}"#.to_vec(),
        vec![b' '; MAX_STATUS_BYTES as usize + 1],
    ] {
        let fixture = Fixture::managed().await;
        let enrollment_key = key();
        let enrollment = fixture.runtime.enroll_crowdsec_console(&enrollment_key);
        tokio::pin!(enrollment);
        tokio::select! { biased; result = &mut enrollment => panic!("premature result: {result:?}"), () = std::future::ready(()) => {} }
        fs::write(fixture.result(), body).unwrap();
        assert_eq!(
            timeout(Duration::from_secs(2), enrollment).await.unwrap(),
            Err(CrowdSecError::RuntimeUnavailable)
        );
    }
}

#[tokio::test]
async fn enrollment_reports_unwritable_control_paths() {
    let fixture = Fixture::managed().await;
    fs::create_dir(fixture.result()).unwrap();
    assert_eq!(
        fixture.runtime.enroll_crowdsec_console(&key()).await,
        Err(CrowdSecError::RuntimeUnavailable)
    );
    assert!(!fixture.request().exists());
}
