use serde::{Deserialize, Serialize};
use std::net::IpAddr;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum RecordType {
    A,
    #[serde(rename = "AAAA")]
    Aaaa,
}
impl RecordType {
    pub(super) fn matches(self, address: IpAddr) -> bool {
        matches!(
            (self, address),
            (Self::A, IpAddr::V4(_)) | (Self::Aaaa, IpAddr::V6(_))
        )
    }
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::Aaaa => "AAAA",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Selection {
    Inspect,
    Create,
    Adopt { record_id: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Target {
    pub(crate) id: String,
    pub(crate) connection_id: String,
    pub(crate) zone_id: String,
    pub(crate) name: String,
    pub(crate) record_type: RecordType,
    pub(crate) proxied: bool,
    pub(crate) selection: Selection,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Request {
    pub(crate) actor_user_id: String,
    pub(crate) ipv4: bool,
    pub(crate) ipv6: bool,
    pub(crate) targets: Vec<Target>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Error {
    InvalidInput,
    Busy,
    ConnectionUnavailable,
    ZoneNotPermitted,
    NameOutsideZone,
    IpDiscoveryFailed,
    FamilyDisabled,
    AdoptionRequired,
    CreationRequired,
    RecordConflict,
    RecordChanged,
    ProviderUnauthorized,
    ProviderRateLimited,
    ProviderUnavailable,
    InvalidProviderResponse,
    WriteUnconfirmed,
    TimeBudgetExceeded,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    Unchanged,
    Updated,
    WouldCreate,
    WouldUpdate,
    AdoptionRequired,
    CreationRequired,
    Skipped,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentRecord {
    pub(crate) id: String,
    pub(crate) address: IpAddr,
    pub(crate) proxied: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetResult {
    pub(crate) target_id: String,
    pub(crate) status: Status,
    pub(crate) current: Option<CurrentRecord>,
    pub(crate) desired_address: Option<IpAddr>,
    pub(crate) error: Option<Error>,
    pub(crate) retry_after_seconds: Option<u32>,
}
impl TargetResult {
    pub(super) fn new(target: &Target, status: Status) -> Self {
        Self {
            target_id: target.id.clone(),
            status,
            current: None,
            desired_address: None,
            error: None,
            retry_after_seconds: None,
        }
    }
    pub(super) fn failed(target: &Target, error: Error) -> Self {
        Self {
            error: Some(error),
            ..Self::new(target, Status::Failed)
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchResult {
    pub(crate) preview: bool,
    pub(crate) ipv4: Option<IpAddr>,
    pub(crate) ipv6: Option<IpAddr>,
    pub(crate) targets: Vec<TargetResult>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Failure {
    pub(super) code: Error,
    pub(super) retry_after: Option<u32>,
}
impl From<Error> for Failure {
    fn from(code: Error) -> Self {
        Self {
            code,
            retry_after: None,
        }
    }
}
