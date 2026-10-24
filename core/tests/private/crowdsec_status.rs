use super::*;
use crate::{models::SecretString, runtime::RuntimeSettings};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use std::{fs, path::PathBuf, sync::Arc};

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let mut nonce = [0; 16];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root = std::env::temp_dir().join(format!(
            "rentnerproxy-crowdsec-status-{:x}",
            u128::from_le_bytes(nonce)
        ));
        let runtime = ProxyRuntime::new(RuntimeSettings::new(root.clone(), 18080), None);
        fs::create_dir_all(&runtime.settings.crowdsec_control_dir).unwrap();
        Self { runtime, root }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn missing_supervisor_reports_safe_defaults_and_disabled_enforcement() {
    let fixture = Fixture::new();
    let status = fixture.runtime.crowdsec_status().await;
    assert_eq!(status.mode, crate::models::CrowdSecMode::Disabled);
    assert_eq!(status.state, CrowdSecHealth::Disabled);
    assert_eq!(
        status.managed_engine,
        CrowdSecManagedEngineState::Unavailable
    );
    assert_eq!(status.community_state, CrowdSecCommunityState::Disabled);
    assert_eq!(status.console_state, CrowdSecConsoleState::NotEnrolled);
    assert!(!status.enforcement_active);
    assert!(!status.credential_configured);
    assert_eq!(status.failure_behavior, "fail_open");
    assert_eq!(status.client_ip_source, "caddy");
}

#[tokio::test]
async fn managed_supervisor_states_and_online_metadata_are_reported_without_active_provider() {
    let fixture = Fixture::new();
    fixture.runtime.crowdsec.lock().await.desired = DesiredProvider::Managed {
        community_enabled: true,
    };
    for (state, expected_engine, expected_health) in [
        (
            "stopped",
            CrowdSecManagedEngineState::Stopped,
            CrowdSecHealth::Degraded,
        ),
        (
            "starting",
            CrowdSecManagedEngineState::Starting,
            CrowdSecHealth::Starting,
        ),
        (
            "ready",
            CrowdSecManagedEngineState::Ready,
            CrowdSecHealth::Degraded,
        ),
        (
            "restarting",
            CrowdSecManagedEngineState::Restarting,
            CrowdSecHealth::Starting,
        ),
        (
            "degraded",
            CrowdSecManagedEngineState::Degraded,
            CrowdSecHealth::Degraded,
        ),
    ] {
        fs::write(fixture.runtime.settings.crowdsec_control_dir.join("status.json"), serde_json::to_vec(&serde_json::json!({"state":state,"restarts":2,"community":"degraded","console":"pending"})).unwrap()).unwrap();
        let status = fixture.runtime.crowdsec_status().await;
        assert_eq!(status.managed_engine, expected_engine);
        assert_eq!(status.state, expected_health);
        assert_eq!(status.community_state, CrowdSecCommunityState::Degraded);
        assert_eq!(status.console_state, CrowdSecConsoleState::Pending);
        assert!(status.community_enabled);
        assert!(!status.enforcement_active);
        assert!(!status.credential_configured);
    }
}

#[tokio::test]
async fn external_url_mismatch_is_degraded_while_active_enforcement_is_visible() {
    let fixture = Fixture::new();
    {
        let mut state = fixture.runtime.crowdsec.lock().await;
        state.desired = DesiredProvider::External {
            api_url: "https://desired.example.test/".into(),
        };
        state.active = ActiveProvider::External {
            api_url: "https://previous.example.test/".into(),
            api_key: SecretString::new("test-bouncer-key-1234".into()),
        };
    }
    let status = fixture.runtime.crowdsec_status().await;
    assert_eq!(status.state, CrowdSecHealth::Degraded);
    assert_eq!(
        status.api_url.as_deref(),
        Some("https://desired.example.test/")
    );
    assert!(status.credential_configured);
    assert!(status.enforcement_active);
    assert!(!status.community_enabled);
    fixture.runtime.crowdsec.lock().await.active = ActiveProvider::Disabled;
    let status = fixture.runtime.crowdsec_status().await;
    assert_eq!(status.state, CrowdSecHealth::Degraded);
    assert!(!status.credential_configured);
    assert!(!status.enforcement_active);
}
