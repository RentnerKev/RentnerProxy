use super::{CurrentOperation, DnsProviderConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CertificateImportRequest {
    pub(crate) certificate_pem: String,
    pub(crate) private_key_pem: String,
    #[serde(default)]
    pub(crate) chain_pem: Option<String>,
    #[serde(default)]
    pub(crate) required_domains: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CertificateIssueRequest {
    pub(crate) domains: Vec<String>,
    pub(crate) environment: CertificateEnvironment,
    #[serde(default)]
    pub(crate) contact_email: Option<String>,
    #[serde(default)]
    pub(crate) challenge_type: AcmeChallengeType,
    #[serde(default)]
    pub(crate) dns_provider: Option<DnsProviderConfig>,
    pub(crate) accept_terms: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) enum AcmeChallengeType {
    #[default]
    #[serde(rename = "http-01")]
    Http01,
    #[serde(rename = "dns-01")]
    Dns01,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CertificateSource {
    Manual,
    Acme,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CertificateEnvironment {
    Staging,
    Production,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CertificateStatus {
    Pending,
    Valid,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CertificateOperation {
    Idle,
    Issuing,
    Renewing,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CertificateCandidate {
    pub(crate) fingerprint: String,
    pub(crate) issued_at: String,
    pub(crate) expires_at: String,
    pub(crate) last_error_code: Option<String>,
    pub(crate) next_attempt_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CertificateMetadata {
    pub(crate) id: String,
    pub(crate) source: CertificateSource,
    pub(crate) environment: Option<CertificateEnvironment>,
    pub(crate) domains: Vec<String>,
    pub(crate) status: CertificateStatus,
    pub(crate) operation: CertificateOperation,
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
    pub(crate) issuer: Option<String>,
    pub(crate) fingerprint: Option<String>,
    pub(crate) last_error_code: Option<String>,
    pub(crate) updated_at: String,
    pub(crate) next_attempt_at: Option<String>,
    pub(crate) attempt_count: u32,
    pub(crate) last_attempt_at: Option<String>,
    pub(crate) last_success_at: Option<String>,
    pub(crate) next_renewal_at: Option<String>,
    pub(crate) candidate: Option<CertificateCandidate>,
    pub(crate) dns_cleanup_pending: bool,
    pub(crate) current_operation: Option<CurrentOperation>,
    pub(crate) challenge_type: Option<AcmeChallengeType>,
    pub(crate) last_activated_at: Option<String>,
    pub(crate) last_error_at: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct CertificateMaterial {
    pub(crate) fullchain_path: PathBuf,
    pub(crate) private_key_path: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CertificateError {
    InvalidCertificate,
    KeyMismatch,
    CertificateExpired,
    DomainMismatch,
    NotFound,
    InUse,
    OperationInProgress,
    TermsRequired,
    AcmeDomainInvalid,
    AcmeFailed,
    AcmeDnsRequired,
    DnsProviderInvalid,
    DnsProviderUnavailable,
    DnsProviderUnauthorized,
    DnsCleanupFailed,
    DnsCredentialsUnavailable,
    RuntimeApplyFailed,
    StoreUnavailable,
}

impl CertificateError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::InvalidCertificate => "invalid_certificate",
            Self::KeyMismatch => "key_mismatch",
            Self::CertificateExpired => "certificate_expired",
            Self::DomainMismatch => "domain_mismatch",
            Self::NotFound => "certificate_not_found",
            Self::InUse => "certificate_in_use",
            Self::OperationInProgress => "operation_in_progress",
            Self::TermsRequired => "acme_terms_required",
            Self::AcmeDomainInvalid => "acme_domain_invalid",
            Self::AcmeFailed => "acme_failed",
            Self::AcmeDnsRequired => "acme_dns_required",
            Self::DnsProviderInvalid => "dns_provider_invalid",
            Self::DnsProviderUnavailable => "dns_provider_unavailable",
            Self::DnsProviderUnauthorized => "dns_provider_unauthorized",
            Self::DnsCleanupFailed => "dns_cleanup_failed",
            Self::DnsCredentialsUnavailable => "dns_credentials_unavailable",
            Self::RuntimeApplyFailed => "runtime_apply_failed",
            Self::StoreUnavailable => "certificate_store_unavailable",
        }
    }
}
