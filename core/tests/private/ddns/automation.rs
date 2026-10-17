#[path = "automation_http.rs"]
mod http;
use super::super::fixture::*;
use super::*;
use crate::runtime::{
    ProxyRuntime, RuntimeSettings,
    ddns::{
        Engine,
        models::{BatchResult, Error, RecordType, Selection, Status},
    },
};
use axum::http::StatusCode;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::time::Duration;

const NOW: i64 = 1_900_000_000;

#[tokio::test]
async fn editing_one_target_preserves_other_targets_due_times() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    let config = |revision| {
        let mut request = settings(revision, true, true);
        request.configuration.targets.push(target(
            11,
            "other.example.com",
            RecordType::A,
            Selection::Create,
        ));
        request
    };
    configure(&automation, &fixture, config(0)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let mut changed = config(1);
    changed.configuration.targets[1].proxied = false;
    let state = automation
        .save_at(&fixture.store, changed, NOW + 10, Outcome::Configured)
        .await
        .unwrap();
    assert_eq!(state.targets[0].next_attempt_at, Some(NOW + 300));
    assert_eq!(state.targets[1].next_attempt_at, Some(NOW + 10));
    let run = tick(&automation, &fixture, NOW + 10).await.unwrap();
    assert_eq!(run.targets.len(), 1);
    assert_eq!(run.targets[0].target_id, state.targets[1].target_id);
}

#[tokio::test]
async fn unrelated_edits_do_not_rearm_permanent_failures_or_starve_a_running_schedule() {
    let fixture = Fixture::new(vec![record(
        '1',
        'a',
        "example.com",
        "CNAME",
        "elsewhere.example.org",
    )])
    .await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let mut request = settings(1, true, true);
    request.configuration.targets.push(target(
        11,
        "other.example.com",
        RecordType::A,
        Selection::Create,
    ));
    let state = automation
        .save_at(&fixture.store, request, NOW + 10, Outcome::Configured)
        .await
        .unwrap();
    assert!(state.targets[0].permanent_failure);
    assert_eq!(state.targets[0].next_attempt_at, None);
    let run = tick(&automation, &fixture, NOW + 10).await.unwrap();
    assert_eq!(run.targets.len(), 1);
}

#[tokio::test]
async fn target_pause_survives_restart_and_retains_last_good_values_and_connection_reference() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let mut pause = settings(1, true, true);
    pause.configuration.targets[0].enabled = false;
    let paused = automation
        .save_at(&fixture.store, pause, NOW + 1, Outcome::Configured)
        .await
        .unwrap();
    assert_eq!(paused.targets[0].last_success_at, Some(NOW));
    assert!(paused.targets[0].last_successful_address.is_some());
    assert_eq!(paused.targets[0].next_attempt_at, None);
    assert_eq!(fixture.store.list().await.unwrap()[0].references.len(), 1);
    let restarted = Automation::new(fixture.path.clone());
    assert!(tick(&restarted, &fixture, NOW + 1000).await.is_none());
    let state = restarted
        .status_at(&fixture.store, NOW + 1000)
        .await
        .unwrap();
    assert!(!state.configuration.unwrap().settings.targets[0].enabled);
    assert_eq!(state.targets[0].last_success_at, Some(NOW));
    restarted
        .save_at(
            &fixture.store,
            settings(2, true, true),
            NOW + 1001,
            Outcome::Configured,
        )
        .await
        .unwrap();
    assert_eq!(
        tick(&restarted, &fixture, NOW + 1001)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Unchanged
    );
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn per_target_toggles_and_proxy_edits_cannot_bypass_transient_retry_deadlines() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().status = StatusCode::SERVICE_UNAVAILABLE;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let due = automation
        .status_at(&fixture.store, NOW)
        .await
        .unwrap()
        .targets[0]
        .retry_not_before
        .unwrap();
    let mut pause = settings(1, true, true);
    pause.configuration.targets[0].enabled = false;
    configure(&automation, &fixture, pause).await;
    let mut resume = settings(2, true, true);
    resume.configuration.targets[0].proxied = false;
    automation
        .save_at(&fixture.store, resume, NOW + 2, Outcome::Configured)
        .await
        .unwrap();
    let state = automation.status_at(&fixture.store, NOW + 2).await.unwrap();
    assert_eq!(state.targets[0].retry_not_before, Some(due));
    assert!(tick(&automation, &fixture, NOW + 18).await.is_none());
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 1);
}
fn settings(revision: u32, enabled: bool, on_start: bool) -> SaveConfiguration {
    serde_json::from_value(json!({
        "expectedRevision": revision, "actorUserId": ACTOR,
        "configuration": { "enabled":enabled,"intervalSeconds":300,"updateOnStart":on_start,
            "ipv4":true,"ipv6":false,"targets":[target(10,"example.com",RecordType::A,Selection::Create)] }
    })).unwrap()
}
fn action(revision: u32) -> Action {
    Action {
        expected_revision: revision,
        actor_user_id: ACTOR.into(),
    }
}
async fn configure(
    automation: &Automation,
    fixture: &Fixture,
    request: SaveConfiguration,
) -> Document {
    automation
        .save_at(&fixture.store, request, NOW, Outcome::Configured)
        .await
        .unwrap()
}
async fn tick(automation: &Automation, fixture: &Fixture, at: i64) -> Option<BatchResult> {
    automation
        .run_at(&fixture.store, &fixture.engine, None, at)
        .await
        .unwrap()
}
fn runtime(fixture: &mut Fixture) -> Arc<ProxyRuntime> {
    let mut runtime = ProxyRuntime::new(RuntimeSettings::new(fixture.path.clone(), 8080), None);
    let owner = Arc::get_mut(&mut runtime).unwrap();
    owner.ddns = std::mem::replace(&mut fixture.engine, Engine::new());
    owner.dns_connections = std::mem::replace(&mut fixture.store, Store::new(fixture.path.clone()));
    runtime
}
use std::sync::Arc;

#[tokio::test]
async fn disabled_defaults_validation_and_five_minute_periodic_updates_share_manual_execution() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    assert!(
        automation
            .status_at(&fixture.store, NOW)
            .await
            .unwrap()
            .configuration
            .is_none()
    );
    assert!(tick(&automation, &fixture, NOW).await.is_none());
    assert_eq!(
        automation
            .run_at(&fixture.store, &fixture.engine, Some(action(0)), NOW)
            .await
            .unwrap_err(),
        AutomationError::Disabled
    );
    let mut value = settings(0, false, false);
    value.configuration.interval_seconds = 59;
    assert_eq!(
        automation
            .save_at(&fixture.store, value, NOW, Outcome::Configured)
            .await
            .unwrap_err(),
        AutomationError::InvalidInput
    );
    configure(&automation, &fixture, settings(0, true, false)).await;
    assert!(tick(&automation, &fixture, NOW + 299).await.is_none());
    assert_eq!(
        tick(&automation, &fixture, NOW + 300)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Updated
    );
    assert!(tick(&automation, &fixture, NOW + 599).await.is_none());
    assert_eq!(
        tick(&automation, &fixture, NOW + 600)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Unchanged
    );
    assert_eq!(
        automation
            .run_at(&fixture.store, &fixture.engine, Some(action(1)), NOW + 606)
            .await
            .unwrap()
            .unwrap()
            .targets[0]
            .status,
        Status::Unchanged
    );
    assert_eq!(fixture.writes(), 1);
    let state = automation
        .status_at(&fixture.store, NOW + 606)
        .await
        .unwrap();
    assert_eq!(
        state.targets[0]
            .last_successful_address
            .unwrap()
            .to_string(),
        "8.8.4.4"
    );
    assert_eq!(state.targets[0].next_attempt_at, Some(NOW + 906));
    assert!(matches!(
        state.events.last().unwrap().trigger,
        Some(Trigger::Manual)
    ));
    assert!(!serde_json::to_string(&state).unwrap().contains(SECRET));
}

#[tokio::test]
async fn normal_restart_retains_schedule_and_update_on_start_obeys_recovery_backoff() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, false)).await;
    tick(&automation, &fixture, NOW + 300).await.unwrap();
    let restarted = Automation::new(fixture.path.clone());
    assert!(tick(&restarted, &fixture, NOW + 400).await.is_none());
    assert_eq!(
        restarted
            .status_at(&fixture.store, NOW + 400)
            .await
            .unwrap()
            .targets[0]
            .next_attempt_at,
        Some(NOW + 600)
    );
    restarted
        .save_at(
            &fixture.store,
            settings(1, true, true),
            NOW + 400,
            Outcome::Configured,
        )
        .await
        .unwrap();
    tick(&restarted, &fixture, NOW + 400).await.unwrap();
    let restarted = Automation::new(fixture.path.clone());
    assert_eq!(
        tick(&restarted, &fixture, NOW + 401).await.unwrap().targets[0].status,
        Status::Unchanged
    );
    fixture.mock.data.lock().unwrap().status = StatusCode::SERVICE_UNAVAILABLE;
    tick(&restarted, &fixture, NOW + 701).await.unwrap();
    let state = restarted
        .status_at(&fixture.store, NOW + 701)
        .await
        .unwrap();
    assert!(state.targets[0].next_attempt_at.unwrap() >= NOW + 731);
    let restarted = Automation::new(fixture.path.clone());
    assert!(tick(&restarted, &fixture, NOW + 702).await.is_none());
    assert_eq!(
        restarted
            .status_at(&fixture.store, NOW + 702)
            .await
            .unwrap()
            .targets[0]
            .next_attempt_at,
        state.targets[0].next_attempt_at
    );
}

#[tokio::test]
async fn outage_preserves_last_good_addresses_retries_with_backoff_and_recovers_without_restart() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    {
        let mut data = fixture.mock.data.lock().unwrap();
        data.status = StatusCode::SERVICE_UNAVAILABLE;
        data.v4 = "ip=1.1.1.1\n".into();
    }
    assert_eq!(
        tick(&automation, &fixture, NOW + 300)
            .await
            .unwrap()
            .targets[0]
            .error,
        Some(Error::ProviderUnavailable)
    );
    let first = automation
        .status_at(&fixture.store, NOW + 300)
        .await
        .unwrap();
    assert_eq!(first.targets[0].last_success_at, Some(NOW));
    assert_eq!(
        first.targets[0]
            .last_successful_address
            .unwrap()
            .to_string(),
        "8.8.4.4"
    );
    assert_eq!(first.targets[0].consecutive_failures, 1);
    let due = first.targets[0].next_attempt_at.unwrap();
    assert!((NOW + 330..=NOW + 336).contains(&due));
    let reads = fixture.mock.reads.load(Ordering::SeqCst);
    assert!(tick(&automation, &fixture, due - 1).await.is_none());
    assert_eq!(
        automation
            .run_at(&fixture.store, &fixture.engine, Some(action(1)), due - 1)
            .await
            .unwrap_err(),
        AutomationError::RetryDeferred
    );
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), reads);
    tick(&automation, &fixture, due).await.unwrap();
    let second = automation.status_at(&fixture.store, due).await.unwrap();
    assert!(second.targets[0].next_attempt_at.unwrap() >= due + 60);
    fixture.mock.data.lock().unwrap().status = StatusCode::OK;
    let recovered_at = second.targets[0].next_attempt_at.unwrap();
    assert_eq!(
        tick(&automation, &fixture, recovered_at)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Updated
    );
    let recovered = automation
        .status_at(&fixture.store, recovered_at)
        .await
        .unwrap();
    assert_eq!(
        recovered.targets[0]
            .last_successful_address
            .unwrap()
            .to_string(),
        "1.1.1.1"
    );
    assert_eq!(recovered.targets[0].consecutive_failures, 0);
}

#[tokio::test]
async fn durable_rate_limit_cannot_be_bypassed_by_manual_runs_restart_or_config_edits() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().status = StatusCode::TOO_MANY_REQUESTS;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    let result = tick(&automation, &fixture, NOW).await.unwrap();
    assert_eq!(result.targets[0].retry_after_seconds, Some(17));
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(state.provider_not_before, Some(NOW + 17));
    let restarted = Automation::new(fixture.path.clone());
    assert!(tick(&restarted, &fixture, NOW + 1).await.is_none());
    restarted
        .save_at(
            &fixture.store,
            settings(1, true, true),
            NOW + 1,
            Outcome::Configured,
        )
        .await
        .unwrap();
    assert_eq!(
        restarted
            .run_at(&fixture.store, &fixture.engine, Some(action(2)), NOW + 16)
            .await
            .unwrap_err(),
        AutomationError::RetryDeferred
    );
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 1);
    fixture.mock.data.lock().unwrap().status = StatusCode::OK;
    assert_eq!(
        tick(
            &restarted,
            &fixture,
            state.targets[0].next_attempt_at.unwrap()
        )
        .await
        .unwrap()
        .targets[0]
            .status,
        Status::Updated
    );
}

#[tokio::test]
async fn permission_failures_stop_periodic_retries_and_credential_revision_changes_rearm_targets() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().status = StatusCode::FORBIDDEN;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert!(state.targets[0].permanent_failure);
    assert_eq!(
        state.targets[0].last_result.as_ref().unwrap().error,
        Some(Error::ProviderUnauthorized)
    );
    assert_eq!(state.targets[0].next_attempt_at, None);
    assert!(tick(&automation, &fixture, NOW + 10000).await.is_none());
    fixture.mock.data.lock().unwrap().status = StatusCode::OK;
    fixture
        .store
        .save(
            CONNECTION.into(),
            crate::runtime::dns_connections::SaveRequest {
                expected_revision: 1,
                name: "Rotated credentials".into(),
                api_token: Some(SECRET.into()),
                zone_ids: vec![provider_id('a'), provider_id('b')],
                actor_user_id: ACTOR.into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        tick(&automation, &fixture, NOW + 10001)
            .await
            .unwrap()
            .targets[0]
            .status,
        Status::Updated
    );
    assert!(
        !automation
            .status_at(&fixture.store, NOW + 10001)
            .await
            .unwrap()
            .targets[0]
            .permanent_failure
    );
}

#[tokio::test]
async fn manual_and_scheduled_runs_cannot_overlap_and_disable_allows_only_admitted_batch_to_finish()
{
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let run = automation.run_at(&fixture.store, &fixture.engine, None, NOW);
    tokio::pin!(run);
    tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut run=>panic!("batch did not pause") }
    assert_eq!(
        automation
            .run_at(&fixture.store, &fixture.engine, Some(action(1)), NOW)
            .await
            .unwrap_err(),
        AutomationError::Busy
    );
    assert_eq!(
        automation
            .save_at(
                &fixture.store,
                settings(1, true, true),
                NOW,
                Outcome::Configured
            )
            .await
            .unwrap_err(),
        AutomationError::Busy
    );
    let disabled = automation
        .disable_at(&fixture.store, action(1), NOW + 1)
        .await
        .unwrap();
    assert!(disabled.in_flight.is_some());
    assert!(!disabled.configuration.unwrap().settings.enabled);
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    assert_eq!(
        run.await.unwrap().unwrap().targets[0].status,
        Status::Updated
    );
    assert!(tick(&automation, &fixture, NOW + 10000).await.is_none());
    let state = automation
        .status_at(&fixture.store, NOW + 10000)
        .await
        .unwrap();
    assert!(!state.configuration.unwrap().settings.enabled);
    assert_eq!(state.targets[0].next_attempt_at, None);
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn interrupted_run_is_reconciled_after_backoff_and_creation_is_not_replayed_blindly() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    {
        let run = automation.run_at(&fixture.store, &fixture.engine, None, NOW);
        tokio::pin!(run);
        tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut run=>panic!("batch did not pause") }
        assert!(
            automation
                .status_at(&fixture.store, NOW)
                .await
                .unwrap()
                .in_flight
                .is_some()
        );
    }
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_waiters();
    let restarted = Automation::new(fixture.path.clone());
    assert!(tick(&restarted, &fixture, NOW + 1).await.is_none());
    let state = restarted.status_at(&fixture.store, NOW + 1).await.unwrap();
    assert!(state.in_flight.is_none());
    assert_eq!(
        state.targets[0].last_result.as_ref().unwrap().error,
        Some(Error::RunInterrupted)
    );
    let due = state.targets[0].next_attempt_at.unwrap();
    assert!(due >= NOW + 31);
    assert_eq!(
        tick(&restarted, &fixture, due).await.unwrap().targets[0].status,
        Status::Updated
    );
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn restored_state_stays_paused_until_explicit_activation_and_preserves_last_good_status() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    std::fs::write(fixture.path.join(persistence::RESTORE_PAUSE), b"restored").unwrap();
    let restored = Automation::new(fixture.path.clone());
    assert!(tick(&restored, &fixture, NOW + 1000).await.is_none());
    let state = restored
        .status_at(&fixture.store, NOW + 1000)
        .await
        .unwrap();
    assert!(state.restore_paused);
    assert_eq!(state.targets[0].last_success_at, Some(NOW));
    assert_eq!(
        restored
            .run_at(&fixture.store, &fixture.engine, Some(action(2)), NOW + 1001)
            .await
            .unwrap_err(),
        AutomationError::RestorePaused
    );
    restored
        .save_at(
            &fixture.store,
            settings(2, false, true),
            NOW + 1001,
            Outcome::Configured,
        )
        .await
        .unwrap();
    assert!(
        restored
            .status_at(&fixture.store, NOW + 1001)
            .await
            .unwrap()
            .restore_paused
    );
    restored
        .save_at(
            &fixture.store,
            settings(3, true, true),
            NOW + 1002,
            Outcome::Enabled,
        )
        .await
        .unwrap();
    assert!(!fixture.path.join(persistence::RESTORE_PAUSE).exists());
    assert_eq!(
        tick(&restored, &fixture, NOW + 1002).await.unwrap().targets[0].status,
        Status::Unchanged
    );
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn failed_configuration_commit_leaves_safe_reservations_and_restart_prunes_only_orphans() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, false, false)).await;
    assert_eq!(fixture.store.list().await.unwrap()[0].references.len(), 1);
    assert_eq!(
        fixture.store.delete(CONNECTION, 1).await.unwrap_err(),
        crate::runtime::dns_connections::Error::ConnectionInUse
    );
    std::fs::rename(
        fixture.path.join(persistence::FILE),
        fixture.path.join("saved-ddns.json"),
    )
    .unwrap();
    std::fs::create_dir(fixture.path.join(persistence::FILE)).unwrap();
    let mut request = settings(1, false, false);
    request.configuration.targets.push(target(
        11,
        "other.example.com",
        RecordType::A,
        Selection::Create,
    ));
    assert_eq!(
        automation
            .save_at(&fixture.store, request, NOW, Outcome::Configured)
            .await
            .unwrap_err(),
        AutomationError::StoreUnavailable
    );
    assert_eq!(fixture.store.list().await.unwrap()[0].references.len(), 2);
    std::fs::remove_dir(fixture.path.join(persistence::FILE)).unwrap();
    std::fs::rename(
        fixture.path.join("saved-ddns.json"),
        fixture.path.join(persistence::FILE),
    )
    .unwrap();
    let restarted = Automation::new(fixture.path.clone());
    restarted.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(fixture.store.list().await.unwrap()[0].references.len(), 1);
    let mut clear = settings(1, false, false);
    clear.configuration.targets.clear();
    restarted
        .save_at(&fixture.store, clear, NOW, Outcome::Configured)
        .await
        .unwrap();
    assert!(fixture.store.list().await.unwrap()[0].references.is_empty());
    fixture.store.delete(CONNECTION, 1).await.unwrap();
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn corrupt_state_fails_closed_and_events_remain_bounded_with_optimistic_revisions() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    for revision in 1..70 {
        configure(&automation, &fixture, settings(revision, false, false)).await;
    }
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(state.events.len(), 64);
    assert_eq!(state.events[0].sequence, 8);
    assert_eq!(state.event_sequence, 71);
    assert_eq!(state.last_run.as_ref().unwrap().started_at, NOW);
    assert_eq!(state.last_run.as_ref().unwrap().updated, 1);
    assert_eq!(
        automation
            .save_at(
                &fixture.store,
                settings(69, true, true),
                NOW,
                Outcome::Configured
            )
            .await
            .unwrap_err(),
        AutomationError::Conflict
    );
    std::fs::write(
        fixture.path.join(persistence::FILE),
        b"{\"apiToken\":\"must-not-be-echoed\"}",
    )
    .unwrap();
    let restarted = Automation::new(fixture.path.clone());
    assert_eq!(
        restarted
            .run_at(&fixture.store, &fixture.engine, None, NOW)
            .await
            .unwrap_err(),
        AutomationError::StoreUnavailable
    );
    assert_eq!(fixture.writes(), 1);
}

#[tokio::test]
async fn owned_worker_starts_without_caddy_and_shutdown_drains_inflight_then_rejects_new_work() {
    let mut fixture = Fixture::new(vec![]).await;
    let runtime = runtime(&mut fixture);
    runtime
        .ddns_automation
        .save(&runtime.dns_connections, settings(0, true, true))
        .await
        .unwrap();
    fixture.mock.pause.store(true, Ordering::SeqCst);
    runtime.start_ddns_scheduler().await;
    tokio::time::timeout(Duration::from_secs(3), fixture.mock.entered.notified())
        .await
        .unwrap();
    runtime.ddns_automation.stop_accepting();
    assert_eq!(
        runtime
            .ddns_automation
            .manual(&runtime.dns_connections, &runtime.ddns, action(1))
            .await
            .unwrap_err(),
        AutomationError::Busy
    );
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    tokio::time::timeout(Duration::from_secs(3), runtime.shutdown())
        .await
        .unwrap();
    assert_eq!(fixture.writes(), 1);
    assert_eq!(
        runtime
            .ddns_automation
            .manual(&runtime.dns_connections, &runtime.ddns, action(1))
            .await
            .unwrap_err(),
        AutomationError::Stopping
    );
    assert!(
        runtime
            .ddns_automation
            .status(&runtime.dns_connections)
            .await
            .unwrap()
            .in_flight
            .is_none()
    );
}

#[tokio::test]
async fn partial_failure_leaves_other_targets_running_and_disabled_ipv6_untouched() {
    let initial = vec![
        record(
            '1',
            'a',
            "blocked.example.com",
            "CNAME",
            "elsewhere.example.org",
        ),
        record('2', 'a', "example.com", "AAAA", "2001:4860::1"),
    ];
    let fixture = Fixture::new(initial.clone()).await;
    let automation = Automation::new(fixture.path.clone());
    let preview = automation
        .preview(
            &fixture.store,
            &fixture.engine,
            request(vec![target(
                10,
                "example.com",
                RecordType::A,
                Selection::Create,
            )]),
        )
        .await
        .unwrap();
    assert_eq!(preview.targets[0].status, Status::WouldCreate);
    assert_eq!(fixture.writes(), 0);
    let mut config = settings(0, true, true);
    config.configuration.targets.push(target(
        11,
        "blocked.example.com",
        RecordType::A,
        Selection::Create,
    ));
    config.configuration.targets.push(target(
        12,
        "example.com",
        RecordType::Aaaa,
        Selection::Adopt {
            record_id: provider_id('2'),
        },
    ));
    configure(&automation, &fixture, config).await;
    let result = tick(&automation, &fixture, NOW).await.unwrap();
    assert_eq!(result.targets.len(), 2);
    assert_eq!(result.targets[0].status, Status::Updated);
    assert_eq!(result.targets[1].error, Some(Error::RecordConflict));
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(
        state.events.last().unwrap().outcome,
        Outcome::PartialFailure
    );
    assert!(state.targets[1].permanent_failure);
    assert_eq!(state.targets[2].last_attempt_at, None);
    assert_eq!(
        tick(&automation, &fixture, NOW + 300)
            .await
            .unwrap()
            .targets
            .len(),
        1
    );
    assert_eq!(fixture.mock.ipv6_calls.load(Ordering::SeqCst), 0);
    assert_eq!(fixture.mock.data.lock().unwrap().records[0..2], initial);
}

#[tokio::test]
async fn transient_retry_after_can_extend_backoff_and_preview_rate_limit_is_durable() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    {
        let mut data = fixture.mock.data.lock().unwrap();
        data.status = StatusCode::SERVICE_UNAVAILABLE;
        data.retry_after = "120".into();
    }
    tick(&automation, &fixture, NOW).await.unwrap();
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(state.targets[0].next_attempt_at, Some(NOW + 120));
    assert!(tick(&automation, &fixture, NOW + 119).await.is_none());
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    {
        let mut data = fixture.mock.data.lock().unwrap();
        data.status = StatusCode::TOO_MANY_REQUESTS;
        data.retry_after = "120".into();
    }
    let now = Automation::now();
    automation
        .preview(
            &fixture.store,
            &fixture.engine,
            request(vec![target(
                10,
                "example.com",
                RecordType::A,
                Selection::Create,
            )]),
        )
        .await
        .unwrap();
    let state = automation.status(&fixture.store).await.unwrap();
    assert!(state.provider_not_before.unwrap() >= now + 120);
    assert_eq!(
        state.provider_pause_reason,
        Some(Error::ProviderRateLimited)
    );
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 1);
    let until = state.provider_not_before;
    let restarted = Automation::new(fixture.path.clone());
    let state = restarted.status(&fixture.store).await.unwrap();
    assert_eq!(state.provider_not_before, until);
}

#[tokio::test]
async fn disabling_and_reenabling_does_not_erase_a_transient_retry_deadline() {
    let fixture = Fixture::new(vec![]).await;
    fixture.mock.data.lock().unwrap().status = StatusCode::SERVICE_UNAVAILABLE;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    tick(&automation, &fixture, NOW).await.unwrap();
    let due = automation
        .status_at(&fixture.store, NOW)
        .await
        .unwrap()
        .targets[0]
        .retry_not_before
        .unwrap();
    let state = automation
        .disable_at(&fixture.store, action(1), NOW + 1)
        .await
        .unwrap();
    assert_eq!(state.targets[0].next_attempt_at, None);
    assert_eq!(state.targets[0].retry_not_before, Some(due));
    automation
        .save_at(
            &fixture.store,
            settings(2, true, true),
            NOW + 2,
            Outcome::Enabled,
        )
        .await
        .unwrap();
    assert!(tick(&automation, &fixture, NOW + 18).await.is_none());
    assert_eq!(
        automation
            .run_at(&fixture.store, &fixture.engine, Some(action(3)), NOW + 18)
            .await
            .unwrap_err(),
        AutomationError::RetryDeferred
    );
    assert_eq!(fixture.mock.reads.load(Ordering::SeqCst), 1);
    fixture.mock.data.lock().unwrap().status = StatusCode::OK;
    assert_eq!(
        tick(&automation, &fixture, due).await.unwrap().targets[0].status,
        Status::Updated
    );
}

#[tokio::test]
async fn cancelling_a_configuration_write_invalidates_cached_state_before_next_admission() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, false, false)).await;
    let io = Arc::clone(&automation.io).lock_owned().await;
    {
        let save = automation.save_at(
            &fixture.store,
            settings(1, true, true),
            NOW,
            Outcome::Configured,
        );
        tokio::pin!(save);
        tokio::select! { biased; result=&mut save=>panic!("write should wait for I/O: {result:?}"), _=tokio::task::yield_now()=>{} }
    }
    assert!(automation.state.lock().await.is_none());
    drop(io);
    let state = automation.status_at(&fixture.store, NOW).await.unwrap();
    assert_eq!(state.configuration.as_ref().unwrap().revision, 1);
    assert!(!state.configuration.unwrap().settings.enabled);
    assert!(tick(&automation, &fixture, NOW + 10000).await.is_none());
    assert_eq!(fixture.writes(), 0);
}

#[tokio::test]
async fn cancelled_disable_and_status_reload_do_not_misclassify_an_active_batch_as_interrupted() {
    let fixture = Fixture::new(vec![]).await;
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, true, true)).await;
    fixture.mock.pause.store(true, Ordering::SeqCst);
    let run = automation.run_at(&fixture.store, &fixture.engine, None, NOW);
    tokio::pin!(run);
    tokio::select! { _=fixture.mock.entered.notified()=>{}, _=&mut run=>panic!("batch did not pause") }
    let io = Arc::clone(&automation.io).lock_owned().await;
    {
        let disable = automation.disable_at(&fixture.store, action(1), NOW + 1);
        tokio::pin!(disable);
        tokio::select! { biased; result=&mut disable=>panic!("disable should wait for I/O: {result:?}"), _=tokio::task::yield_now()=>{} }
    }
    drop(io);
    let status = automation.status_at(&fixture.store, NOW + 1);
    tokio::pin!(status);
    // Poll the observer while the provider is paused, so it owns the state
    // reload before allowing both independent futures to continue.
    tokio::select! { biased; result=&mut status=>panic!("observer should wait for the record lease: {result:?}"), _=tokio::task::yield_now()=>{} }
    fixture.mock.pause.store(false, Ordering::SeqCst);
    fixture.mock.release.notify_one();
    let (status, result) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(&mut status, &mut run)
    })
    .await
    .unwrap();
    let status = status.unwrap();
    assert!(status.in_flight.is_some());
    assert!(
        !status
            .events
            .iter()
            .any(|event| event.outcome == Outcome::Interrupted)
    );
    assert_eq!(result.unwrap().unwrap().targets[0].status, Status::Updated);
    let state = automation.status_at(&fixture.store, NOW + 1).await.unwrap();
    assert_eq!(state.last_run.unwrap().outcome, Outcome::Completed);
    assert!(state.in_flight.is_none());
}

#[tokio::test]
async fn ddns_reference_reconciliation_preserves_independent_dns01_consumers() {
    let mut fixture = Fixture::new(vec![]).await;
    let path = fixture.path.join("dns-connections.json");
    let mut registry: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    registry["connections"][0]["metadata"]["references"] = json!([{
        "zoneId":provider_id('a'),"consumer":{"type":"dns01","id":"0198d98a-0000-7000-8000-000000000090"}
    }]);
    std::fs::write(path, serde_json::to_vec(&registry).unwrap()).unwrap();
    let endpoint = fixture.engine.discovery_urls.as_ref().unwrap()[0]
        .strip_suffix("v4")
        .unwrap()
        .to_owned();
    fixture.store = Store::fixture(fixture.path.clone(), endpoint);
    let automation = Automation::new(fixture.path.clone());
    configure(&automation, &fixture, settings(0, false, false)).await;
    assert_eq!(fixture.store.list().await.unwrap()[0].references.len(), 2);
    let mut clear = settings(1, false, false);
    clear.configuration.targets.clear();
    configure(&automation, &fixture, clear).await;
    let restarted = Automation::new(fixture.path.clone());
    restarted.status_at(&fixture.store, NOW).await.unwrap();
    let references = fixture.store.list().await.unwrap()[0].references.clone();
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].consumer.r#type, ConsumerType::Dns01);
    assert_eq!(
        fixture.store.delete(CONNECTION, 1).await.unwrap_err(),
        crate::runtime::dns_connections::Error::ConnectionInUse
    );
    assert_eq!(fixture.writes(), 0);
}
