use super::{EngineEnvironment, ProxyRuntime};
use crate::models::{
    CrowdSecCommunityState, CrowdSecConsoleState, CrowdSecManagedEngineState, CrowdSecMode,
    SecretString,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};

mod configuration;
mod console;
mod provider;
mod status;
mod supervisor;

const MANAGED_API_URL: &str = "http://127.0.0.1:18080/";
const DESIRED_MODE_FILE: &str = "desired-mode";
const SUPERVISOR_STATUS_FILE: &str = "status.json";
const CONSOLE_ENROLLMENT_REQUEST_FILE: &str = "console-enrollment-request";
const CONSOLE_ENROLLMENT_RESULT_FILE: &str = "console-enrollment-result.json";
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
    Managed { community_enabled: bool },
    External { api_url: String },
}

impl DesiredProvider {
    fn mode(&self) -> CrowdSecMode {
        match self {
            Self::Disabled => CrowdSecMode::Disabled,
            Self::Managed { .. } => CrowdSecMode::Managed,
            Self::External { .. } => CrowdSecMode::External,
        }
    }

    fn api_url(&self) -> Option<String> {
        match self {
            Self::External { api_url } => Some(api_url.clone()),
            Self::Disabled | Self::Managed { .. } => None,
        }
    }

    fn community_enabled(&self) -> bool {
        matches!(
            self,
            Self::Managed {
                community_enabled: true
            }
        )
    }

    fn supervisor_mode(&self) -> &'static str {
        match self {
            Self::Managed {
                community_enabled: true,
            } => "managed-online",
            Self::Managed {
                community_enabled: false,
            } => "managed",
            Self::Disabled | Self::External { .. } => "stopped",
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

    pub(super) fn api_url(&self) -> Option<&str> {
        match self {
            Self::Disabled => None,
            Self::Managed { .. } => Some(MANAGED_API_URL),
            Self::External { api_url, .. } => Some(api_url),
        }
    }

    pub(super) fn api_key(&self) -> Option<&SecretString> {
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
    #[serde(default, skip_serializing_if = "is_false")]
    community_enabled: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
struct SupervisorStatus {
    state: SupervisorState,
    restarts: u8,
    #[serde(default = "disabled_community_state")]
    community: CrowdSecCommunityState,
    #[serde(default = "not_enrolled_console_state")]
    console: CrowdSecConsoleState,
}

fn disabled_community_state() -> CrowdSecCommunityState {
    CrowdSecCommunityState::Disabled
}

fn not_enrolled_console_state() -> CrowdSecConsoleState {
    CrowdSecConsoleState::NotEnrolled
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ConsoleEnrollmentResult {
    id: String,
    state: String,
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

fn validate_enrollment_key(value: &SecretString) -> Result<(), CrowdSecError> {
    let value = value.expose();
    if !(16..=256).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(CrowdSecError::InvalidConfiguration);
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/private/crowdsec.rs"]
mod tests;
