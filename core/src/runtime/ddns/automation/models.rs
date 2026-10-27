use super::super::models::{Error, Target, TargetResult};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Configuration {
    #[serde(default)]
    pub(crate) enabled: bool,
    pub(crate) interval_seconds: u32,
    #[serde(default)]
    pub(crate) update_on_start: bool,
    pub(crate) ipv4: bool,
    pub(crate) ipv6: bool,
    pub(crate) targets: Vec<Target>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SaveConfiguration {
    pub(crate) expected_revision: u32,
    pub(crate) actor_user_id: String,
    pub(crate) configuration: Configuration,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Action {
    pub(crate) expected_revision: u32,
    pub(crate) actor_user_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SavedConfiguration {
    pub(crate) revision: u32,
    pub(crate) updated_by_user_id: String,
    pub(crate) settings: Configuration,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TargetState {
    pub(crate) target_id: String,
    pub(crate) last_attempt_at: Option<i64>,
    pub(crate) last_success_at: Option<i64>,
    pub(crate) last_successful_address: Option<IpAddr>,
    pub(crate) last_successful_proxied: Option<bool>,
    pub(crate) last_result: Option<TargetResult>,
    // Authority established only by a confirmed deSEC Create. Keep it separate
    // from the latest attempt, which can fail without revoking ownership.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_record_id: Option<String>,
    pub(crate) consecutive_failures: u32,
    pub(crate) permanent_failure: bool,
    pub(crate) connection_revision: Option<u32>,
    pub(crate) next_attempt_at: Option<i64>,
    pub(crate) retry_not_before: Option<i64>,
}
impl TargetState {
    pub(super) fn new(target: &Target) -> Self {
        Self {
            target_id: target.id.clone(),
            last_attempt_at: None,
            last_success_at: None,
            last_successful_address: None,
            last_successful_proxied: None,
            last_result: None,
            created_record_id: None,
            consecutive_failures: 0,
            permanent_failure: false,
            connection_revision: None,
            next_attempt_at: None,
            retry_not_before: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Trigger {
    Scheduled,
    Manual,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct InFlight {
    pub(crate) started_at: i64,
    pub(crate) actor_user_id: String,
    pub(crate) trigger: Trigger,
    pub(crate) target_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Outcome {
    Completed,
    PartialFailure,
    Interrupted,
    Enabled,
    Disabled,
    Configured,
    RestorePaused,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Event {
    pub(crate) sequence: u32,
    pub(crate) at: i64,
    pub(crate) actor_user_id: Option<String>,
    pub(crate) trigger: Option<Trigger>,
    pub(crate) outcome: Outcome,
    pub(crate) updated: u32,
    pub(crate) failed: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RunSummary {
    pub(crate) started_at: i64,
    pub(crate) finished_at: i64,
    pub(crate) actor_user_id: String,
    pub(crate) trigger: Trigger,
    pub(crate) outcome: Outcome,
    pub(crate) updated: u32,
    pub(crate) failed: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Document {
    pub(crate) version: u8,
    pub(crate) configuration: Option<SavedConfiguration>,
    pub(crate) targets: Vec<TargetState>,
    pub(crate) in_flight: Option<InFlight>,
    pub(crate) last_run: Option<RunSummary>,
    pub(crate) provider_not_before: Option<i64>,
    #[serde(default)]
    pub(crate) provider_pause_reason: Option<Error>,
    pub(crate) manual_not_before: Option<i64>,
    pub(crate) restore_paused: bool,
    pub(crate) events: Vec<Event>,
    pub(crate) event_sequence: u32,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            configuration: None,
            targets: vec![],
            in_flight: None,
            last_run: None,
            provider_not_before: None,
            provider_pause_reason: None,
            manual_not_before: None,
            restore_paused: false,
            events: vec![],
            event_sequence: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutomationError {
    InvalidInput,
    Conflict,
    Busy,
    Disabled,
    RestorePaused,
    Stopping,
    RetryDeferred,
    StoreUnavailable,
    ConnectionUnavailable,
}

pub(super) fn transient(error: Error) -> bool {
    matches!(
        error,
        Error::Busy
            | Error::ConnectionUnavailable
            | Error::IpDiscoveryFailed
            | Error::ProviderRateLimited
            | Error::ProviderUnavailable
            | Error::InvalidProviderResponse
            | Error::WriteUnconfirmed
            | Error::TimeBudgetExceeded
            | Error::RunInterrupted
    )
}
