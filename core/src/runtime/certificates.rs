use std::{
    collections::{BTreeMap, BTreeSet},
    io::ErrorKind,
    path::PathBuf,
};

use rustls::{
    ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer},
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use x509_parser::{extensions::GeneralName, parse_x509_certificate};

use crate::proxy::{is_canonical_domain, is_canonical_uuid_v7};

use super::dns::{DnsProviderConfig, DnsRecordIntent, EncryptedDnsConfig, encrypt};
use super::state::{SafeDir, state_dir};

#[cfg(test)]
#[path = "../tests/certificate_dns.rs"]
mod dns_tests;

#[cfg(test)]
#[path = "../tests/certificate_operations.rs"]
mod operation_tests;
mod operations;

pub(crate) const MAX_CERTIFICATE_PEM_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PRIVATE_KEY_PEM_BYTES: usize = 64 * 1024;
const CERTIFICATE_INDEX_FILE: &str = "certificate-metadata.json";
const CERTIFICATES_DIRECTORY: &str = "certificates";
const CANDIDATE_MANIFEST_FILE: &str = "candidate.json";
const CANDIDATE_MANIFEST_VERSION: u8 = 1;
const MAX_CERTIFICATE_INDEX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CANDIDATE_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_CERTIFICATES: usize = 10_000;

const INTERRUPTED_OPERATION_HEADROOM_BYTES: usize = 2_048;
const MIN_ACME_RETRY_DELAY_SECONDS: u32 = 1_800;
const MAX_ACME_RETRY_DELAY_SECONDS: u32 = 21_600;
const MIN_CANDIDATE_RETRY_DELAY_SECONDS: u32 = 60;
const MAX_CANDIDATE_RETRY_DELAY_SECONDS: u32 = 300;

mod models;
pub(crate) use models::{
    AcmeChallengeType, CertificateCandidate, CertificateEnvironment, CertificateError,
    CertificateImportRequest, CertificateIssueRequest, CertificateMaterial, CertificateMetadata,
    CertificateOperation, CertificateSource, CertificateStatus,
};
pub(crate) use operations::{
    CertificateEvent, CertificateEventKind, CertificateEventPage, CertificateOperationStage,
    CertificateStoreReadiness, CurrentOperation, OperationKind,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredCertificate {
    #[serde(flatten)]
    metadata: StoredMetadata,
    material_id: Option<String>,
    #[serde(default)]
    acme: Option<StoredAcmeConfiguration>,

    #[serde(rename = "nextAttemptAt", alias = "retryAfter", default)]
    next_attempt_at: Option<String>,
    #[serde(default)]
    retry_delay_seconds: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredMetadata {
    id: String,
    source: CertificateSource,
    environment: Option<CertificateEnvironment>,
    domains: Vec<String>,
    status: CertificateStatus,
    operation: CertificateOperation,
    issued_at: Option<String>,
    expires_at: Option<String>,
    issuer: Option<String>,
    fingerprint: Option<String>,
    last_error_code: Option<String>,
    updated_at: String,
    #[serde(default)]
    attempt_count: u32,
    #[serde(default)]
    last_attempt_at: Option<String>,
    #[serde(default)]
    last_success_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    current_operation: Option<CurrentOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    challenge_type: Option<AcmeChallengeType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_activated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_error_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredAcmeConfiguration {
    contact_email: Option<String>,
    #[serde(default)]
    challenge_type: AcmeChallengeType,
    #[serde(default)]
    dns_provider: Option<EncryptedDnsConfig>,
    #[serde(default)]
    pending_dns_records: Vec<DnsRecordIntent>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CandidateActivation {
    #[serde(default)]
    next_attempt_at: Option<String>,
    #[serde(default)]
    attempt_count: u32,
    #[serde(default)]
    last_attempt_at: Option<String>,
    #[serde(default)]
    last_error_code: Option<String>,
    #[serde(default)]
    retry_delay_seconds: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredCertificateCandidate {
    version: u8,
    staged: StoredCertificate,
    #[serde(default)]
    base_material_id: Option<String>,
    activation_operation: CertificateOperation,
    #[serde(default)]
    activation: CandidateActivation,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CertificateIndex {
    certificates: BTreeMap<String, StoredCertificate>,
    #[serde(
        default,
        rename = "acmeRetryUntil",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    acme_retry_until: BTreeMap<CertificateEnvironment, String>,
    #[serde(
        default,
        rename = "pendingCandidates",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pending_candidates: BTreeMap<String, StoredCertificateCandidate>,
    #[serde(default, rename = "storeId")]
    store_id: String,
    #[serde(
        default = "default_event_journal_version",
        rename = "eventJournalVersion"
    )]
    event_journal_version: u8,
    #[serde(default, rename = "eventSequence")]
    event_sequence: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    events: Vec<CertificateEvent>,
}

fn default_event_journal_version() -> u8 {
    1
}

#[derive(Clone)]
pub(crate) struct StagedCertificate {
    id: String,
    stored: StoredCertificate,
}

impl StagedCertificate {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn is_acme(&self) -> bool {
        self.stored.metadata.source == CertificateSource::Acme
    }

    pub(crate) fn covers_domains(&self, domains: &[String]) -> bool {
        self.stored.metadata.status == CertificateStatus::Valid
            && domains
                .iter()
                .all(|domain| certificate_covers(&self.stored.metadata.domains, domain))
    }

    fn material(
        &self,
        certificates_dir: &SafeDir,
    ) -> Result<CertificateMaterial, CertificateError> {
        let material_id = self
            .stored
            .material_id
            .as_deref()
            .ok_or(CertificateError::StoreUnavailable)?;
        material_at(certificates_dir, &self.id, material_id)
    }
}
pub(crate) struct CertificateStore {
    state_dir: PathBuf,
    index: tokio::sync::Mutex<CertificateIndex>,
    leases: tokio::sync::Mutex<BTreeSet<String>>,
    readiness: tokio::sync::Mutex<CertificateStoreReadiness>,
}

mod activation;
mod commit;
mod dns_lifecycle;
mod initialization;
mod issuance;
mod material;
mod material_files;
mod persistence;
mod recovery;
mod retry;
mod scheduling;
mod staging;
mod store;
mod validation;

use material_files::material_at;
pub(crate) use scheduling::renewal_timestamp;
use scheduling::valid_timestamp;
use validation::certificate_covers;
