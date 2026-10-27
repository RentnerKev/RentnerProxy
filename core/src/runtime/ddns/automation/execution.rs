use super::{
    Action, ActiveRun, Automation, AutomationError,
    models::{InFlight, Trigger},
    scheduling,
};
use crate::{
    proxy::is_canonical_uuid_v7,
    runtime::{
        ddns::{
            Engine,
            models::{BatchResult, Error, Request, Selection, Status, TargetResult},
            validation,
        },
        dns_connections::Store,
    },
};
use std::time::Duration;

impl Automation {
    pub(crate) async fn manual(
        &self,
        connections: &Store,
        engine: &Engine,
        action: Action,
    ) -> Result<BatchResult, AutomationError> {
        self.run_at(connections, engine, Some(action), Self::now())
            .await?
            .ok_or(AutomationError::RetryDeferred)
    }
    pub(in crate::runtime::ddns) async fn tick(
        &self,
        connections: &Store,
        engine: &Engine,
    ) -> Result<(), AutomationError> {
        self.run_at(connections, engine, None, Self::now())
            .await
            .map(|_| ())
    }
    pub(super) async fn run_at(
        &self,
        connections: &Store,
        engine: &Engine,
        action: Option<Action>,
        now: i64,
    ) -> Result<Option<BatchResult>, AutomationError> {
        let _run = self.run.try_lock().map_err(|_| AutomationError::Busy)?;
        self.accepting()?;
        let started = tokio::time::Instant::now();
        let mut state = self.state.lock().await;
        let mut next = self.loaded(&mut state, connections, now).await?.clone();
        if scheduling::interrupt(&mut next, now)? {
            self.commit(&mut state, next.clone()).await?;
        }
        let config = next.configuration.as_ref();
        if let Some(action) = &action {
            if !is_canonical_uuid_v7(&action.actor_user_id) {
                return Err(AutomationError::InvalidInput);
            }
            if config.map_or(0, |config| config.revision) != action.expected_revision {
                return Err(AutomationError::Conflict);
            }
        }
        if next.restore_paused {
            return if action.is_some() {
                Err(AutomationError::RestorePaused)
            } else {
                Ok(None)
            };
        }
        let Some(config) = config.filter(|config| config.settings.enabled).cloned() else {
            return if action.is_some() {
                Err(AutomationError::Disabled)
            } else {
                Ok(None)
            };
        };
        if next.provider_not_before.is_some_and(|at| at > now)
            || (action.is_some() && next.manual_not_before.is_some_and(|at| at > now))
        {
            return if action.is_some() {
                Err(AutomationError::RetryDeferred)
            } else {
                Ok(None)
            };
        }
        let connections_metadata = connections
            .list()
            .await
            .map_err(|_| AutomationError::ConnectionUnavailable)?;
        let mut selected = vec![];
        for target in &config.settings.targets {
            let status = next
                .targets
                .iter_mut()
                .find(|state| state.target_id == target.id)
                .ok_or(AutomationError::StoreUnavailable)?;
            if !scheduling::active(&config.settings, target) {
                continue;
            }
            let revision = connections_metadata
                .iter()
                .find(|connection| connection.id == target.connection_id)
                .map(|connection| connection.revision);
            if status.permanent_failure && revision != status.connection_revision {
                status.permanent_failure = false;
                status.consecutive_failures = 0;
                status.retry_not_before = None;
                status.next_attempt_at = Some(now);
            }
            let eligible = if action.is_some() {
                status.retry_not_before.is_none_or(|at| at <= now)
            } else {
                !status.permanent_failure && status.next_attempt_at.is_some_and(|at| at <= now)
            };
            if eligible {
                status.connection_revision = revision;
                status.last_attempt_at = Some(now);
                let mut selected_target = target.clone();
                // deSEC has no ownership comments. Reuse only the exact record
                // acknowledged by a durably committed successful run for this
                // unchanged target identity; configuration edits reset its state.
                if matches!(target.selection, Selection::Create)
                    && connections_metadata.iter().any(|connection| {
                        connection.id == target.connection_id && connection.provider == "desec"
                    })
                    && let Some(record_id) = status.created_record_id.as_ref()
                {
                    selected_target.selection = Selection::Adopt {
                        record_id: record_id.clone(),
                    };
                }
                selected.push(selected_target);
            }
        }
        if selected.is_empty() {
            return if action.is_some() {
                Err(AutomationError::RetryDeferred)
            } else {
                Ok(None)
            };
        }
        let actor = action.as_ref().map_or_else(
            || config.updated_by_user_id.clone(),
            |action| action.actor_user_id.clone(),
        );
        let trigger = if action.is_some() {
            Trigger::Manual
        } else {
            Trigger::Scheduled
        };
        next.in_flight = Some(InFlight {
            started_at: now,
            actor_user_id: actor.clone(),
            trigger,
            target_ids: selected.iter().map(|target| target.id.clone()).collect(),
        });
        next.manual_not_before = Some(now + 5);
        let _active = ActiveRun::new(&self.active);
        self.commit(&mut state, next).await?;
        drop(state);
        // Reconcile durable state while retaining provider feedback whose
        // previous commit was cancelled or failed.
        engine
            .cooldown(None)
            .await
            .map_err(|_| AutomationError::Busy)?;
        let request = Request {
            actor_user_id: actor,
            ipv4: config.settings.ipv4,
            ipv6: config.settings.ipv6,
            targets: selected,
        };
        let result = match engine
            .execute(
                connections,
                Request {
                    actor_user_id: request.actor_user_id.clone(),
                    ipv4: request.ipv4,
                    ipv6: request.ipv6,
                    targets: request.targets.clone(),
                },
                false,
            )
            .await
        {
            Ok(result) => result,
            Err(error) => BatchResult {
                preview: false,
                ipv4: None,
                ipv6: None,
                targets: request
                    .targets
                    .iter()
                    .map(|target| TargetResult::failed(target, error))
                    .collect(),
            },
        };
        let mut state = self.state.lock().await;
        let finished_at = now + started.elapsed().as_secs() as i64;
        let mut next = self
            .loaded(&mut state, connections, finished_at)
            .await?
            .clone();
        scheduling::complete(&mut next, &result, finished_at)?;
        for target in &config.settings.targets {
            if !matches!(target.selection, Selection::Create)
                || !connections_metadata.iter().any(|connection| {
                    connection.id == target.connection_id && connection.provider == "desec"
                })
                || !next.configuration.as_ref().is_some_and(|saved| {
                    saved
                        .settings
                        .targets
                        .iter()
                        .any(|saved_target| saved_target == target)
                })
            {
                continue;
            }
            if let Some(success) = result.targets.iter().find(|result| {
                result.target_id == target.id
                    && matches!(result.status, Status::Updated | Status::Unchanged)
                    && result.error.is_none()
            }) && let Some(current) = &success.current
                && let Some(state) = next
                    .targets
                    .iter_mut()
                    .find(|state| state.target_id == target.id)
            {
                state.created_record_id = Some(current.id.clone());
            }
        }
        self.commit(&mut state, next).await?;
        engine.mark_cooldown_persisted();
        Ok(Some(result))
    }
    pub(crate) async fn preview(
        &self,
        connections: &Store,
        engine: &Engine,
        request: Request,
    ) -> Result<BatchResult, AutomationError> {
        validation::request(&request).map_err(|_| AutomationError::InvalidInput)?;
        let _run = self.run.try_lock().map_err(|_| AutomationError::Busy)?;
        self.accepting()?;
        let now = Self::now();
        let snapshot = self.status_at(connections, now).await?;
        let cooldown = snapshot
            .provider_not_before
            .filter(|at| *at > now)
            .map(|at| {
                (
                    Duration::from_secs((at - now) as u64),
                    snapshot
                        .provider_pause_reason
                        .unwrap_or(Error::ProviderRateLimited),
                )
            });
        engine
            .cooldown(cooldown)
            .await
            .map_err(|_| AutomationError::Busy)?;
        let result =
            engine
                .execute(connections, request, true)
                .await
                .map_err(|error| match error {
                    Error::InvalidInput => AutomationError::InvalidInput,
                    Error::Busy => AutomationError::Busy,
                    _ => AutomationError::ConnectionUnavailable,
                })?;
        if let Some((seconds, reason)) = result
            .targets
            .iter()
            .filter(|target| matches!(target.status, Status::Failed | Status::Skipped))
            .filter_map(TargetResult::provider_cooldown)
            .max_by_key(|(seconds, _)| *seconds)
        {
            let mut state = self.state.lock().await;
            let now = Self::now();
            let mut next = self.loaded(&mut state, connections, now).await?.clone();
            let until = now + i64::from(seconds);
            if until >= next.provider_not_before.unwrap_or(0) {
                next.provider_pause_reason = Some(reason);
            }
            next.provider_not_before = Some(next.provider_not_before.unwrap_or(0).max(until));
            for target in &mut next.targets {
                target.next_attempt_at = target.next_attempt_at.map(|at| at.max(until));
            }
            self.commit(&mut state, next).await?;
            engine.mark_cooldown_persisted();
        }
        Ok(result)
    }
}
