use super::*;
use crate::{models::SecretString, runtime::RuntimeSettings};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use std::{fs, path::PathBuf, time::Duration};

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let mut nonce = [0; 16];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!(
            "rentnerproxy-crowdsec-config-{:x}",
            u128::from_le_bytes(nonce)
        ));
        fs::create_dir_all(&root).unwrap();
        Self {
            runtime: ProxyRuntime::new(RuntimeSettings::new(root.clone(), 18080), None),
            root,
        }
    }
    fn snapshot(&self) -> PathBuf {
        self.root.join(ACTIVE_CROWDSEC_CONFIGURATION_FILE)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn request(mode: CrowdSecMode) -> CrowdSecConfigRequest {
    CrowdSecConfigRequest {
        mode,
        api_url: None,
        api_key: None,
        community_enabled: false,
    }
}

#[test]
fn snapshots_round_trip_modes_without_persisting_bouncer_credentials() {
    let fixture = Fixture::new();
    for desired in [
        DesiredProvider::Disabled,
        DesiredProvider::Managed {
            community_enabled: false,
        },
        DesiredProvider::Managed {
            community_enabled: true,
        },
        DesiredProvider::External {
            api_url: "https://crowdsec.example.test/lapi/".into(),
        },
    ] {
        fixture
            .runtime
            .persist_crowdsec_configuration(&desired)
            .unwrap();
        assert_eq!(
            fixture.runtime.restore_crowdsec_configuration(),
            Some(desired)
        );
        let body = fs::read_to_string(fixture.snapshot()).unwrap();
        assert!(!body.contains("apiKey"));
        assert!(!body.contains("bouncer"));
    }
}

#[test]
fn restoration_rejects_unknown_schema_oversized_and_inconsistent_snapshots() {
    let fixture = Fixture::new();
    assert_eq!(fixture.runtime.restore_crowdsec_configuration(), None);
    for body in [
        "not-json",
        r#"{"version":2,"mode":"disabled"}"#,
        r#"{"version":1,"mode":"disabled","apiKey":"secret"}"#,
        r#"{"version":1,"mode":"disabled","apiUrl":"https://example.test/"}"#,
        r#"{"version":1,"mode":"disabled","communityEnabled":true}"#,
        r#"{"version":1,"mode":"managed","apiUrl":"https://example.test/"}"#,
        r#"{"version":1,"mode":"external"}"#,
        r#"{"version":1,"mode":"external","apiUrl":"https://example.test/","communityEnabled":true}"#,
        r#"{"version":1,"mode":"external","apiUrl":"https://user:password@example.test/"}"#,
        r#"{"version":1,"mode":"external","apiUrl":"http://192.0.2.1/"}"#,
        r#"{"version":1,"mode":"external","apiUrl":"http://crowdsec.example.test/"}"#,
    ] {
        fs::write(fixture.snapshot(), body).unwrap();
        assert_eq!(
            fixture.runtime.restore_crowdsec_configuration(),
            None,
            "accepted {body}"
        );
    }
    fs::write(fixture.snapshot(), vec![b' '; 4097]).unwrap();
    assert_eq!(fixture.runtime.restore_crowdsec_configuration(), None);
    fs::write(
        fixture.snapshot(),
        r#"{"version":1,"mode":"external","apiUrl":"https://example.test/lapi"}"#,
    )
    .unwrap();
    assert_eq!(
        fixture.runtime.restore_crowdsec_configuration(),
        Some(DesiredProvider::External {
            api_url: "https://example.test/lapi/".into()
        })
    );
}

#[tokio::test]
async fn configuration_rejects_shutdown_uninitialized_and_busy_runtime() {
    let mut fixture = Fixture::new();
    assert_eq!(
        fixture
            .runtime
            .apply_crowdsec(request(CrowdSecMode::Disabled))
            .await
            .unwrap_err(),
        CrowdSecError::RuntimeUnavailable
    );
    fixture.runtime.state.lock().await.initialized = true;
    fixture.runtime.stopping.store(true, Ordering::SeqCst);
    assert_eq!(
        fixture
            .runtime
            .apply_crowdsec(request(CrowdSecMode::Disabled))
            .await
            .unwrap_err(),
        CrowdSecError::RuntimeUnavailable
    );
    fixture.runtime.stopping.store(false, Ordering::SeqCst);
    Arc::get_mut(&mut fixture.runtime)
        .unwrap()
        .settings
        .lock_wait = Duration::ZERO;
    let _guard = fixture.runtime.apply_lock.lock().await;
    assert_eq!(
        fixture
            .runtime
            .apply_crowdsec(request(CrowdSecMode::Disabled))
            .await
            .unwrap_err(),
        CrowdSecError::Busy
    );
    assert!(!fixture.snapshot().exists());
}

#[tokio::test]
async fn disabled_configuration_is_idempotent_and_connection_test_requires_external() {
    let fixture = Fixture::new();
    fixture.runtime.state.lock().await.initialized = true;
    let status = fixture
        .runtime
        .apply_crowdsec(request(CrowdSecMode::Disabled))
        .await
        .unwrap();
    assert_eq!(status.mode, CrowdSecMode::Disabled);
    assert!(!status.enforcement_active);
    assert!(!fixture.snapshot().exists());
    for mode in [
        CrowdSecMode::Disabled,
        CrowdSecMode::Managed,
        CrowdSecMode::External,
    ] {
        assert_eq!(
            fixture
                .runtime
                .test_crowdsec_connection(request(mode))
                .await,
            Err(CrowdSecError::InvalidConfiguration)
        );
    }
}

#[tokio::test]
async fn switching_without_engine_rolls_back_and_preserves_active_provider() {
    let fixture = Fixture::new();
    fixture.runtime.state.lock().await.initialized = true;
    fixture.runtime.crowdsec.lock().await.active = ActiveProvider::External {
        api_url: "https://example.test/".into(),
        api_key: SecretString::new("test-bouncer-key-1234".into()),
    };
    assert_eq!(
        fixture
            .runtime
            .apply_crowdsec(request(CrowdSecMode::Disabled))
            .await
            .unwrap_err(),
        CrowdSecError::RuntimeUnavailable
    );
    assert!(matches!(
        fixture.runtime.active_crowdsec_provider().await,
        ActiveProvider::External { .. }
    ));
    assert!(!fixture.snapshot().exists());
}

#[tokio::test]
async fn initialization_restores_preferences_without_activating_external_credentials() {
    let fixture = Fixture::new();
    let desired = DesiredProvider::External {
        api_url: "https://example.test/".into(),
    };
    fixture
        .runtime
        .persist_crowdsec_configuration(&desired)
        .unwrap();
    fixture.runtime.initialize_crowdsec_locked().await;
    let state = fixture.runtime.crowdsec.lock().await;
    assert_eq!(state.desired, desired);
    assert_eq!(state.active, ActiveProvider::Disabled);
}

#[test]
fn provider_requests_reject_cross_mode_fields_and_require_external_credentials() {
    let fixture = Fixture::new();
    for mode in [CrowdSecMode::Disabled, CrowdSecMode::Managed] {
        let mut invalid = request(mode);
        invalid.api_url = Some("https://example.test/".into());
        assert_eq!(
            fixture.runtime.validate_request(invalid),
            Err(CrowdSecError::InvalidConfiguration)
        );
        let mut invalid = request(mode);
        invalid.api_key = Some(SecretString::new("test-bouncer-key-1234".into()));
        assert_eq!(
            fixture.runtime.validate_request(invalid),
            Err(CrowdSecError::InvalidConfiguration)
        );
    }
    let mut invalid = request(CrowdSecMode::Disabled);
    invalid.community_enabled = true;
    assert_eq!(
        fixture.runtime.validate_request(invalid),
        Err(CrowdSecError::InvalidConfiguration)
    );
    for (url, key, community) in [
        (None, None, false),
        (Some("https://example.test/"), None, false),
        (Some("https://example.test/"), Some("short"), false),
        (
            Some("https://example.test/"),
            Some("test-bouncer-key-1234"),
            true,
        ),
    ] {
        let mut invalid = request(CrowdSecMode::External);
        invalid.api_url = url.map(str::to_owned);
        invalid.api_key = key.map(|value| SecretString::new(value.into()));
        invalid.community_enabled = community;
        assert_eq!(
            fixture.runtime.validate_request(invalid),
            Err(CrowdSecError::InvalidConfiguration)
        );
    }
}

#[test]
fn snapshot_write_failure_is_reported_without_changing_active_provider() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.snapshot()).unwrap();
    assert_eq!(
        fixture
            .runtime
            .persist_crowdsec_configuration(&DesiredProvider::Disabled),
        Err(CrowdSecError::ApplyFailed)
    );
    assert!(fixture.snapshot().is_dir());
}

#[tokio::test]
async fn initialization_retains_managed_retry_intent_when_supervisor_is_degraded() {
    let fixture = Fixture::new();
    let desired = DesiredProvider::Managed {
        community_enabled: true,
    };
    fixture
        .runtime
        .persist_crowdsec_configuration(&desired)
        .unwrap();
    fs::create_dir_all(&fixture.runtime.settings.crowdsec_control_dir).unwrap();
    fs::write(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join("status.json"),
        br#"{"state":"degraded","restarts":3}"#,
    )
    .unwrap();
    fixture.runtime.initialize_crowdsec_locked().await;
    let state = fixture.runtime.crowdsec.lock().await;
    assert_eq!(state.desired, desired);
    assert_eq!(state.active, ActiveProvider::Disabled);
    assert_eq!(
        fs::read_to_string(
            fixture
                .runtime
                .settings
                .crowdsec_control_dir
                .join("desired-mode")
        )
        .unwrap(),
        "managed-online\n"
    );
}

#[tokio::test]
async fn invalid_snapshot_initializes_as_disabled() {
    let fixture = Fixture::new();
    fs::write(fixture.snapshot(), b"corrupt-snapshot").unwrap();
    fixture.runtime.initialize_crowdsec_locked().await;
    let state = fixture.runtime.crowdsec.lock().await;
    assert_eq!(state.desired, DesiredProvider::Disabled);
    assert_eq!(state.active, ActiveProvider::Disabled);
}
