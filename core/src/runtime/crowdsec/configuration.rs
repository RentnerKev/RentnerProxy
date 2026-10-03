use super::{
    ActiveProvider, CrowdSecError, DesiredProvider, PersistedConfiguration, ProxyRuntime,
    normalize_api_url,
};
use crate::{
    models::{CrowdSecConfigRequest, CrowdSecMode, CrowdSecRuntimeStatus},
    runtime::{
        ACTIVE_CROWDSEC_CONFIGURATION_FILE, BASELINE_PROBE_REVISION, RenderPurpose,
        renderer::render_config_with_crowdsec,
        state::{atomic_write, state_dir},
    },
};
use std::sync::{Arc, atomic::Ordering};
use tokio::time::timeout;
use tracing::{info, warn};

impl ProxyRuntime {
    pub(crate) async fn apply_crowdsec(
        self: &Arc<Self>,
        request: CrowdSecConfigRequest,
    ) -> Result<CrowdSecRuntimeStatus, CrowdSecError> {
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let guard = timeout(runtime.settings.lock_wait, runtime.apply_lock.lock())
                .await
                .map_err(|_| CrowdSecError::Busy)?;
            if runtime.stopping.load(Ordering::SeqCst) {
                return Err(CrowdSecError::RuntimeUnavailable);
            }
            if !runtime.state.lock().await.initialized {
                return Err(CrowdSecError::RuntimeUnavailable);
            }

            let previous = {
                let state = runtime.crowdsec.lock().await;
                (state.desired.clone(), state.active.clone())
            };
            let (desired, target) = runtime.validate_request(request)?;
            let target = match runtime.prepare_provider(&desired, &target).await {
                Ok(target) => target,
                Err(error) => {
                    runtime
                        .rollback_managed_start(&previous.0, &previous.1, &target)
                        .await;
                    return Err(error);
                }
            };
            if previous.0 == desired && previous.1 == target {
                drop(guard);
                return Ok(runtime.crowdsec_status().await);
            }

            // Changing only the managed online preference never restarts Caddy. The
            // supervisor reconciles CrowdSec independently of the data plane.
            if previous.1 == target {
                if runtime.persist_crowdsec_configuration(&desired).is_err() {
                    let _ = runtime.set_supervisor_mode(previous.0.supervisor_mode());
                    return Err(CrowdSecError::ApplyFailed);
                }
                runtime.crowdsec.lock().await.desired = desired;
                drop(guard);
                return Ok(runtime.crowdsec_status().await);
            }

            let Some(engine) = &runtime.engine else {
                runtime
                    .rollback_managed_start(&previous.0, &previous.1, &target)
                    .await;
                return Err(CrowdSecError::RuntimeUnavailable);
            };
            let (configuration, previous_json, revision) = {
                let state = runtime.state.lock().await;
                (
                    runtime.active_configuration.lock().await.clone(),
                    state.active_json.clone(),
                    state
                        .active_revision
                        .clone()
                        .unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned()),
                )
            };
            let target_json = match configuration.as_ref() {
                Some(configuration) => match runtime
                    .render_proxy_config_for_provider(
                        configuration,
                        None,
                        RenderPurpose::Activation,
                        &target,
                    )
                    .await
                {
                    Ok(target_json) => target_json,
                    Err(_) => {
                        runtime
                            .rollback_managed_start(&previous.0, &previous.1, &target)
                            .await;
                        return Err(CrowdSecError::ApplyFailed);
                    }
                },
                None => {
                    let render_settings = target.render_settings();
                    match render_config_with_crowdsec(
                        None,
                        &runtime.settings.render_settings(),
                        render_settings.as_ref(),
                    ) {
                        Ok(target_json) => target_json,
                        Err(_) => {
                            runtime
                                .rollback_managed_start(&previous.0, &previous.1, &target)
                                .await;
                            return Err(CrowdSecError::ApplyFailed);
                        }
                    }
                }
            };

            let _ = engine.shutdown().await;
            if runtime
                .start_engine(engine, &target_json, &revision, target.environment())
                .await
                .is_err()
            {
                let restored = runtime
                    .start_engine(engine, &previous_json, &revision, previous.1.environment())
                    .await
                    .is_ok();
                if !restored {
                    runtime.mark_unavailable().await;
                }
                runtime
                    .rollback_managed_start(&previous.0, &previous.1, &target)
                    .await;
                return Err(CrowdSecError::ApplyFailed);
            }

            if let Err(error) = runtime.persist_crowdsec_configuration(&desired) {
                warn!(
                    ?error,
                    stage = "crowdsec_snapshot",
                    "CrowdSec provider state was not persisted"
                );
                let _ = engine.shutdown().await;
                let restored = runtime
                    .start_engine(engine, &previous_json, &revision, previous.1.environment())
                    .await
                    .is_ok();
                if !restored {
                    runtime.mark_unavailable().await;
                }
                runtime
                    .rollback_managed_start(&previous.0, &previous.1, &target)
                    .await;
                return Err(CrowdSecError::ApplyFailed);
            }
            {
                let mut state = runtime.state.lock().await;
                state.active_json = target_json;
                state.engine_available = true;
            }
            {
                let mut state = runtime.crowdsec.lock().await;
                state.desired = desired.clone();
                state.active = target.clone();
            }
            if previous.1.is_managed() && !target.is_managed() {
                runtime.stop_managed_best_effort().await;
            }
            info!(mode = ?desired.mode(), "CrowdSec provider switched");
            drop(guard);
            Ok(runtime.crowdsec_status().await)
        })
        .await
        .unwrap_or(Err(CrowdSecError::ApplyFailed))
    }

    pub(crate) async fn test_crowdsec_connection(
        &self,
        request: CrowdSecConfigRequest,
    ) -> Result<(), CrowdSecError> {
        let (desired, provider) = self.validate_request(request)?;
        if !matches!(desired, DesiredProvider::External { .. }) {
            return Err(CrowdSecError::InvalidConfiguration);
        }
        let (Some(api_url), Some(api_key)) = (provider.api_url(), provider.api_key()) else {
            return Err(CrowdSecError::InvalidConfiguration);
        };
        self.probe_lapi(api_url, api_key).await
    }

    pub(in crate::runtime) async fn initialize_crowdsec_locked(&self) {
        let desired = self
            .restore_crowdsec_configuration()
            .unwrap_or(DesiredProvider::Disabled);
        let active = match desired {
            DesiredProvider::Managed { .. } => {
                match self.prepare_managed_provider(&desired).await {
                    Ok(provider) => provider,
                    Err(error) => {
                        warn!(
                            ?error,
                            stage = "crowdsec_startup",
                            "Managed CrowdSec will retry through reconciliation"
                        );
                        ActiveProvider::Disabled
                    }
                }
            }
            DesiredProvider::Disabled | DesiredProvider::External { .. } => {
                self.stop_managed_best_effort().await;
                ActiveProvider::Disabled
            }
        };
        let mut state = self.crowdsec.lock().await;
        state.desired = desired;
        state.active = active;
    }

    pub(in crate::runtime) async fn active_crowdsec_provider(&self) -> ActiveProvider {
        self.crowdsec.lock().await.active.clone()
    }

    pub(super) fn persist_crowdsec_configuration(
        &self,
        desired: &DesiredProvider,
    ) -> Result<(), CrowdSecError> {
        let persisted = PersistedConfiguration {
            version: 1,
            mode: desired.mode(),
            api_url: desired.api_url(),
            community_enabled: desired.community_enabled(),
        };
        let bytes = serde_json::to_vec(&persisted).map_err(|_| CrowdSecError::ApplyFailed)?;
        atomic_write(
            &self
                .settings
                .state_dir
                .join(ACTIVE_CROWDSEC_CONFIGURATION_FILE),
            &bytes,
        )
        .map_err(|_| CrowdSecError::ApplyFailed)
    }

    pub(super) fn restore_crowdsec_configuration(&self) -> Option<DesiredProvider> {
        let bytes = state_dir(&self.settings.state_dir)
            .ok()?
            .read_file(ACTIVE_CROWDSEC_CONFIGURATION_FILE, 4_096)
            .ok()?;
        let persisted = serde_json::from_slice::<PersistedConfiguration>(&bytes).ok()?;
        if persisted.version != 1 {
            return None;
        }
        match persisted.mode {
            CrowdSecMode::Disabled
                if persisted.api_url.is_none() && !persisted.community_enabled =>
            {
                Some(DesiredProvider::Disabled)
            }
            CrowdSecMode::Managed if persisted.api_url.is_none() => {
                Some(DesiredProvider::Managed {
                    community_enabled: persisted.community_enabled,
                })
            }
            CrowdSecMode::External if !persisted.community_enabled => {
                normalize_api_url(persisted.api_url.as_deref()?)
                    .ok()
                    .map(|api_url| DesiredProvider::External { api_url })
            }
            CrowdSecMode::Disabled | CrowdSecMode::Managed | CrowdSecMode::External => None,
        }
    }
}
