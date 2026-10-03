use super::{
    CONSOLE_ENROLLMENT_REQUEST_FILE, CONSOLE_ENROLLMENT_RESULT_FILE, ConsoleEnrollmentResult,
    CrowdSecError, MAX_STATUS_BYTES, ProxyRuntime, SupervisorState, validate_enrollment_key,
};
use crate::{
    models::{CrowdSecCommunityState, CrowdSecConsoleState, SecretString},
    runtime::state::{atomic_write, open_absolute_regular_file},
};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use std::{fs, io::Read, sync::atomic::Ordering, time::Duration};
use tokio::time::{Instant, sleep, timeout};

impl ProxyRuntime {
    pub(crate) async fn enroll_crowdsec_console(
        &self,
        enrollment_key: &SecretString,
    ) -> Result<(), CrowdSecError> {
        validate_enrollment_key(enrollment_key)?;
        let _guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| CrowdSecError::Busy)?;
        if self.stopping.load(Ordering::SeqCst) {
            return Err(CrowdSecError::RuntimeUnavailable);
        }
        let state = self.crowdsec.lock().await;
        if !state.desired.community_enabled() || !state.active.is_managed() {
            return Err(CrowdSecError::InvalidConfiguration);
        }
        drop(state);
        let status = self.read_supervisor_status()?;
        if status.state != SupervisorState::Ready
            || status.community != CrowdSecCommunityState::Connected
        {
            return Err(CrowdSecError::InvalidConfiguration);
        }
        if status.console != CrowdSecConsoleState::NotEnrolled
            && status.console != CrowdSecConsoleState::Degraded
        {
            return Err(CrowdSecError::InvalidConfiguration);
        }

        let mut nonce = [0u8; 16];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        let id = nonce
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let request_path = self
            .settings
            .crowdsec_control_dir
            .join(CONSOLE_ENROLLMENT_REQUEST_FILE);
        let result_path = self
            .settings
            .crowdsec_control_dir
            .join(CONSOLE_ENROLLMENT_RESULT_FILE);
        if request_path.exists() {
            return Err(CrowdSecError::Busy);
        }
        if result_path.exists() {
            fs::remove_file(&result_path).map_err(|_| CrowdSecError::RuntimeUnavailable)?;
        }
        atomic_write(
            &request_path,
            format!("{id}\n{}\n", enrollment_key.expose()).as_bytes(),
        )
        .map_err(|_| CrowdSecError::RuntimeUnavailable)?;

        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            if let Ok(file) = open_absolute_regular_file(&result_path) {
                let mut bytes = Vec::new();
                file.take(MAX_STATUS_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
                if bytes.len() as u64 > MAX_STATUS_BYTES {
                    return Err(CrowdSecError::RuntimeUnavailable);
                }
                let result = serde_json::from_slice::<ConsoleEnrollmentResult>(&bytes)
                    .map_err(|_| CrowdSecError::RuntimeUnavailable)?;
                if result.id == id {
                    return if result.state == "pending" {
                        Ok(())
                    } else {
                        Err(CrowdSecError::ConnectionFailed)
                    };
                }
            }
            if Instant::now() >= deadline {
                let _ = fs::remove_file(&request_path);
                return Err(CrowdSecError::ConnectionFailed);
            }
            sleep(Duration::from_millis(200)).await;
        }
    }
}
