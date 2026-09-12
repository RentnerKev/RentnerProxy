use super::{
    BASELINE_PROBE_REVISION, CertificateStoreReadiness, EngineError, EngineFuture, ProxyEngine,
    ProxyRuntime, RenderPurpose, RuntimeError,
    renderer::render_config,
    state::{LAST_APPLY_FILE, prepare_state_dir, read_trimmed, state_dir},
};
use crate::models::ProxyRuntimeStatus;
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::time::{sleep, timeout};
use tracing::{info, warn};

impl ProxyRuntime {
    pub(crate) async fn initialize(&self) {
        let _guard = self.apply_lock.lock().await;
        if let Err(error) = self.initialize_locked().await {
            self.mark_unavailable().await;
            warn!(
                stage = "startup",
                ?error,
                "Caddy runtime unavailable; recovery will retry"
            );
        }
    }

    pub(super) async fn initialize_locked(&self) -> Result<(), RuntimeError> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        prepare_state_dir(&self.settings.state_dir).map_err(|_| RuntimeError::Unavailable)?;
        let caddy = state_dir(&self.settings.state_dir)
            .and_then(|dir| dir.ensure_dir("caddy"))
            .map_err(|_| RuntimeError::Unavailable)?;
        caddy
            .ensure_dir("data")
            .map_err(|_| RuntimeError::Unavailable)?;
        let logs = state_dir(&self.settings.state_dir)
            .and_then(|dir| dir.ensure_dir("logs"))
            .map_err(|_| RuntimeError::Unavailable)?;
        match std::fs::symlink_metadata(logs.path().join("access.log")) {
            Ok(_) => {
                logs.open_file("access.log")
                    .map_err(|_| RuntimeError::Unavailable)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(RuntimeError::Unavailable),
        }
        let autosave_dir = caddy
            .ensure_dir("config")
            .and_then(|dir| dir.ensure_dir("caddy"))
            .map_err(|_| RuntimeError::Unavailable)?;
        let autosave_path = autosave_dir
            .child_path("autosave.json")
            .map_err(|_| RuntimeError::Unavailable)?;
        match std::fs::symlink_metadata(autosave_path) {
            Ok(_) => {
                let file = autosave_dir
                    .open_file("autosave.json")
                    .map_err(|_| RuntimeError::Unavailable)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    file.set_permissions(std::fs::Permissions::from_mode(0o600))
                        .map_err(|_| RuntimeError::Unavailable)?;
                }
                #[cfg(not(unix))]
                let _ = file;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(RuntimeError::Unavailable),
        }
        if self.certificate_store.readiness().await != CertificateStoreReadiness::Ready {
            self.certificate_store
                .initialize()
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
        }
        self.trusted_ca_store
            .initialize()
            .map_err(|_| RuntimeError::Unavailable)?;
        let baseline = render_config(None, &self.settings.render_settings())
            .map_err(|_| RuntimeError::ApplyFailed)?;
        let restored = self.restore_active_configuration();
        let restored = if let Some(configuration) = restored {
            self.render_proxy_config_for_apply(&configuration, None, RenderPurpose::Recovery)
                .await
                .ok()
                .map(|json| (configuration, json))
        } else {
            None
        };
        let (configuration, json) = restored.map_or((None, baseline.clone()), |(config, json)| {
            (Some(config), json)
        });
        let expected = configuration
            .as_ref()
            .map_or(BASELINE_PROBE_REVISION, |config| config.revision.as_str());
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        let started = self.start_engine(engine, &json, expected).await;
        let (configuration, json) = if started.is_ok() {
            (configuration, json)
        } else {
            let _ = engine.shutdown().await;
            self.start_engine(engine, &baseline, BASELINE_PROBE_REVISION)
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
            (None, baseline)
        };
        let host_sources = configuration
            .as_ref()
            .map(|config| self.render_active_host_sources(config))
            .transpose()?
            .unwrap_or_default();
        let mut state = self.state.lock().await;
        state.active_revision = configuration.as_ref().map(|config| config.revision.clone());
        state.last_apply_at = read_trimmed(&self.settings.state_dir.join(LAST_APPLY_FILE));
        state.active_json = json;
        state.host_sources = host_sources;
        state.initialized = true;
        state.engine_available = true;
        drop(state);
        *self.active_configuration.lock().await = configuration;
        Ok(())
    }

    pub(crate) async fn start_recovery_worker(self: &Arc<Self>) {
        let mut slot = self.recovery_task.lock().await;
        if slot.is_some() {
            return;
        }
        let runtime = Arc::clone(self);
        *slot = Some(tokio::spawn(async move {
            let mut failures = 0u32;
            loop {
                let delay = if failures == 0 {
                    runtime.settings.recovery_interval
                } else {
                    Duration::from_secs((1u64 << failures.min(6)).min(60))
                };
                sleep(delay).await;
                if runtime.stopping.load(Ordering::SeqCst) {
                    break;
                }
                if runtime.recover().await.is_ok() {
                    failures = 0;
                } else {
                    failures = failures.saturating_add(1);
                }
            }
        }));
    }

    pub(crate) async fn recover(&self) -> Result<(), RuntimeError> {
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        if engine.is_running().await && self.state.lock().await.engine_available {
            return Ok(());
        }
        let _guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;
        if !self.state.lock().await.initialized {
            return self.initialize_locked().await;
        }
        self.ensure_running_locked().await
    }

    pub(super) async fn ensure_running_locked(&self) -> Result<(), RuntimeError> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        let (initialized, available, json, revision) = {
            let state = self.state.lock().await;
            (
                state.initialized,
                state.engine_available,
                state.active_json.clone(),
                state
                    .active_revision
                    .clone()
                    .unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned()),
            )
        };
        if !initialized {
            return Err(RuntimeError::Unavailable);
        }
        if engine.is_running().await && available {
            return Ok(());
        }
        let _ = engine.shutdown().await;
        if self.start_engine(engine, &json, &revision).await.is_err() {
            self.mark_unavailable().await;
            return Err(RuntimeError::Unavailable);
        }
        self.state.lock().await.engine_available = true;
        info!("Caddy recovered verified runtime configuration");
        Ok(())
    }

    pub(crate) async fn status(&self) -> ProxyRuntimeStatus {
        let state = self.state.lock().await;
        let (active_revision, last_apply_at, available) = (
            state.active_revision.clone(),
            state.last_apply_at.clone(),
            state.engine_available && self.engine.is_some(),
        );
        drop(state);
        let running = match &self.engine {
            Some(engine) => engine.is_running().await,
            None => false,
        };
        ProxyRuntimeStatus {
            available,
            running,
            active_revision,
            last_apply_at,
        }
    }

    pub(crate) async fn is_ready(&self) -> bool {
        if self.certificate_store.readiness().await != CertificateStoreReadiness::Ready {
            return false;
        }
        let Ok(_guard) = timeout(self.settings.lock_wait, self.apply_lock.lock()).await else {
            return false;
        };
        let status = self.status().await;
        if !status.available || !status.running {
            return false;
        }
        let Some(engine) = &self.engine else {
            return false;
        };
        let ready = self
            .run_stage(
                engine.probe(
                    status
                        .active_revision
                        .as_deref()
                        .unwrap_or(BASELINE_PROBE_REVISION),
                ),
            )
            .await
            .is_ok();
        if !ready {
            self.mark_unavailable().await;
        }
        ready
    }

    pub(crate) async fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        for slot in [&self.renewal_task, &self.recovery_task] {
            if let Some(task) = slot.lock().await.take() {
                task.abort();
                let _ = task.await;
            }
        }
        let _guard = self.apply_lock.lock().await;
        if let Some(engine) = &self.engine
            && engine.shutdown().await.is_err()
        {
            warn!(stage = "shutdown", "Caddy required forced termination");
        }
        self.mark_unavailable().await;
    }

    pub(super) async fn start_engine(
        &self,
        engine: &Arc<dyn ProxyEngine>,
        json: &str,
        revision: &str,
    ) -> Result<(), EngineError> {
        let result = self.run_stage(engine.start(json, revision)).await;
        if result.is_err() {
            let _ = engine.shutdown().await;
        }
        result
    }

    pub(super) async fn run_stage<'a>(&self, future: EngineFuture<'a>) -> Result<(), EngineError> {
        timeout(self.settings.stage_timeout, future)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    pub(super) async fn mark_unavailable(&self) {
        self.state.lock().await.engine_available = false;
    }
}
