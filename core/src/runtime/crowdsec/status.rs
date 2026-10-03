use super::{ActiveProvider, DesiredProvider, MANAGED_API_URL, ProxyRuntime, SupervisorState};
use crate::models::{
    CrowdSecCommunityState, CrowdSecConsoleState, CrowdSecHealth, CrowdSecManagedEngineState,
    CrowdSecRuntimeStatus,
};

impl ProxyRuntime {
    pub(crate) async fn crowdsec_status(&self) -> CrowdSecRuntimeStatus {
        let (desired, active) = {
            let state = self.crowdsec.lock().await;
            (state.desired.clone(), state.active.clone())
        };
        let supervisor = self.read_supervisor_status().ok();
        let managed_engine = supervisor.map_or(CrowdSecManagedEngineState::Unavailable, |status| {
            let _ = status.restarts;
            status.state.public()
        });
        let state = match &desired {
            DesiredProvider::Disabled => CrowdSecHealth::Disabled,
            DesiredProvider::Managed { .. } => {
                match (&active, supervisor.map(|status| status.state)) {
                    (ActiveProvider::Managed { api_key }, Some(SupervisorState::Ready)) => {
                        if self.probe_lapi(MANAGED_API_URL, api_key).await.is_ok() {
                            CrowdSecHealth::Connected
                        } else {
                            CrowdSecHealth::Degraded
                        }
                    }
                    (_, Some(SupervisorState::Starting | SupervisorState::Restarting)) => {
                        CrowdSecHealth::Starting
                    }
                    _ => CrowdSecHealth::Degraded,
                }
            }
            DesiredProvider::External { api_url } => match &active {
                ActiveProvider::External {
                    api_url: active_url,
                    api_key,
                } if active_url == api_url => {
                    if self.probe_lapi(api_url, api_key).await.is_ok() {
                        CrowdSecHealth::Connected
                    } else {
                        CrowdSecHealth::Degraded
                    }
                }
                _ => CrowdSecHealth::Degraded,
            },
        };
        CrowdSecRuntimeStatus {
            mode: desired.mode(),
            state,
            api_url: desired.api_url(),
            credential_configured: matches!(active, ActiveProvider::External { .. }),
            enforcement_active: active.is_enabled(),
            managed_engine,
            community_enabled: desired.community_enabled(),
            community_state: supervisor
                .map_or(CrowdSecCommunityState::Disabled, |status| status.community),
            console_state: supervisor
                .map_or(CrowdSecConsoleState::NotEnrolled, |status| status.console),
            failure_behavior: "fail_open",
            client_ip_source: "caddy",
        }
    }
}
