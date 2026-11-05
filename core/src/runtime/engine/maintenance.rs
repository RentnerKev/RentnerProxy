use super::{CaddyProcess, EngineError};
use tokio::time::Instant;

#[cfg(all(test, target_os = "linux"))]
#[path = "../../../tests/private/caddy_maintenance.rs"]
mod tests;

impl CaddyProcess {
    #[cfg(not(target_os = "linux"))]
    pub(super) async fn retain_owned_for_backup(
        &self,
        _deadline: Instant,
    ) -> Result<bool, EngineError> {
        Ok(false)
    }

    #[cfg(target_os = "linux")]
    pub(super) async fn retain_owned_for_backup(
        &self,
        deadline: Instant,
    ) -> Result<bool, EngineError> {
        self.retain_owned_for_backup_at(
            deadline,
            std::path::Path::new("/run/rentnerproxy/backups"),
            0,
        )
        .await
    }

    #[cfg(target_os = "linux")]
    async fn retain_owned_for_backup_at(
        &self,
        deadline: Instant,
        directory: &std::path::Path,
        authority_uid: u32,
    ) -> Result<bool, EngineError> {
        use std::{
            io::Write,
            os::unix::fs::{MetadataExt, OpenOptionsExt},
            sync::atomic::Ordering,
        };

        let Some(request) = read_request(directory, authority_uid)? else {
            return Ok(false);
        };
        self.stopping.store(true, Ordering::SeqCst);
        let mut slot = tokio::time::timeout_at(deadline, self.child.lock())
            .await
            .map_err(|_| EngineError::TimedOut)?;
        let pid = if let Some(child) = slot.as_mut() {
            if child
                .try_wait()
                .map_err(|_| EngineError::CommandFailed)?
                .is_none()
            {
                Some(child.id().ok_or(EngineError::CommandFailed)?)
            } else {
                None
            }
        } else {
            None
        };
        let start_ticks = pid.map(process_start_ticks).transpose()?;
        let receipt = Receipt {
            id: request.id,
            controller_pid: std::process::id(),
            caddy_pid: pid,
            caddy_start_ticks: start_ticks,
        };
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(directory.join("controller-maintenance-receipt.json"))
            .map_err(|_| EngineError::CommandFailed)?;
        let metadata = file.metadata().map_err(|_| EngineError::CommandFailed)?;
        // SAFETY: geteuid has no arguments or memory-safety preconditions.
        let controller_uid = unsafe { libc::geteuid() };
        // The root supervisor creates this one-use response inode. Its directory
        // is not writable by the controller, so it cannot redirect the handoff.
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != controller_uid
            || metadata.mode() & 0o7777 != 0o600
            || metadata.len() != 0
        {
            return Err(EngineError::CommandFailed);
        }
        let bytes = serde_json::to_vec(&receipt).map_err(|_| EngineError::CommandFailed)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| EngineError::CommandFailed)?;
        if let Some(child) = slot.take() {
            // Exit immediately after this handoff. The appliance's root supervisor
            // seals and verifies the PID/start-time receipt, keeps Caddy serving the
            // maintenance UI, and terminates it before starting the next controller.
            // Dropping Tokio's kill_on_drop handle here would destroy that channel.
            std::mem::forget(child);
        }
        Ok(true)
    }
}

#[cfg(target_os = "linux")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    id: String,
    controller_pid: u32,
    controller_start_ticks: String,
    expires_at: u64,
}

#[cfg(target_os = "linux")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    id: String,
    controller_pid: u32,
    caddy_pid: Option<u32>,
    caddy_start_ticks: Option<String>,
}

#[cfg(target_os = "linux")]
fn read_request(
    directory: &std::path::Path,
    authority_uid: u32,
) -> Result<Option<Request>, EngineError> {
    use std::{
        io::Read,
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    let parent = match std::fs::symlink_metadata(directory) {
        Ok(parent) => parent,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(EngineError::CommandFailed),
    };
    if !parent.is_dir() || parent.uid() != authority_uid || parent.mode() & 0o022 != 0 {
        return Err(EngineError::CommandFailed);
    }
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(directory.join("controller-maintenance-request.json"))
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(EngineError::CommandFailed),
    };
    let metadata = file.metadata().map_err(|_| EngineError::CommandFailed)?;
    if !metadata.is_file()
        || metadata.uid() != authority_uid
        || metadata.nlink() != 1
        || metadata.mode() & 0o7777 != 0o440
        || metadata.len() > 1024
    {
        return Err(EngineError::CommandFailed);
    }
    let mut bytes = Vec::new();
    file.take(1025)
        .read_to_end(&mut bytes)
        .map_err(|_| EngineError::CommandFailed)?;
    if bytes.len() > 1024 {
        return Err(EngineError::CommandFailed);
    }
    let request: Request =
        serde_json::from_slice(&bytes).map_err(|_| EngineError::CommandFailed)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| EngineError::CommandFailed)?
        .as_millis();
    let canonical_id = request.id.len() == 36
        && request.id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        });
    if !canonical_id
        || request.controller_pid != std::process::id()
        || request.controller_start_ticks != process_start_ticks(std::process::id())?
        || u128::from(request.expires_at) <= now
        || u128::from(request.expires_at) > now + 60_000
    {
        return Err(EngineError::CommandFailed);
    }
    Ok(Some(request))
}

#[cfg(target_os = "linux")]
fn process_start_ticks(pid: u32) -> Result<String, EngineError> {
    let value = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .map_err(|_| EngineError::CommandFailed)?;
    let ticks = value
        .rsplit_once(") ")
        .and_then(|(_, fields)| fields.split_whitespace().nth(19))
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or(EngineError::CommandFailed)?;
    Ok(ticks.to_owned())
}
