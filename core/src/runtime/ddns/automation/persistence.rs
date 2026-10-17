use super::{models::*, scheduling};
use crate::{
    proxy::is_canonical_uuid_v7,
    runtime::{
        ddns::{models::Request, validation},
        state::state_dir,
    },
};
use std::{path::Path, sync::Arc};
use tokio::sync::Mutex;

pub(super) const FILE: &str = "ddns-automation.json";
pub(super) const RESTORE_PAUSE: &str = "ddns-restore-paused";
const MAX_BYTES: usize = 1024 * 1024;

pub(super) fn validate(configuration: &Configuration, actor: &str) -> Result<(), AutomationError> {
    if !is_canonical_uuid_v7(actor)
        || !(60..=86_400).contains(&configuration.interval_seconds)
        || configuration.targets.len() > 100
        || (configuration.enabled && configuration.targets.is_empty())
        || (configuration.enabled
            && configuration.targets.iter().any(|target| {
                scheduling::active(configuration, target)
                    && matches!(
                        target.selection,
                        crate::runtime::ddns::models::Selection::Inspect
                    )
            }))
    {
        return Err(AutomationError::InvalidInput);
    }
    if !configuration.targets.is_empty() {
        validation::request(&Request {
            actor_user_id: actor.into(),
            ipv4: configuration.ipv4,
            ipv6: configuration.ipv6,
            targets: configuration.targets.clone(),
        })
        .map_err(|_| AutomationError::InvalidInput)?;
    }
    Ok(())
}

fn timestamp(value: Option<i64>) -> bool {
    value.is_none_or(|value| (0..=253_402_300_799).contains(&value))
}
fn document(value: &Document) -> Result<(), AutomationError> {
    let valid = || -> Option<()> {
        if value.version != 1
            || value.events.len() > 64
            || !timestamp(value.provider_not_before)
            || !timestamp(value.manual_not_before)
            || value.provider_pause_reason.is_some_and(|reason| {
                !matches!(
                    reason,
                    crate::runtime::ddns::models::Error::ProviderRateLimited
                        | crate::runtime::ddns::models::Error::ProviderUnavailable
                )
            })
        {
            return None;
        }
        let targets = if let Some(config) = &value.configuration {
            validate(&config.settings, &config.updated_by_user_id).ok()?;
            if config.revision == 0 {
                return None;
            }
            &config.settings.targets[..]
        } else {
            &[]
        };
        if targets.len() != value.targets.len() {
            return None;
        }
        let mut seen = std::collections::BTreeSet::new();
        for state in &value.targets {
            let target = targets.iter().find(|target| target.id == state.target_id)?;
            if !seen.insert(&state.target_id)
                || state.consecutive_failures > 32
                || !timestamp(state.last_attempt_at)
                || !timestamp(state.last_success_at)
                || !timestamp(state.next_attempt_at)
                || !timestamp(state.retry_not_before)
                || state.connection_revision == Some(0)
                || state.last_successful_address.is_some_and(|address| {
                    !target.record_type.matches(address) || !validation::public(address)
                })
                || state.last_success_at.is_some() != state.last_successful_address.is_some()
                || state.last_success_at.is_some() != state.last_successful_proxied.is_some()
            {
                return None;
            }
            if let Some(result) = &state.last_result
                && (result.target_id != target.id
                    || result
                        .retry_after_seconds
                        .is_some_and(|seconds| !(1..=86_400).contains(&seconds))
                    || result.desired_address.is_some_and(|address| {
                        !target.record_type.matches(address) || !validation::public(address)
                    })
                    || result.current.as_ref().is_some_and(|record| {
                        !validation::provider_id(&record.id)
                            || !target.record_type.matches(record.address)
                    }))
            {
                return None;
            }
        }
        if let Some(run) = &value.in_flight
            && (!timestamp(Some(run.started_at))
                || !is_canonical_uuid_v7(&run.actor_user_id)
                || run.target_ids.is_empty()
                || run.target_ids.len() > 100
                || run
                    .target_ids
                    .iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
                    != run.target_ids.len()
                || run
                    .target_ids
                    .iter()
                    .any(|id| !targets.iter().any(|target| &target.id == id)))
        {
            return None;
        }
        let mut previous = 0;
        if let Some(run) = &value.last_run
            && (!timestamp(Some(run.started_at))
                || !timestamp(Some(run.finished_at))
                || !is_canonical_uuid_v7(&run.actor_user_id)
                || run.updated > 100
                || run.failed > 100
                || !matches!(
                    run.outcome,
                    Outcome::Completed | Outcome::PartialFailure | Outcome::Interrupted
                ))
        {
            return None;
        }
        for event in &value.events {
            if event.sequence <= previous
                || event.sequence > value.event_sequence
                || !timestamp(Some(event.at))
                || event.updated > 100
                || event.failed > 100
                || event
                    .actor_user_id
                    .as_ref()
                    .is_some_and(|actor| !is_canonical_uuid_v7(actor))
            {
                return None;
            }
            previous = event.sequence;
        }
        Some(())
    };
    valid().ok_or(AutomationError::StoreUnavailable)
}

pub(super) async fn load(
    path: &Path,
    io: &Arc<Mutex<()>>,
) -> Result<(Document, bool), AutomationError> {
    let path = path.to_owned();
    let guard = Arc::clone(io).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let dir = state_dir(&path).map_err(|_| AutomationError::StoreUnavailable)?;
        let value = match dir.read_file(FILE, MAX_BYTES) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|_| AutomationError::StoreUnavailable)?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Document::default(),
            Err(_) => return Err(AutomationError::StoreUnavailable),
        };
        document(&value)?;
        let restored = match dir.read_file(RESTORE_PAUSE, 64) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(AutomationError::StoreUnavailable),
        };
        Ok((value, restored))
    })
    .await
    .map_err(|_| AutomationError::StoreUnavailable)?
}

pub(super) async fn save(
    path: &Path,
    io: &Arc<Mutex<()>>,
    value: &Document,
) -> Result<(), AutomationError> {
    document(value)?;
    let bytes = serde_json::to_vec(value).map_err(|_| AutomationError::StoreUnavailable)?;
    if bytes.len() > MAX_BYTES {
        return Err(AutomationError::StoreUnavailable);
    }
    let path = path.to_owned();
    // Keep the I/O gate inside non-cancellable work even if its HTTP caller
    // disconnects, so a later load/write cannot overtake an atomic replacement.
    let guard = Arc::clone(io).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        state_dir(&path)
            .and_then(|dir| dir.atomic_write(FILE, &bytes))
            .map_err(|_| AutomationError::StoreUnavailable)
    })
    .await
    .map_err(|_| AutomationError::StoreUnavailable)?
}

pub(super) async fn acknowledge_restore(
    path: &Path,
    io: &Arc<Mutex<()>>,
) -> Result<(), AutomationError> {
    let path = path.to_owned();
    let guard = Arc::clone(io).lock_owned().await;
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        state_dir(&path)
            .and_then(|dir| dir.remove_file(RESTORE_PAUSE))
            .map_err(|_| AutomationError::StoreUnavailable)
    })
    .await
    .map_err(|_| AutomationError::StoreUnavailable)?
}
