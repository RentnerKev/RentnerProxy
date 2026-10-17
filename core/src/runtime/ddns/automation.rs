mod execution;
mod models;
mod persistence;
mod scheduling;

use super::validation;
use crate::{
    proxy::is_canonical_uuid_v7,
    runtime::dns_connections::{Consumer, ConsumerType, Reference, Store},
};
use models::*;
pub(crate) use models::{Action, AutomationError, SaveConfiguration};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{Mutex, MutexGuard, Notify};

#[cfg(test)]
#[path = "../../../tests/private/ddns/automation.rs"]
mod tests;

pub(crate) struct Automation {
    path: PathBuf,
    state: Mutex<Option<Document>>,
    io: Arc<Mutex<()>>,
    run: Mutex<()>,
    stopping: AtomicBool,
    active: AtomicBool,
    pub(super) wake: Notify,
}
impl Automation {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(None),
            io: Arc::new(Mutex::new(())),
            run: Mutex::new(()),
            stopping: AtomicBool::new(false),
            active: AtomicBool::new(false),
            wake: Notify::new(),
        }
    }
    pub(super) fn now() -> i64 {
        time::OffsetDateTime::now_utc()
            .unix_timestamp()
            .clamp(0, 253_402_214_399)
    }

    fn accepting(&self) -> Result<(), AutomationError> {
        if self.stopping.load(Ordering::SeqCst) {
            Err(AutomationError::Stopping)
        } else {
            Ok(())
        }
    }
    pub(crate) fn stop_accepting(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }
    fn references(value: &Document) -> Vec<Reference> {
        value
            .configuration
            .iter()
            .flat_map(|config| &config.settings.targets)
            .map(|target| Reference {
                connection_id: target.connection_id.clone(),
                zone_id: target.zone_id.clone(),
                consumer: Consumer {
                    r#type: ConsumerType::Ddns,
                    id: target.id.clone(),
                },
            })
            .collect()
    }
    async fn loaded<'a>(
        &self,
        guard: &'a mut MutexGuard<'_, Option<Document>>,
        connections: &Store,
        now: i64,
    ) -> Result<&'a mut Document, AutomationError> {
        if guard.is_none() {
            let (mut value, restored) = persistence::load(&self.path, &self.io).await?;
            if !self.active.load(Ordering::SeqCst) {
                scheduling::restart(&mut value, now, restored)?;
            }
            connections
                .ddns_references(&Self::references(&value), false, false)
                .await
                .map_err(|_| AutomationError::ConnectionUnavailable)?;
            persistence::save(&self.path, &self.io, &value).await?;
            **guard = Some(value);
        }
        guard.as_mut().ok_or(AutomationError::StoreUnavailable)
    }
    async fn commit(
        &self,
        guard: &mut MutexGuard<'_, Option<Document>>,
        value: Document,
    ) -> Result<(), AutomationError> {
        // A failed fsync may follow an atomic rename. Reload authoritative disk
        // state before admitting more work rather than trusting a stale cache.
        **guard = None;
        persistence::save(&self.path, &self.io, &value).await?;
        **guard = Some(value);
        Ok(())
    }
    pub(crate) async fn status(&self, connections: &Store) -> Result<Document, AutomationError> {
        self.status_at(connections, Self::now()).await
    }
    async fn status_at(&self, connections: &Store, now: i64) -> Result<Document, AutomationError> {
        let mut state = self.state.lock().await;
        Ok(self.loaded(&mut state, connections, now).await?.clone())
    }
    pub(crate) async fn save(
        &self,
        connections: &Store,
        request: SaveConfiguration,
    ) -> Result<Document, AutomationError> {
        self.save_at(connections, request, Self::now(), Outcome::Configured)
            .await
    }
    async fn save_at(
        &self,
        connections: &Store,
        request: SaveConfiguration,
        now: i64,
        outcome: Outcome,
    ) -> Result<Document, AutomationError> {
        persistence::validate(&request.configuration, &request.actor_user_id)?;
        let _run = self.run.try_lock().map_err(|_| AutomationError::Busy)?;
        self.accepting()?;
        let mut state = self.state.lock().await;
        let mut next = self.loaded(&mut state, connections, now).await?.clone();
        let old = next.configuration.clone();
        if old.as_ref().map_or(0, |config| config.revision) != request.expected_revision {
            return Err(AutomationError::Conflict);
        }
        scheduling::interrupt(&mut next, now)?;
        let metadata = connections
            .list()
            .await
            .map_err(|_| AutomationError::ConnectionUnavailable)?;
        for target in &request.configuration.targets {
            let zone = metadata
                .iter()
                .find(|connection| connection.id == target.connection_id)
                .and_then(|connection| {
                    connection
                        .zones
                        .iter()
                        .find(|zone| zone.id == target.zone_id)
                })
                .ok_or(AutomationError::ConnectionUnavailable)?;
            if !validation::in_zone(&target.name, &zone.name) {
                return Err(AutomationError::InvalidInput);
            }
        }
        let mut targets = Vec::with_capacity(request.configuration.targets.len());
        for target in &request.configuration.targets {
            let unchanged = old
                .as_ref()
                .is_some_and(|config| config.settings.targets.contains(target));
            let mut status = if unchanged {
                next.targets
                    .iter()
                    .find(|status| status.target_id == target.id)
                    .cloned()
                    .unwrap_or_else(|| TargetState::new(target))
            } else {
                TargetState::new(target)
            };
            let retry_after = (status.consecutive_failures > 0 && !status.permanent_failure)
                .then_some(status.retry_not_before)
                .flatten();
            status.permanent_failure = false;
            if retry_after.is_none() {
                status.consecutive_failures = 0;
                status.retry_not_before = None;
            }
            status.next_attempt_at = (request.configuration.enabled
                && scheduling::active(&request.configuration, target))
            .then(|| {
                let planned = if request.configuration.update_on_start {
                    now
                } else {
                    now + i64::from(request.configuration.interval_seconds)
                };
                planned
                    .max(retry_after.unwrap_or(0))
                    .max(next.provider_not_before.unwrap_or(0))
            });
            targets.push(status);
        }
        let enabling = request.configuration.enabled;
        next.configuration = Some(SavedConfiguration {
            revision: request
                .expected_revision
                .checked_add(1)
                .ok_or(AutomationError::Conflict)?,
            updated_by_user_id: request.actor_user_id.clone(),
            settings: request.configuration,
        });
        next.targets = targets;
        if enabling {
            next.restore_paused = false;
        }
        scheduling::event(
            &mut next,
            now,
            outcome,
            Some(request.actor_user_id),
            None,
            0,
            0,
        )?;
        let references = Self::references(&next);
        connections
            .ddns_references(&references, true, true)
            .await
            .map_err(|_| AutomationError::ConnectionUnavailable)?;
        self.commit(&mut state, next.clone()).await?;
        if enabling && let Err(error) = persistence::acknowledge_restore(&self.path, &self.io).await
        {
            *state = None;
            return Err(error);
        }
        if connections
            .ddns_references(&references, false, false)
            .await
            .is_err()
        {
            *state = None;
            return Err(AutomationError::ConnectionUnavailable);
        }
        self.wake.notify_one();
        Ok(next)
    }
    pub(crate) async fn enable(
        &self,
        connections: &Store,
        action: Action,
    ) -> Result<Document, AutomationError> {
        let current = self.status(connections).await?;
        let mut settings = current
            .configuration
            .ok_or(AutomationError::Disabled)?
            .settings;
        settings.enabled = true;
        self.save_at(
            connections,
            SaveConfiguration {
                expected_revision: action.expected_revision,
                actor_user_id: action.actor_user_id,
                configuration: settings,
            },
            Self::now(),
            Outcome::Enabled,
        )
        .await
    }
    pub(crate) async fn disable(
        &self,
        connections: &Store,
        action: Action,
    ) -> Result<Document, AutomationError> {
        self.disable_at(connections, action, Self::now()).await
    }
    async fn disable_at(
        &self,
        connections: &Store,
        action: Action,
        now: i64,
    ) -> Result<Document, AutomationError> {
        if !is_canonical_uuid_v7(&action.actor_user_id) {
            return Err(AutomationError::InvalidInput);
        }
        let mut state = self.state.lock().await;
        let mut next = self.loaded(&mut state, connections, now).await?.clone();
        let config = next
            .configuration
            .as_mut()
            .ok_or(AutomationError::Disabled)?;
        if config.revision != action.expected_revision {
            return Err(AutomationError::Conflict);
        }
        config.revision = config
            .revision
            .checked_add(1)
            .ok_or(AutomationError::Conflict)?;
        config.updated_by_user_id = action.actor_user_id.clone();
        config.settings.enabled = false;
        for status in &mut next.targets {
            status.next_attempt_at = None;
        }
        scheduling::event(
            &mut next,
            now,
            Outcome::Disabled,
            Some(action.actor_user_id),
            None,
            0,
            0,
        )?;
        self.commit(&mut state, next.clone()).await?;
        self.wake.notify_one();
        Ok(next)
    }
}

struct ActiveRun<'a>(&'a AtomicBool);
impl<'a> ActiveRun<'a> {
    fn new(active: &'a AtomicBool) -> Self {
        active.store(true, Ordering::SeqCst);
        Self(active)
    }
}
impl Drop for ActiveRun<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
