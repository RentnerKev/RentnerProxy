use super::models::*;
use crate::runtime::ddns::models::{BatchResult, Error, RecordType, Status, Target, TargetResult};

pub(super) fn active(config: &Configuration, target: &Target) -> bool {
    target.enabled
        && match target.record_type {
            RecordType::A => config.ipv4,
            RecordType::Aaaa => config.ipv6,
        }
}

pub(super) fn configured_target(
    value: &Document,
    config: &Configuration,
    target: &Target,
    now: i64,
) -> TargetState {
    let old = value.configuration.as_ref().map(|saved| &saved.settings);
    let previous = old.and_then(|settings| {
        settings.targets.iter().find(|previous| {
            previous.id == target.id
                && previous.connection_id == target.connection_id
                && previous.zone_id == target.zone_id
                && previous.name == target.name
                && previous.record_type == target.record_type
                && previous.selection == target.selection
        })
    });
    let mut status = previous
        .and_then(|_| {
            value
                .targets
                .iter()
                .find(|state| state.target_id == target.id)
        })
        .cloned()
        .unwrap_or_else(|| TargetState::new(target));
    let rearm = previous.is_none_or(|previous| {
        config.enabled
            && active(config, target)
            && (previous.proxied != target.proxied
                || old.is_none_or(|old| !old.enabled || !active(old, previous)))
    });
    let retry_after = (status.consecutive_failures > 0 && !status.permanent_failure)
        .then_some(status.retry_not_before)
        .flatten();
    if rearm {
        status.permanent_failure = false;
        if retry_after.is_none() {
            status.consecutive_failures = 0;
            status.retry_not_before = None;
        }
    }
    let interval_changed = old.is_some_and(|old| old.interval_seconds != config.interval_seconds);
    let startup_enabled = old.is_some_and(|old| !old.update_on_start && config.update_on_start);
    if !config.enabled || !active(config, target) {
        status.next_attempt_at = None;
    } else if rearm || (!status.permanent_failure && (interval_changed || startup_enabled)) {
        let planned = if !rearm && status.consecutive_failures > 0 {
            status.next_attempt_at.or(retry_after).unwrap_or(now)
        } else if config.update_on_start && (rearm || startup_enabled) {
            now
        } else {
            now + i64::from(config.interval_seconds)
        };
        status.next_attempt_at = Some(
            planned
                .max(retry_after.unwrap_or(0))
                .max(value.provider_not_before.unwrap_or(0)),
        );
    }
    status
}

pub(super) fn event(
    value: &mut Document,
    at: i64,
    outcome: Outcome,
    actor: Option<String>,
    trigger: Option<Trigger>,
    updated: u32,
    failed: u32,
) -> Result<(), AutomationError> {
    value.event_sequence = value
        .event_sequence
        .checked_add(1)
        .ok_or(AutomationError::StoreUnavailable)?;
    value.events.push(Event {
        sequence: value.event_sequence,
        at,
        actor_user_id: actor,
        trigger,
        outcome,
        updated,
        failed,
    });
    if value.events.len() > 64 {
        value.events.remove(0);
    }
    Ok(())
}

pub(super) fn delay(id: &str, failures: u32) -> i64 {
    let base = (30_i64 << failures.saturating_sub(1).min(5)).min(900);
    let hash = id.bytes().fold(failures.min(32), |n, byte| {
        n.wrapping_mul(31).wrapping_add(u32::from(byte))
    });
    (base + i64::from(hash % 7)).min(900)
}

pub(super) fn interrupt(value: &mut Document, now: i64) -> Result<bool, AutomationError> {
    let Some(run) = value.in_flight.take() else {
        return Ok(false);
    };
    for state in &mut value.targets {
        if !run.target_ids.contains(&state.target_id) {
            continue;
        }
        state.consecutive_failures = state.consecutive_failures.saturating_add(1).min(32);
        state.permanent_failure = false;
        state.last_result = Some(TargetResult {
            target_id: state.target_id.clone(),
            status: Status::Failed,
            current: None,
            desired_address: None,
            error: Some(Error::RunInterrupted),
            retry_after_seconds: None,
        });
        state.retry_not_before = Some(
            (now + delay(&state.target_id, state.consecutive_failures))
                .max(value.provider_not_before.unwrap_or(0)),
        );
        state.next_attempt_at = value
            .configuration
            .as_ref()
            .filter(|c| c.settings.enabled)
            .map(|_| state.retry_not_before.unwrap_or(now));
    }
    value.last_run = Some(RunSummary {
        started_at: run.started_at,
        finished_at: now,
        actor_user_id: run.actor_user_id.clone(),
        trigger: run.trigger,
        outcome: Outcome::Interrupted,
        updated: 0,
        failed: run.target_ids.len() as u32,
    });
    event(
        value,
        now,
        Outcome::Interrupted,
        Some(run.actor_user_id),
        Some(run.trigger),
        0,
        run.target_ids.len() as u32,
    )?;
    Ok(true)
}

pub(super) fn restart(
    value: &mut Document,
    now: i64,
    restored: bool,
) -> Result<(), AutomationError> {
    if restored || value.restore_paused {
        value.restore_paused = true;
        if let Some(config) = &mut value.configuration
            && config.settings.enabled
        {
            config.settings.enabled = false;
            config.revision = config
                .revision
                .checked_add(1)
                .ok_or(AutomationError::StoreUnavailable)?;
        }
        if restored
            && !value
                .events
                .last()
                .is_some_and(|event| event.outcome == Outcome::RestorePaused)
        {
            event(value, now, Outcome::RestorePaused, None, None, 0, 0)?;
        }
    }
    let interrupted = interrupt(value, now)?;
    if let Some(config) = &value.configuration {
        for state in &mut value.targets {
            let active = config
                .settings
                .targets
                .iter()
                .any(|target| target.id == state.target_id && active(&config.settings, target));
            if !config.settings.enabled || !active {
                state.next_attempt_at = None;
            } else if !interrupted
                && config.settings.update_on_start
                && state.consecutive_failures == 0
                && !state.permanent_failure
            {
                state.next_attempt_at = Some(now.max(value.provider_not_before.unwrap_or(0)));
            }
        }
    }
    Ok(())
}

pub(super) fn complete(
    value: &mut Document,
    result: &BatchResult,
    now: i64,
) -> Result<(), AutomationError> {
    let run = value
        .in_flight
        .take()
        .ok_or(AutomationError::StoreUnavailable)?;
    let config = value
        .configuration
        .as_ref()
        .ok_or(AutomationError::StoreUnavailable)?;
    let mut updated = 0;
    let mut failed = 0;
    for result in &result.targets {
        let state = value
            .targets
            .iter_mut()
            .find(|state| state.target_id == result.target_id)
            .ok_or(AutomationError::StoreUnavailable)?;
        state.last_result = Some(result.clone());
        if matches!(result.status, Status::Updated | Status::Unchanged) {
            let current = result
                .current
                .as_ref()
                .ok_or(AutomationError::StoreUnavailable)?;
            state.last_success_at = Some(now);
            state.last_successful_address = Some(current.address);
            state.last_successful_proxied = Some(current.proxied);
            state.consecutive_failures = 0;
            state.permanent_failure = false;
            state.retry_not_before = None;
            state.next_attempt_at = config
                .settings
                .enabled
                .then_some(now + i64::from(config.settings.interval_seconds));
            updated += u32::from(result.status == Status::Updated);
        } else {
            failed += 1;
            state.consecutive_failures = state.consecutive_failures.saturating_add(1).min(32);
            state.permanent_failure = result.error.is_some_and(|error| !transient(error));
            if result.error == Some(Error::ProviderRateLimited)
                || (result.error == Some(Error::ProviderUnavailable)
                    && result.retry_after_seconds.is_some())
            {
                let until = now + i64::from(result.retry_after_seconds.unwrap_or(1));
                if until >= value.provider_not_before.unwrap_or(0) {
                    value.provider_pause_reason = result.error;
                }
                value.provider_not_before = Some(value.provider_not_before.unwrap_or(0).max(until));
            }
            state.retry_not_before = (!state.permanent_failure).then(|| {
                (now + delay(&state.target_id, state.consecutive_failures))
                    .max(now + i64::from(result.retry_after_seconds.unwrap_or(0)))
                    .max(value.provider_not_before.unwrap_or(0))
            });
            state.next_attempt_at = config
                .settings
                .enabled
                .then_some(state.retry_not_before)
                .flatten();
        }
    }
    // A provider-wide cooldown also fences targets which succeeded earlier in
    // this batch, and survives restarts and explicit configuration edits.
    if let Some(until) = value.provider_not_before {
        for state in &mut value.targets {
            state.next_attempt_at = state.next_attempt_at.map(|at| at.max(until));
        }
    }
    value.manual_not_before = Some(now + 5);
    value.last_run = Some(RunSummary {
        started_at: run.started_at,
        finished_at: now,
        actor_user_id: run.actor_user_id.clone(),
        trigger: run.trigger,
        outcome: if failed == 0 {
            Outcome::Completed
        } else {
            Outcome::PartialFailure
        },
        updated,
        failed,
    });
    event(
        value,
        now,
        if failed == 0 {
            Outcome::Completed
        } else {
            Outcome::PartialFailure
        },
        Some(run.actor_user_id),
        Some(run.trigger),
        updated,
        failed,
    )
}
