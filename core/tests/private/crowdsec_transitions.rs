use super::*;
use crate::runtime::engine::{EngineError, EngineFuture, ProxyEngine};
use std::{collections::VecDeque, future::Future, pin::Pin, sync::Mutex};

#[derive(Default)]
struct TransitionEngine {
    starts: Mutex<Vec<String>>,
    results: Mutex<VecDeque<Result<(), EngineError>>>,
}

impl ProxyEngine for TransitionEngine {
    fn start<'a>(&'a self, json: &'a str, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            self.starts.lock().unwrap().push(json.to_owned());
            self.results.lock().unwrap().pop_front().unwrap_or(Ok(()))
        })
    }
    fn load<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { panic!("provider transitions must restart the engine") })
    }
    fn probe<'a>(&'a self, _: &'a str) -> EngineFuture<'a> {
        Box::pin(async { Ok(()) })
    }
    fn shutdown(&self) -> EngineFuture<'_> {
        Box::pin(async { Ok(()) })
    }
    fn is_running(&self) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async { true })
    }
}

async fn enabled_fixture() -> (Fixture, Arc<TransitionEngine>) {
    let mut fixture = Fixture::new();
    let engine = Arc::new(TransitionEngine::default());
    Arc::get_mut(&mut fixture.runtime).unwrap().engine = Some(engine.clone());
    {
        let mut state = fixture.runtime.state.lock().await;
        state.initialized = true;
        state.active_json = "previous-configuration".into();
        state.engine_available = true;
    }
    {
        let mut state = fixture.runtime.crowdsec.lock().await;
        state.desired = DesiredProvider::Managed {
            community_enabled: true,
        };
        state.active = ActiveProvider::Managed {
            api_key: SecretString::new("synthetic-bouncer-key".into()),
        };
    }
    fs::create_dir_all(&fixture.runtime.settings.crowdsec_control_dir).unwrap();
    fs::write(
        fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join("status.json"),
        br#"{"state":"stopped","restarts":0}"#,
    )
    .unwrap();
    (fixture, engine)
}

#[tokio::test]
async fn disabling_provider_commits_rendered_engine_state_and_stops_managed_supervisor() {
    let (fixture, engine) = enabled_fixture().await;
    let status = fixture
        .runtime
        .apply_crowdsec(request(CrowdSecMode::Disabled))
        .await
        .unwrap();
    assert_eq!(status.mode, CrowdSecMode::Disabled);
    assert!(!status.enforcement_active);
    assert_eq!(
        fixture.runtime.restore_crowdsec_configuration(),
        Some(DesiredProvider::Disabled)
    );
    let starts = engine.starts.lock().unwrap().clone();
    assert_eq!(starts.len(), 1);
    let json: serde_json::Value = serde_json::from_str(&starts[0]).unwrap();
    assert!(!json.to_string().contains("synthetic-bouncer-key"));
    let state = fixture.runtime.state.lock().await;
    assert_eq!(state.active_json, starts[0]);
    assert!(state.engine_available);
    assert_eq!(
        fs::read_to_string(
            fixture
                .runtime
                .settings
                .crowdsec_control_dir
                .join("desired-mode")
        )
        .unwrap(),
        "stopped\n"
    );
}

#[tokio::test]
async fn failed_provider_restart_restores_previous_configuration_and_reports_availability() {
    for rollback in [Ok(()), Err(EngineError::Unavailable)] {
        let (fixture, engine) = enabled_fixture().await;
        engine
            .results
            .lock()
            .unwrap()
            .extend([Err(EngineError::Rejected), rollback]);
        assert_eq!(
            fixture
                .runtime
                .apply_crowdsec(request(CrowdSecMode::Disabled))
                .await
                .unwrap_err(),
            CrowdSecError::ApplyFailed
        );
        let starts = engine.starts.lock().unwrap().clone();
        assert_eq!(starts.len(), 2);
        assert_eq!(starts[1], "previous-configuration");
        assert_eq!(
            fixture.runtime.state.lock().await.engine_available,
            rollback.is_ok()
        );
        assert!(matches!(
            fixture.runtime.active_crowdsec_provider().await,
            ActiveProvider::Managed { .. }
        ));
        assert!(!fixture.snapshot().exists());
    }
}

#[tokio::test]
async fn failed_provider_snapshot_restores_engine_and_retains_previous_provider() {
    let (fixture, engine) = enabled_fixture().await;
    fs::create_dir(fixture.snapshot()).unwrap();
    assert_eq!(
        fixture
            .runtime
            .apply_crowdsec(request(CrowdSecMode::Disabled))
            .await
            .unwrap_err(),
        CrowdSecError::ApplyFailed
    );
    let starts = engine.starts.lock().unwrap().clone();
    assert_eq!(starts.len(), 2);
    assert_eq!(starts[1], "previous-configuration");
    assert!(fixture.runtime.state.lock().await.engine_available);
    assert!(matches!(
        fixture.runtime.active_crowdsec_provider().await,
        ActiveProvider::Managed { .. }
    ));
    assert!(
        !fixture
            .runtime
            .settings
            .crowdsec_control_dir
            .join("desired-mode")
            .exists()
    );
}
