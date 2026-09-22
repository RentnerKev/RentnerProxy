use std::{
    io::Read,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

use reqwest::{StatusCode, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use tokio::time::{Instant, sleep, timeout};
use tracing::{info, warn};

use crate::models::{
    CrowdSecConfigRequest, CrowdSecHealth, CrowdSecManagedEngineState, CrowdSecMode,
    CrowdSecRuntimeStatus, SecretString,
};

use super::{
    ACTIVE_CROWDSEC_CONFIGURATION_FILE, BASELINE_PROBE_REVISION, EngineEnvironment, ProxyRuntime,
    RenderPurpose,
    renderer::render_config_with_crowdsec,
    state::{atomic_write, open_absolute_regular_file, state_dir},
};

const MANAGED_API_URL: &str = "http://127.0.0.1:18080/";
const DESIRED_MODE_FILE: &str = "desired-mode";
const SUPERVISOR_STATUS_FILE: &str = "status.json";
const BOUNCER_KEY_PATH: &str = "bouncer/caddy-bouncer-key";
const MAX_STATUS_BYTES: u64 = 4_096;
const MAX_SECRET_BYTES: u64 = 1_024;
const MAX_LAPI_RESPONSE_BYTES: usize = 64 * 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CrowdSecError {
    Busy,
    InvalidConfiguration,
    ConnectionFailed,
    RuntimeUnavailable,
    ApplyFailed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DesiredProvider {
    Disabled,
    Managed,
    External { api_url: String },
}

impl DesiredProvider {
    fn mode(&self) -> CrowdSecMode {
        match self {
            Self::Disabled => CrowdSecMode::Disabled,
            Self::Managed => CrowdSecMode::Managed,
            Self::External { .. } => CrowdSecMode::External,
        }
    }

    fn api_url(&self) -> Option<String> {
        match self {
            Self::External { api_url } => Some(api_url.clone()),
            Self::Disabled | Self::Managed => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ActiveProvider {
    Disabled,
    Managed {
        api_key: SecretString,
    },
    External {
        api_url: String,
        api_key: SecretString,
    },
}

impl ActiveProvider {
    fn is_enabled(&self) -> bool {
        !matches!(self, Self::Disabled)
    }

    fn is_managed(&self) -> bool {
        matches!(self, Self::Managed { .. })
    }

    fn api_url(&self) -> Option<&str> {
        match self {
            Self::Disabled => None,
            Self::Managed { .. } => Some(MANAGED_API_URL),
            Self::External { api_url, .. } => Some(api_url),
        }
    }

    fn api_key(&self) -> Option<&SecretString> {
        match self {
            Self::Disabled => None,
            Self::Managed { api_key } | Self::External { api_key, .. } => Some(api_key),
        }
    }

    pub(super) fn render_settings(&self) -> Option<super::renderer::CrowdSecRenderSettings> {
        Some(super::renderer::CrowdSecRenderSettings {
            api_url: self.api_url()?.to_owned(),
        })
    }

    pub(super) fn environment(&self) -> EngineEnvironment {
        self.api_key()
            .map_or_else(EngineEnvironment::default, |key| {
                EngineEnvironment::with_crowdsec_bouncer_key(key.expose().to_owned())
            })
    }
}

pub(super) struct CrowdSecState {
    desired: DesiredProvider,
    active: ActiveProvider,
}

impl Default for CrowdSecState {
    fn default() -> Self {
        Self {
            desired: DesiredProvider::Disabled,
            active: ActiveProvider::Disabled,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PersistedConfiguration {
    version: u8,
    mode: CrowdSecMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_url: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
struct SupervisorStatus {
    state: SupervisorState,
    restarts: u8,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SupervisorState {
    Stopped,
    Starting,
    Ready,
    Restarting,
    Degraded,
}

impl SupervisorState {
    fn public(self) -> CrowdSecManagedEngineState {
        match self {
            Self::Stopped => CrowdSecManagedEngineState::Stopped,
            Self::Starting => CrowdSecManagedEngineState::Starting,
            Self::Ready => CrowdSecManagedEngineState::Ready,
            Self::Restarting => CrowdSecManagedEngineState::Restarting,
            Self::Degraded => CrowdSecManagedEngineState::Degraded,
        }
    }
}

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

            let (desired, target) = runtime.prepare_provider(request).await?;
            let previous = {
                let state = runtime.crowdsec.lock().await;
                (state.desired.clone(), state.active.clone())
            };
            if previous.0 == desired && previous.1 == target {
                drop(guard);
                return Ok(runtime.crowdsec_status().await);
            }

            let Some(engine) = &runtime.engine else {
                runtime.rollback_managed_start(&previous.1, &target).await;
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
                Some(configuration) => runtime
                    .render_proxy_config_for_provider(
                        configuration,
                        None,
                        RenderPurpose::Activation,
                        &target,
                    )
                    .await
                    .map_err(|_| CrowdSecError::ApplyFailed)?,
                None => {
                    let render_settings = target.render_settings();
                    render_config_with_crowdsec(
                        None,
                        &runtime.settings.render_settings(),
                        render_settings.as_ref(),
                    )
                    .map_err(|_| CrowdSecError::ApplyFailed)?
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
                runtime.rollback_managed_start(&previous.1, &target).await;
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
                runtime.rollback_managed_start(&previous.1, &target).await;
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
            DesiredProvider::Managed => match (&active, supervisor.map(|status| status.state)) {
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
            },
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
            failure_behavior: "fail_open",
            client_ip_source: "caddy",
        }
    }

    pub(super) async fn initialize_crowdsec_locked(&self) {
        let desired = self
            .restore_crowdsec_configuration()
            .unwrap_or(DesiredProvider::Disabled);
        let active = match desired {
            DesiredProvider::Managed => match self.prepare_managed_provider().await {
                Ok(provider) => provider,
                Err(error) => {
                    warn!(
                        ?error,
                        stage = "crowdsec_startup",
                        "Managed CrowdSec will retry through reconciliation"
                    );
                    ActiveProvider::Disabled
                }
            },
            DesiredProvider::Disabled | DesiredProvider::External { .. } => {
                self.stop_managed_best_effort().await;
                ActiveProvider::Disabled
            }
        };
        let mut state = self.crowdsec.lock().await;
        state.desired = desired;
        state.active = active;
    }

    pub(super) async fn active_crowdsec_provider(&self) -> ActiveProvider {
        self.crowdsec.lock().await.active.clone()
    }

    async fn prepare_provider(
        &self,
        request: CrowdSecConfigRequest,
    ) -> Result<(DesiredProvider, ActiveProvider), CrowdSecError> {
        let (desired, provider) = self.validate_request(request)?;
        match provider {
            ActiveProvider::Managed { .. } => {
                let managed = self.prepare_managed_provider().await?;
                Ok((desired, managed))
            }
            ActiveProvider::External {
                ref api_url,
                ref api_key,
            } => {
                self.probe_lapi(api_url, api_key).await?;
                Ok((desired, provider))
            }
            ActiveProvider::Disabled => Ok((desired, provider)),
        }
    }

    fn validate_request(
        &self,
        request: CrowdSecConfigRequest,
    ) -> Result<(DesiredProvider, ActiveProvider), CrowdSecError> {
        match request.mode {
            CrowdSecMode::Disabled if request.api_url.is_none() && request.api_key.is_none() => {
                Ok((DesiredProvider::Disabled, ActiveProvider::Disabled))
            }
            CrowdSecMode::Managed if request.api_url.is_none() && request.api_key.is_none() => {
                Ok((
                    DesiredProvider::Managed,
                    ActiveProvider::Managed {
                        api_key: SecretString::new(String::new()),
                    },
                ))
            }
            CrowdSecMode::External => {
                let api_url = normalize_api_url(
                    request
                        .api_url
                        .as_deref()
                        .ok_or(CrowdSecError::InvalidConfiguration)?,
                )?;
                let api_key = request.api_key.ok_or(CrowdSecError::InvalidConfiguration)?;
                validate_api_key(&api_key)?;
                Ok((
                    DesiredProvider::External {
                        api_url: api_url.clone(),
                    },
                    ActiveProvider::External { api_url, api_key },
                ))
            }
            CrowdSecMode::Disabled | CrowdSecMode::Managed => {
                Err(CrowdSecError::InvalidConfiguration)
            }
        }
    }

    async fn prepare_managed_provider(&self) -> Result<ActiveProvider, CrowdSecError> {
        self.set_supervisor_mode("managed")?;
        let deadline = Instant::now() + self.settings.crowdsec_start_timeout;
        loop {
            match self.read_supervisor_status() {
                Ok(SupervisorStatus {
                    state: SupervisorState::Ready,
                    ..
                }) => break,
                Ok(SupervisorStatus {
                    state: SupervisorState::Degraded,
                    ..
                }) => return Err(CrowdSecError::ConnectionFailed),
                Ok(_) | Err(_) if Instant::now() < deadline => {
                    sleep(Duration::from_millis(100)).await;
                }
                Ok(_) | Err(_) => return Err(CrowdSecError::ConnectionFailed),
            }
        }
        let api_key = self.read_managed_bouncer_key()?;
        self.probe_lapi(MANAGED_API_URL, &api_key).await?;
        Ok(ActiveProvider::Managed { api_key })
    }

    async fn rollback_managed_start(&self, previous: &ActiveProvider, target: &ActiveProvider) {
        if !previous.is_managed() && target.is_managed() {
            self.stop_managed_best_effort().await;
        }
    }

    async fn stop_managed_best_effort(&self) {
        if !self.settings.crowdsec_control_dir.exists() {
            return;
        }
        if self.set_supervisor_mode("stopped").is_err() {
            warn!(
                stage = "crowdsec_stop",
                "CrowdSec supervisor could not be signalled"
            );
            return;
        }
        let deadline = Instant::now() + self.settings.stage_timeout;
        loop {
            if self
                .read_supervisor_status()
                .is_ok_and(|status| status.state == SupervisorState::Stopped)
            {
                return;
            }
            if Instant::now() >= deadline {
                warn!(
                    stage = "crowdsec_stop",
                    "CrowdSec supervisor did not stop within the bounded wait"
                );
                return;
            }
            sleep(Duration::from_millis(100)).await;
        }
    }

    fn set_supervisor_mode(&self, mode: &str) -> Result<(), CrowdSecError> {
        if !matches!(mode, "managed" | "stopped") {
            return Err(CrowdSecError::InvalidConfiguration);
        }
        atomic_write(
            &self.settings.crowdsec_control_dir.join(DESIRED_MODE_FILE),
            format!("{mode}\n").as_bytes(),
        )
        .map_err(|_| CrowdSecError::RuntimeUnavailable)
    }

    fn read_supervisor_status(&self) -> Result<SupervisorStatus, CrowdSecError> {
        let file = open_absolute_regular_file(
            &self
                .settings
                .crowdsec_control_dir
                .join(SUPERVISOR_STATUS_FILE),
        )
        .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        let mut bytes = Vec::new();
        file.take(MAX_STATUS_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        if bytes.len() as u64 > MAX_STATUS_BYTES {
            return Err(CrowdSecError::RuntimeUnavailable);
        }
        serde_json::from_slice(&bytes).map_err(|_| CrowdSecError::RuntimeUnavailable)
    }

    fn read_managed_bouncer_key(&self) -> Result<SecretString, CrowdSecError> {
        let file =
            open_absolute_regular_file(&self.settings.crowdsec_state_dir.join(BOUNCER_KEY_PATH))
                .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        let mut bytes = Vec::new();
        file.take(MAX_SECRET_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        if bytes.len() as u64 > MAX_SECRET_BYTES {
            return Err(CrowdSecError::RuntimeUnavailable);
        }
        let value = String::from_utf8(bytes).map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        let key = SecretString::new(value.trim().to_owned());
        validate_api_key(&key).map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        Ok(key)
    }

    async fn probe_lapi(&self, api_url: &str, api_key: &SecretString) -> Result<(), CrowdSecError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let endpoint = Url::parse(api_url)
            .and_then(|url| url.join("v1/decisions?ip=192.0.2.1"))
            .map_err(|_| CrowdSecError::InvalidConfiguration)?;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|_| CrowdSecError::ConnectionFailed)?;
        let mut response = client
            .get(endpoint)
            .header("X-Api-Key", api_key.expose())
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| CrowdSecError::ConnectionFailed)?;
        if response.status() != StatusCode::OK
            || response
                .content_length()
                .is_some_and(|length| length > MAX_LAPI_RESPONSE_BYTES as u64)
        {
            return Err(CrowdSecError::ConnectionFailed);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| CrowdSecError::ConnectionFailed)?
        {
            if body.len().saturating_add(chunk.len()) > MAX_LAPI_RESPONSE_BYTES {
                return Err(CrowdSecError::ConnectionFailed);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice::<serde_json::Value>(&body)
            .map(|_| ())
            .map_err(|_| CrowdSecError::ConnectionFailed)
    }

    fn persist_crowdsec_configuration(
        &self,
        desired: &DesiredProvider,
    ) -> Result<(), CrowdSecError> {
        let persisted = PersistedConfiguration {
            version: 1,
            mode: desired.mode(),
            api_url: desired.api_url(),
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

    fn restore_crowdsec_configuration(&self) -> Option<DesiredProvider> {
        let bytes = state_dir(&self.settings.state_dir)
            .ok()?
            .read_file(ACTIVE_CROWDSEC_CONFIGURATION_FILE, 4_096)
            .ok()?;
        let persisted = serde_json::from_slice::<PersistedConfiguration>(&bytes).ok()?;
        if persisted.version != 1 {
            return None;
        }
        match persisted.mode {
            CrowdSecMode::Disabled if persisted.api_url.is_none() => {
                Some(DesiredProvider::Disabled)
            }
            CrowdSecMode::Managed if persisted.api_url.is_none() => Some(DesiredProvider::Managed),
            CrowdSecMode::External => normalize_api_url(persisted.api_url.as_deref()?)
                .ok()
                .map(|api_url| DesiredProvider::External { api_url }),
            CrowdSecMode::Disabled | CrowdSecMode::Managed => None,
        }
    }
}

fn normalize_api_url(value: &str) -> Result<String, CrowdSecError> {
    if value.is_empty() || value.len() > 2_048 || value != value.trim() {
        return Err(CrowdSecError::InvalidConfiguration);
    }
    let mut url = Url::parse(value).map_err(|_| CrowdSecError::InvalidConfiguration)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host().is_none()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(CrowdSecError::InvalidConfiguration);
    }
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url.to_string())
}

fn validate_api_key(value: &SecretString) -> Result<(), CrowdSecError> {
    let value = value.expose();
    if !(16..=512).contains(&value.len())
        || !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(CrowdSecError::InvalidConfiguration);
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/crowdsec.rs"]
mod tests;
