mod apply;
pub(crate) mod clock;
mod engine;
pub(crate) mod renderer;
mod state;

use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{sync::Mutex, time::timeout};
use tracing::{info, warn};

use crate::{
    models::{ProxyRuntimeStatus, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, revision_from_config},
};

pub(crate) use engine::{EngineError, EngineFuture, ProcessEngine, ProxyEngine};
use renderer::{
    MAX_RENDERED_PROXY_CONFIG_BYTES, MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError,
    RenderSettings, render_config, render_host_config, render_host_sources,
};
use state::{
    ACTIVE_CONFIG_FILE, CANDIDATE_CONFIG_FILE, LAST_APPLY_FILE, LAST_GOOD_CONFIG_FILE,
    atomic_write, prepare_state_dir, read_trimmed,
};

#[cfg(unix)]
const PROBE_SOCKET_FILE: &str = "runtime-probe.sock";
const BASELINE_PROBE_REVISION: &str = "none";
const ACTIVE_HOST_SOURCES_FILE: &str = "active-host-sources.json";
const MAX_ACTIVE_HOST_SOURCES_BYTES: usize = MAX_RENDERED_PROXY_CONFIG_BYTES * 6 + 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSettings {
    pub(crate) state_dir: PathBuf,
    pub(crate) http_port: u16,
    pub(crate) lock_wait: Duration,
    pub(crate) stage_timeout: Duration,
}

impl RuntimeSettings {
    pub(crate) fn new(state_dir: PathBuf, http_port: u16) -> Self {
        Self {
            state_dir,
            http_port,
            lock_wait: Duration::from_secs(2),
            stage_timeout: Duration::from_secs(4),
        }
    }

    pub(crate) fn probe_socket(&self) -> Option<PathBuf> {
        #[cfg(unix)]
        {
            Some(self.state_dir.join(PROBE_SOCKET_FILE))
        }
        #[cfg(not(unix))]
        {
            None
        }
    }

    fn render_settings(&self) -> RenderSettings {
        RenderSettings {
            http_port: self.http_port,
            probe_socket: self.probe_socket(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RuntimeError {
    Busy,
    Unavailable,
    ApplyFailed,
    ConfigTooLarge,
    HostConfigNotFound,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ActiveHostSources {
    revision: String,
    host_sources: BTreeMap<String, String>,
}

struct RuntimeState {
    active_revision: Option<String>,
    last_apply_at: Option<String>,
    engine_available: bool,
}

pub(crate) struct ProxyRuntime {
    settings: RuntimeSettings,
    engine: Option<Arc<dyn ProxyEngine>>,
    state: Mutex<RuntimeState>,
    apply_lock: Mutex<()>,
}

impl ProxyRuntime {
    pub(crate) fn new(
        settings: RuntimeSettings,
        engine: Option<Arc<dyn ProxyEngine>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            settings,
            engine,
            state: Mutex::new(RuntimeState {
                active_revision: None,
                last_apply_at: None,
                engine_available: true,
            }),
            apply_lock: Mutex::new(()),
        })
    }

    pub(crate) async fn initialize(&self) {
        if prepare_state_dir(&self.settings.state_dir).is_err() {
            self.mark_unavailable().await;
            warn!(stage = "state_directory", "proxy runtime is unavailable");
            return;
        }

        let active_path = self.active_path();
        let mut last_good = std::fs::read_to_string(self.last_good_path()).ok();
        let mut persist_active_as_last_good = last_good.is_none();
        let mut active_contents = match std::fs::read_to_string(&active_path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Some(last_good) = last_good.as_ref() {
                    if atomic_write(&active_path, last_good.as_bytes()).is_err() {
                        self.mark_unavailable().await;
                        warn!(
                            stage = "restore_missing_active",
                            "proxy runtime is unavailable"
                        );
                        return;
                    }
                    persist_active_as_last_good = false;
                    last_good.clone()
                } else {
                    let baseline = match render_config(None, &self.settings.render_settings()) {
                        Ok(config) => config,
                        Err(_) => {
                            self.mark_unavailable().await;
                            warn!(stage = "render_baseline", "proxy runtime is unavailable");
                            return;
                        }
                    };
                    if atomic_write(&active_path, baseline.as_bytes()).is_err()
                        || atomic_write(&self.last_good_path(), baseline.as_bytes()).is_err()
                    {
                        self.mark_unavailable().await;
                        warn!(stage = "write_baseline", "proxy runtime is unavailable");
                        return;
                    }
                    last_good = Some(baseline.clone());
                    persist_active_as_last_good = false;
                    baseline
                }
            }
            Err(_) => {
                let Some(last_good) = last_good.as_ref() else {
                    self.mark_unavailable().await;
                    warn!(stage = "read_active", "proxy runtime is unavailable");
                    return;
                };
                if atomic_write(&active_path, last_good.as_bytes()).is_err() {
                    self.mark_unavailable().await;
                    warn!(
                        stage = "restore_unreadable_active",
                        "proxy runtime is unavailable"
                    );
                    return;
                }
                persist_active_as_last_good = false;
                last_good.clone()
            }
        };
        let mut engine_available = false;
        if let Some(engine) = &self.engine {
            if self
                .start_configuration(engine, &active_path, &active_contents)
                .await
                .is_err()
            {
                let restored = last_good
                    .as_ref()
                    .filter(|last_good| *last_good != &active_contents);
                if let Some(last_good) = restored {
                    if atomic_write(&active_path, last_good.as_bytes()).is_ok()
                        && self
                            .start_configuration(engine, &active_path, last_good)
                            .await
                            .is_ok()
                    {
                        active_contents = last_good.clone();
                        persist_active_as_last_good = false;
                        engine_available = true;
                        info!(
                            stage = "startup_recovery",
                            "proxy runtime restored last-good configuration"
                        );
                    }
                }
            } else {
                engine_available = true;
            }
            if !engine_available {
                warn!(
                    stage = "startup",
                    "proxy runtime did not start; controller remains available"
                );
            }
        }
        if engine_available
            && persist_active_as_last_good
            && atomic_write(&self.last_good_path(), active_contents.as_bytes()).is_err()
        {
            warn!(
                stage = "write_last_good",
                "proxy runtime could not persist its last-good configuration"
            );
        }
        let mut state = self.state.lock().await;
        state.active_revision = revision_from_config(&active_contents);
        state.last_apply_at = read_trimmed(&self.last_apply_path());
        state.engine_available = engine_available;
    }

    pub(crate) async fn status(&self) -> ProxyRuntimeStatus {
        let (active_revision, last_apply_at, available) = {
            let state = self.state.lock().await;
            (
                state.active_revision.clone(),
                state.last_apply_at.clone(),
                state.engine_available && self.engine.is_some(),
            )
        };
        let running = match &self.engine {
            Some(engine) if available => engine.is_running().await,
            Some(_) | None => false,
        };
        ProxyRuntimeStatus {
            available,
            running,
            active_revision,
            last_apply_at,
        }
    }

    pub(crate) fn preview_config(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<String, RuntimeError> {
        self.render_proxy_config(Some(configuration))
    }

    pub(crate) async fn active_config(&self) -> Result<(String, Option<String>), RuntimeError> {
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;
        let mut reader = std::fs::File::open(self.active_path())
            .map_err(|_| RuntimeError::Unavailable)?
            .take((MAX_RENDERED_PROXY_CONFIG_BYTES as u64) + 1);
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(|_| RuntimeError::Unavailable)?;
        if bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        let contents = String::from_utf8(bytes).map_err(|_| RuntimeError::Unavailable)?;
        let revision = revision_from_config(&contents);
        Ok((contents, revision))
    }

    pub(crate) fn preview_host_config(
        &self,
        configuration: &ValidatedProxyConfig,
        host_id: &str,
    ) -> Result<String, RuntimeError> {
        if !is_canonical_uuid(host_id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let host = configuration
            .proxy_hosts
            .iter()
            .find(|host| host.id == host_id)
            .ok_or(RuntimeError::HostConfigNotFound)?;
        let source = render_host_config(host, self.settings.http_port);
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        Ok(source)
    }

    pub(crate) async fn active_host_config(
        &self,
        host_id: &str,
    ) -> Result<(String, String), RuntimeError> {
        if !is_canonical_uuid(host_id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;

        let mut active_reader = std::fs::File::open(self.active_path())
            .map_err(|_| RuntimeError::Unavailable)?
            .take((MAX_RENDERED_PROXY_CONFIG_BYTES as u64) + 1);
        let mut active_bytes = Vec::new();
        active_reader
            .read_to_end(&mut active_bytes)
            .map_err(|_| RuntimeError::Unavailable)?;
        if active_bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        let active_contents =
            String::from_utf8(active_bytes).map_err(|_| RuntimeError::Unavailable)?;
        let active_revision =
            revision_from_config(&active_contents).ok_or(RuntimeError::HostConfigNotFound)?;

        let mut source_reader = std::fs::File::open(self.active_host_sources_path())
            .map_err(|_| RuntimeError::HostConfigNotFound)?
            .take((MAX_ACTIVE_HOST_SOURCES_BYTES as u64) + 1);
        let mut source_bytes = Vec::new();
        source_reader
            .read_to_end(&mut source_bytes)
            .map_err(|_| RuntimeError::HostConfigNotFound)?;
        if source_bytes.len() > MAX_ACTIVE_HOST_SOURCES_BYTES {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let sources = serde_json::from_slice::<ActiveHostSources>(&source_bytes)
            .map_err(|_| RuntimeError::HostConfigNotFound)?;
        if sources.revision != active_revision {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let source = sources
            .host_sources
            .get(host_id)
            .filter(|source| source.len() <= MAX_RENDERED_PROXY_HOST_SOURCE_BYTES)
            .cloned()
            .ok_or(RuntimeError::HostConfigNotFound)?;
        Ok((source, active_revision))
    }

    fn render_active_host_sources(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<ActiveHostSources, RuntimeError> {
        let host_sources = render_host_sources(configuration, self.settings.http_port).map_err(
            |error| match error {
                RenderError::ConfigTooLarge => RuntimeError::ConfigTooLarge,
                RenderError::InvalidProbeSocket => RuntimeError::ApplyFailed,
            },
        )?;
        Ok(ActiveHostSources {
            revision: configuration.revision.clone(),
            host_sources,
        })
    }

    fn persist_active_host_sources(&self, sources: &ActiveHostSources) -> Result<(), RuntimeError> {
        let bytes = serde_json::to_vec(sources).map_err(|_| RuntimeError::ApplyFailed)?;
        if bytes.len() > MAX_ACTIVE_HOST_SOURCES_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        atomic_write(&self.active_host_sources_path(), &bytes)
            .map_err(|_| RuntimeError::ApplyFailed)
    }

    fn render_proxy_config(
        &self,
        configuration: Option<&ValidatedProxyConfig>,
    ) -> Result<String, RuntimeError> {
        render_config(configuration, &self.settings.render_settings()).map_err(
            |error| match error {
                RenderError::ConfigTooLarge => RuntimeError::ConfigTooLarge,
                RenderError::InvalidProbeSocket => RuntimeError::ApplyFailed,
            },
        )
    }

    pub(crate) async fn shutdown(&self) {
        if let Some(engine) = &self.engine {
            if engine.shutdown().await.is_err() {
                warn!(stage = "shutdown", "proxy engine did not stop cleanly");
            }
        }
    }

    async fn run_stage<'a>(&self, future: EngineFuture<'a>) -> Result<(), EngineError> {
        timeout(self.settings.stage_timeout, future)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    async fn start_configuration(
        &self,
        engine: &Arc<dyn ProxyEngine>,
        config_path: &Path,
        contents: &str,
    ) -> Result<(), EngineError> {
        let expected_revision =
            revision_from_config(contents).unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned());
        self.run_stage(engine.test_config(config_path)).await?;
        self.run_stage(engine.start(config_path, &expected_revision))
            .await
    }

    async fn handle_engine_error(&self, error: EngineError) {
        if matches!(error, EngineError::Unavailable | EngineError::Unsupported) {
            self.mark_unavailable().await;
        }
    }

    async fn mark_unavailable(&self) {
        self.state.lock().await.engine_available = false;
    }

    fn active_path(&self) -> PathBuf {
        self.settings.state_dir.join(ACTIVE_CONFIG_FILE)
    }

    fn candidate_path(&self) -> PathBuf {
        self.settings.state_dir.join(CANDIDATE_CONFIG_FILE)
    }

    fn last_good_path(&self) -> PathBuf {
        self.settings.state_dir.join(LAST_GOOD_CONFIG_FILE)
    }

    fn last_apply_path(&self) -> PathBuf {
        self.settings.state_dir.join(LAST_APPLY_FILE)
    }

    fn active_host_sources_path(&self) -> PathBuf {
        self.settings.state_dir.join(ACTIVE_HOST_SOURCES_FILE)
    }
}
