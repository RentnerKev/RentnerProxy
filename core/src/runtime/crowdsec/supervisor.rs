use super::{
    ActiveProvider, BOUNCER_KEY_PATH, CrowdSecError, DESIRED_MODE_FILE, DesiredProvider,
    MANAGED_API_URL, MAX_SECRET_BYTES, MAX_STATUS_BYTES, ProxyRuntime, SUPERVISOR_STATUS_FILE,
    SupervisorState, SupervisorStatus, validate_api_key,
};
use crate::{
    models::SecretString,
    runtime::state::{atomic_write, open_absolute_regular_file},
};
use std::{io::Read, time::Duration};
use tokio::time::{Instant, sleep};
use tracing::warn;

impl ProxyRuntime {
    pub(super) async fn prepare_managed_provider(
        &self,
        desired: &DesiredProvider,
    ) -> Result<ActiveProvider, CrowdSecError> {
        self.set_supervisor_mode(desired.supervisor_mode())?;
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

    pub(super) async fn rollback_managed_start(
        &self,
        previous_desired: &DesiredProvider,
        previous: &ActiveProvider,
        target: &ActiveProvider,
    ) {
        if !previous.is_managed() && target.is_managed() {
            self.stop_managed_best_effort().await;
        } else if previous.is_managed()
            && target.is_managed()
            && self
                .set_supervisor_mode(previous_desired.supervisor_mode())
                .is_err()
        {
            warn!(
                stage = "crowdsec_rollback",
                "CrowdSec supervisor mode could not be restored"
            );
        }
    }

    pub(super) async fn stop_managed_best_effort(&self) {
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

    pub(super) fn set_supervisor_mode(&self, mode: &str) -> Result<(), CrowdSecError> {
        if !matches!(mode, "managed" | "managed-online" | "stopped") {
            return Err(CrowdSecError::InvalidConfiguration);
        }
        atomic_write(
            &self.settings.crowdsec_control_dir.join(DESIRED_MODE_FILE),
            format!("{mode}\n").as_bytes(),
        )
        .map_err(|_| CrowdSecError::RuntimeUnavailable)
    }

    pub(super) fn read_supervisor_status(&self) -> Result<SupervisorStatus, CrowdSecError> {
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

    pub(super) fn read_managed_bouncer_key(&self) -> Result<SecretString, CrowdSecError> {
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
}
