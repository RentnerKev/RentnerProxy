use std::{sync::Arc, time::SystemTime};

use tokio::time::timeout;
use tracing::{info, warn};

use crate::{
    models::{ApplyOutcome, ValidatedProxyConfig},
    proxy::revision_from_config,
};

use super::{
    BASELINE_PROBE_REVISION, EngineError, ProxyRuntime, RuntimeError,
    clock::{elapsed_millis, utc_now},
    renderer::render_config,
    state::{atomic_write, replace_file},
};

impl ProxyRuntime {
    pub(crate) async fn apply(
        self: &Arc<Self>,
        configuration: ValidatedProxyConfig,
    ) -> Result<ApplyOutcome, RuntimeError> {
        let runtime = Arc::clone(self);
        tokio::spawn(async move { runtime.apply_inner(configuration).await })
            .await
            .unwrap_or(Err(RuntimeError::ApplyFailed))
    }

    async fn apply_inner(
        &self,
        configuration: ValidatedProxyConfig,
    ) -> Result<ApplyOutcome, RuntimeError> {
        let started_at = SystemTime::now();
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;

        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        if !self.state.lock().await.engine_available {
            return Err(RuntimeError::Unavailable);
        }
        if !engine.is_running().await {
            self.mark_unavailable().await;
            return Err(RuntimeError::Unavailable);
        }
        if self.state.lock().await.active_revision.as_deref()
            == Some(configuration.revision.as_str())
        {
            info!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, hosts = configuration.proxy_hosts.len(), duration_ms = elapsed_millis(started_at), "proxy configuration unchanged");
            return Ok(ApplyOutcome::Unchanged);
        }

        let candidate = render_config(Some(&configuration), &self.settings.render_settings())
            .map_err(|_| RuntimeError::ApplyFailed)?;
        let candidate_path = self.candidate_path();
        let active_path = self.active_path();
        if atomic_write(&candidate_path, candidate.as_bytes()).is_err() {
            return Err(RuntimeError::ApplyFailed);
        }
        info!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, hosts = configuration.proxy_hosts.len(), "proxy configuration candidate written");

        match self.run_stage(engine.test_config(&candidate_path)).await {
            Ok(()) => {}
            Err(error) => {
                self.handle_engine_error(error).await;
                warn!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "config_test", "proxy candidate rejected");
                return Err(runtime_error_for_engine(error));
            }
        }

        let previous = std::fs::read(&active_path).map_err(|_| RuntimeError::ApplyFailed)?;
        let previous_revision = revision_from_config(&String::from_utf8_lossy(&previous));
        if atomic_write(&self.last_good_path(), &previous).is_err() {
            return Err(RuntimeError::ApplyFailed);
        }
        if replace_file(&candidate_path, &active_path).is_err() {
            if atomic_write(&active_path, &previous).is_err() {
                self.mark_unavailable().await;
            }
            return Err(RuntimeError::ApplyFailed);
        }

        if let Err(error) = self
            .run_stage(engine.reload(&active_path, &configuration.revision))
            .await
        {
            self.handle_engine_error(error).await;
            let rollback_written = atomic_write(&active_path, &previous).is_ok();
            let expected = previous_revision
                .as_deref()
                .unwrap_or(BASELINE_PROBE_REVISION);
            let recovery = if rollback_written {
                self.run_stage(engine.reload(&active_path, expected)).await
            } else {
                Err(EngineError::CommandFailed)
            };
            if let Err(_recovery_error) = recovery {
                self.mark_unavailable().await;
                warn!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "rollback", "proxy recovery reload failed");
            } else {
                self.state.lock().await.engine_available = true;
                info!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "rollback", "proxy rollback recovered");
            }
            warn!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "reload", "proxy configuration apply failed");
            return Err(RuntimeError::ApplyFailed);
        }

        if atomic_write(&self.last_good_path(), candidate.as_bytes()).is_err() {
            warn!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "last_good", "active proxy backup refresh failed");
        }
        let applied_at = utc_now();
        if atomic_write(&self.last_apply_path(), applied_at.as_bytes()).is_err() {
            warn!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, stage = "last_apply_at", "active proxy timestamp persistence failed");
        }
        let mut state = self.state.lock().await;
        state.active_revision = Some(configuration.revision.clone());
        state.last_apply_at = Some(applied_at);
        state.engine_available = true;
        drop(state);
        info!(target: "rentnerproxy_controller::runtime", revision = %configuration.revision, hosts = configuration.proxy_hosts.len(), duration_ms = elapsed_millis(started_at), "proxy configuration applied");
        Ok(ApplyOutcome::Applied)
    }
}

fn runtime_error_for_engine(error: EngineError) -> RuntimeError {
    if matches!(error, EngineError::Unavailable | EngineError::Unsupported) {
        RuntimeError::Unavailable
    } else {
        RuntimeError::ApplyFailed
    }
}
