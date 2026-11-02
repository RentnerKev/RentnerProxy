use super::*;
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};

struct Fixture {
    runtime: Arc<ProxyRuntime>,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let mut nonce = [0; 16];
        SystemRandom::new().fill(&mut nonce).unwrap();
        let root =
            std::env::temp_dir().join(format!("rp-supervisor-{:x}", u128::from_le_bytes(nonce)));
        let mut settings = crate::runtime::RuntimeSettings::new(root.clone(), 0);
        settings.stage_timeout = Duration::ZERO;
        settings.crowdsec_start_timeout = Duration::ZERO;
        let runtime = ProxyRuntime::new(settings, None);
        fs::create_dir_all(&runtime.settings.crowdsec_control_dir).unwrap();
        fs::create_dir_all(runtime.settings.crowdsec_state_dir.join("bouncer")).unwrap();
        Self { runtime, root }
    }
    fn key_path(&self) -> PathBuf {
        self.runtime
            .settings
            .crowdsec_state_dir
            .join(BOUNCER_KEY_PATH)
    }
    fn status_path(&self) -> PathBuf {
        self.runtime
            .settings
            .crowdsec_control_dir
            .join(SUPERVISOR_STATUS_FILE)
    }
    fn mode(&self) -> String {
        fs::read_to_string(
            self.runtime
                .settings
                .crowdsec_control_dir
                .join(DESIRED_MODE_FILE),
        )
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn managed_bouncer_key_requires_a_bounded_regular_utf8_token_and_trims_newlines() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.runtime.read_managed_bouncer_key(),
        Err(CrowdSecError::RuntimeUnavailable)
    );
    for invalid in [
        vec![b'x'; MAX_SECRET_BYTES as usize + 1],
        vec![0xff; 20],
        b"short\n".to_vec(),
        b"invalid token with spaces".to_vec(),
    ] {
        fs::write(fixture.key_path(), invalid).unwrap();
        assert_eq!(
            fixture.runtime.read_managed_bouncer_key(),
            Err(CrowdSecError::RuntimeUnavailable)
        );
    }
    fs::write(fixture.key_path(), b"  synthetic-managed-key\n").unwrap();
    assert_eq!(
        fixture.runtime.read_managed_bouncer_key().unwrap().expose(),
        "synthetic-managed-key"
    );
    fs::remove_file(fixture.key_path()).unwrap();
    fs::create_dir(fixture.key_path()).unwrap();
    assert_eq!(
        fixture.runtime.read_managed_bouncer_key(),
        Err(CrowdSecError::RuntimeUnavailable)
    );
}

#[test]
fn supervisor_rejects_oversized_status_and_invalid_modes_without_overwriting_intent() {
    let fixture = Fixture::new();
    fixture
        .runtime
        .set_supervisor_mode("managed-online")
        .unwrap();
    assert_eq!(
        fixture.runtime.set_supervisor_mode("unexpected"),
        Err(CrowdSecError::InvalidConfiguration)
    );
    assert_eq!(fixture.mode(), "managed-online\n");
    fs::write(
        fixture.status_path(),
        vec![b' '; MAX_STATUS_BYTES as usize + 1],
    )
    .unwrap();
    assert!(matches!(
        fixture.runtime.read_supervisor_status(),
        Err(CrowdSecError::RuntimeUnavailable)
    ));
}

#[tokio::test]
async fn managed_start_and_stop_observe_zero_budgets_without_indefinite_waits() {
    let fixture = Fixture::new();
    let desired = DesiredProvider::Managed {
        community_enabled: true,
    };
    assert_eq!(
        fixture.runtime.prepare_managed_provider(&desired).await,
        Err(CrowdSecError::ConnectionFailed)
    );
    assert_eq!(fixture.mode(), "managed-online\n");
    fs::write(
        fixture.status_path(),
        br#"{"state":"starting","restarts":0}"#,
    )
    .unwrap();
    assert_eq!(
        fixture
            .runtime
            .prepare_provider(
                &desired,
                &ActiveProvider::Managed {
                    api_key: SecretString::new(String::new())
                }
            )
            .await,
        Err(CrowdSecError::ConnectionFailed)
    );
    fixture.runtime.stop_managed_best_effort().await;
    assert_eq!(fixture.mode(), "stopped\n");
    fs::write(fixture.status_path(), br#"{"state":"ready","restarts":0}"#).unwrap();
    assert_eq!(
        fixture.runtime.prepare_managed_provider(&desired).await,
        Err(CrowdSecError::RuntimeUnavailable)
    );
}

#[tokio::test]
async fn rollback_restores_managed_preference_or_stops_a_new_managed_provider() {
    let fixture = Fixture::new();
    let managed = ActiveProvider::Managed {
        api_key: SecretString::new("synthetic-managed-key".into()),
    };
    let desired = DesiredProvider::Managed {
        community_enabled: false,
    };
    fixture
        .runtime
        .set_supervisor_mode("managed-online")
        .unwrap();
    fixture
        .runtime
        .rollback_managed_start(&desired, &managed, &managed)
        .await;
    assert_eq!(fixture.mode(), "managed\n");
    fs::write(
        fixture.status_path(),
        br#"{"state":"stopped","restarts":0}"#,
    )
    .unwrap();
    fixture
        .runtime
        .rollback_managed_start(
            &DesiredProvider::Disabled,
            &ActiveProvider::Disabled,
            &managed,
        )
        .await;
    assert_eq!(fixture.mode(), "stopped\n");
    fs::remove_file(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join(DESIRED_MODE_FILE),
    )
    .unwrap();
    fs::create_dir(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join(DESIRED_MODE_FILE),
    )
    .unwrap();
    fixture
        .runtime
        .rollback_managed_start(&desired, &managed, &managed)
        .await;
    fixture.runtime.stop_managed_best_effort().await;
    assert!(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join(DESIRED_MODE_FILE)
            .is_dir()
    );
}
