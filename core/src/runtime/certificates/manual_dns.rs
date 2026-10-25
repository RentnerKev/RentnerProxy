use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DnsValidationMode {
    #[default]
    Provider,
    Manual,
}

impl DnsValidationMode {
    pub(super) fn is_provider(&self) -> bool {
        *self == Self::Provider
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManualDnsPhase {
    AwaitingInput,
    CheckingDns,
    Validating,
    Finalizing,
    Complete,
    Cancelled,
    Expired,
    Failed,
}

impl ManualDnsPhase {
    pub(super) fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Complete | Self::Cancelled | Self::Expired | Self::Failed
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManualDnsRecord {
    pub(crate) identifier: String,
    pub(crate) owner: String,
    pub(crate) value: String,
    pub(crate) expires_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManualDnsChallengeSet {
    pub(crate) challenge_set_id: String,
    pub(crate) status: ManualDnsPhase,
    pub(crate) expires_at: String,
    pub(crate) records: Vec<ManualDnsRecord>,
    pub(crate) last_checked_at: Option<String>,
    pub(crate) last_error_code: Option<String>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManualDnsOrder {
    pub(crate) version: u8,
    pub(crate) operation_id: String,
    pub(crate) challenge_set_id: String,
    pub(crate) account_identity: String,
    pub(crate) order_url: String,
    pub(crate) expires_at: String,
    pub(crate) records: Vec<ManualDnsRecord>,
    pub(crate) phase: ManualDnsPhase,
    pub(crate) private_key_pem: Option<String>,
    pub(crate) csr_der: Option<Vec<u8>>,
    pub(crate) last_checked_at: Option<String>,
    pub(crate) last_error_code: Option<String>,
}

impl fmt::Debug for ManualDnsOrder {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManualDnsOrder")
            .field("operation_id", &self.operation_id)
            .field("challenge_set_id", &self.challenge_set_id)
            .field("phase", &self.phase)
            .finish_non_exhaustive()
    }
}

impl ManualDnsOrder {
    pub(super) fn public(&self) -> ManualDnsChallengeSet {
        ManualDnsChallengeSet {
            challenge_set_id: self.challenge_set_id.clone(),
            status: self.phase,
            expires_at: self.expires_at.clone(),
            records: self.records.clone(),
            last_checked_at: self.last_checked_at.clone(),
            last_error_code: self.last_error_code.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManualDnsActionRequest {
    pub(crate) operation_id: String,
    pub(crate) challenge_set_id: String,
}

mod storage;
mod validation;
pub(super) use validation::manual_order_is_valid;

#[cfg(test)]
#[path = "../../../tests/private/manual_dns_storage.rs"]
mod tests;
