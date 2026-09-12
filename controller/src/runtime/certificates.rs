use std::{
    collections::{BTreeMap, BTreeSet},
    io::ErrorKind,
    path::PathBuf,
};

use rustls::{
    ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
// Leave room for error codes, retry timestamps, attempt metadata and delays
// after interrupted ACME jobs.
const INTERRUPTED_OPERATION_HEADROOM_BYTES: usize = 2_048;
const MIN_ACME_RETRY_DELAY_SECONDS: u32 = 1_800;
const MAX_ACME_RETRY_DELAY_SECONDS: u32 = 21_600;
const MIN_CANDIDATE_RETRY_DELAY_SECONDS: u32 = 60;
const MAX_CANDIDATE_RETRY_DELAY_SECONDS: u32 = 300;

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

pub(crate) use operations::{
    CertificateEvent, CertificateEventKind, CertificateEventPage, CertificateOperationStage,
    CertificateStoreReadiness, CurrentOperation, OperationKind,
};

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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredCertificate {
    #[serde(flatten)]
    metadata: StoredMetadata,
    material_id: Option<String>,
    #[serde(default)]
    acme: Option<StoredAcmeConfiguration>,
    // `retryAfter` was the name used by the first persisted scheduler.  Keep
    // accepting it during rolling upgrades while writing the clearer name.
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

impl CertificateStore {
    pub(crate) fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            index: tokio::sync::Mutex::new(CertificateIndex::default()),
            leases: tokio::sync::Mutex::new(BTreeSet::new()),
            readiness: tokio::sync::Mutex::new(CertificateStoreReadiness::NotReady),
        }
    }

    pub(crate) async fn initialize(&self) -> Result<(), CertificateError> {
        let result = self.initialize_inner().await;
        let readiness = if result.is_ok() {
            CertificateStoreReadiness::Ready
        } else {
            let current = *self.readiness.lock().await;
            if matches!(current, CertificateStoreReadiness::Corrupt) {
                current
            } else {
                CertificateStoreReadiness::InitializationFailed
            }
        };
        *self.readiness.lock().await = readiness;
        result
    }

    async fn initialize_inner(&self) -> Result<(), CertificateError> {
        let certificates_dir = self.ensure_certificates_dir()?;
        let mut index = match read_regular_private_file(
            &certificates_dir,
            CERTIFICATE_INDEX_FILE,
            MAX_CERTIFICATE_INDEX_BYTES,
        )? {
            Some(bytes) => match serde_json::from_slice(&bytes) {
                Ok(index) => index,
                Err(_) => {
                    *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
                    return Err(CertificateError::StoreUnavailable);
                }
            },
            None => CertificateIndex::default(),
        };
        let generated_store_id = index.store_id.is_empty();
        if generated_store_id {
            index.store_id = operations::new_uuid_v7()?;
        }
        if index.event_journal_version == 0 {
            index.event_journal_version = default_event_journal_version();
        }
        if !index_is_valid(&index) {
            *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
            return Err(CertificateError::StoreUnavailable);
        }
        let recovered_candidate_state =
            match reconcile_candidate_manifests(&certificates_dir, &mut index) {
                Ok(changed) => changed,
                Err(error) => {
                    *self.readiness.lock().await = CertificateStoreReadiness::Corrupt;
                    return Err(error);
                }
            };
        let mut recovered_interrupted_operation = false;
        let recovery_now = utc_now()?;
        let recovery_deadline = OffsetDateTime::now_utc().checked_add(time::Duration::seconds(
            i64::from(MIN_ACME_RETRY_DELAY_SECONDS),
        ));
        let mut recovery_events = Vec::new();
        for (id, entry) in &mut index.certificates {
            if entry.metadata.operation != CertificateOperation::Idle {
                entry.metadata.operation = CertificateOperation::Idle;
                entry.metadata.status = if entry.material_id.is_some() {
                    CertificateStatus::Valid
                } else {
                    CertificateStatus::Failed
                };
                if let Some(candidate) = index.pending_candidates.get(id) {
                    entry.metadata.last_error_code = candidate.activation.last_error_code.clone();
                    entry.metadata.updated_at = recovery_now.clone();
                    recovered_interrupted_operation = true;
                    continue;
                }
                entry.metadata.last_error_code =
                    Some(CertificateError::AcmeFailed.code().to_owned());
                entry.metadata.attempt_count = entry.metadata.attempt_count.max(1);
                if entry.metadata.last_attempt_at.is_none() {
                    entry.metadata.last_attempt_at = Some(recovery_now.clone());
                }
                entry.metadata.last_error_at = Some(recovery_now.clone());
                let operation_id = entry
                    .metadata
                    .current_operation
                    .as_ref()
                    .map(|operation| operation.id.clone());
                if let Some(operation) = entry.metadata.current_operation.as_mut() {
                    operation.stage = CertificateOperationStage::RetryScheduled;
                    operation.updated_at = recovery_now.clone();
                }
                entry.retry_delay_seconds = Some(
                    entry
                        .retry_delay_seconds
                        .unwrap_or(MIN_ACME_RETRY_DELAY_SECONDS)
                        .clamp(MIN_ACME_RETRY_DELAY_SECONDS, MAX_ACME_RETRY_DELAY_SECONDS),
                );
                if let Some(recovery_deadline) = recovery_deadline {
                    entry.next_attempt_at =
                        max_retry_deadline(entry.next_attempt_at.as_deref(), recovery_deadline);
                }
                entry.metadata.updated_at = recovery_now.clone();
                if let Some(operation_id) = operation_id {
                    recovery_events.push((
                        operation_id,
                        entry.metadata.id.clone(),
                        entry.metadata.last_error_code.clone(),
                    ));
                }
                recovered_interrupted_operation = true;
            }
        }
        for (operation_id, certificate_id, error_code) in recovery_events {
            let _ = operations::append_event(
                &mut index,
                &operation_id,
                &certificate_id,
                CertificateEventKind::Failed,
                CertificateOperationStage::Failed,
                error_code.clone(),
            );
            let _ = operations::append_event(
                &mut index,
                &operation_id,
                &certificate_id,
                CertificateEventKind::RetryScheduled,
                CertificateOperationStage::RetryScheduled,
                error_code,
            );
        }
        if generated_store_id || recovered_interrupted_operation || recovered_candidate_state {
            persist_index(&certificates_dir, &index)?;
        }
        *self.index.lock().await = index;
        Ok(())
    }

    pub(crate) async fn readiness(&self) -> CertificateStoreReadiness {
        *self.readiness.lock().await
    }

    pub(crate) async fn renewal_is_allowed(&self, id: &str) -> bool {
        let index = self.index.lock().await;
        let now = OffsetDateTime::now_utc();
        index.certificates.get(id).is_some_and(|entry| {
            !index.pending_candidates.contains_key(id)
                && !retry_is_blocking(entry, now)
                && entry
                    .metadata
                    .environment
                    .is_none_or(|environment| !account_retry_is_blocking(&index, environment, now))
        })
    }
    pub(crate) async fn list(&self) -> Result<Vec<CertificateMetadata>, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        Ok(index
            .certificates
            .iter()
            .map(|(id, stored)| {
                public_metadata_with_candidate(stored, index.pending_candidates.get(id))
            })
            .collect())
    }

    pub(crate) async fn get(&self, id: &str) -> Result<CertificateMetadata, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        index
            .certificates
            .get(id)
            .map(|stored| public_metadata_with_candidate(stored, index.pending_candidates.get(id)))
            .ok_or(CertificateError::NotFound)
    }

    pub(crate) async fn events(
        &self,
        after: Option<&str>,
        limit: usize,
    ) -> Result<CertificateEventPage, CertificateError> {
        self.ensure_ready().await?;
        let index = self.index.lock().await;
        operations::events_page(&index, after, limit)
    }

    pub(crate) async fn record_operation_stage(
        &self,
        id: &str,
        stage: CertificateOperationStage,
    ) -> Result<(), CertificateError> {
        self.ensure_ready().await?;
        let now = utc_now()?;
        let certificates_dir = self.certificates_dir()?;
        let mut index = self.index.lock().await;
        let Some(previous_active) = index.certificates.get(id).cloned() else {
            // A new manual import is staged before its first active index entry exists. Its
            // operation snapshot is carried by the staged material and finalized by commit.
            return Ok(());
        };
        let Some(mut operation) = previous_active.metadata.current_operation.clone() else {
            return Err(CertificateError::OperationInProgress);
        };
        if operation.stage == stage {
            return Ok(());
        }
        operation.stage = stage;
        operation.updated_at = now;
        let previous_candidate = index.pending_candidates.get(id).cloned();
        let previous_events = index.events.clone();
        let previous_sequence = index.event_sequence;
        if let Some(active) = index.certificates.get_mut(id) {
            active.metadata.current_operation = Some(operation.clone());
            active.metadata.updated_at = operation.updated_at.clone();
        }
        if let Some(candidate) = index.pending_candidates.get_mut(id) {
            candidate.staged.metadata.current_operation = Some(operation.clone());
        }
        if let Some(kind) = operations::event_kind_for_stage(stage) {
            let error_code = (stage == CertificateOperationStage::Failed
                || stage == CertificateOperationStage::NeedsAttention)
                .then(|| {
                    index
                        .certificates
                        .get(id)
                        .and_then(|entry| entry.metadata.last_error_code.clone())
                })
                .flatten();
            operations::append_event(&mut index, &operation.id, id, kind, stage, error_code)?;
        }
        if let Some(candidate) = index.pending_candidates.get(id)
            && let Err(error) = persist_candidate_manifest(&certificates_dir, id, candidate)
        {
            index
                .certificates
                .insert(id.to_owned(), previous_active.clone());
            if let Some(previous_candidate) = previous_candidate.as_ref() {
                index
                    .pending_candidates
                    .insert(id.to_owned(), previous_candidate.clone());
            }
            index.events = previous_events;
            index.event_sequence = previous_sequence;
            return Err(error);
        }
        if let Err(error) = persist_index(&certificates_dir, &index) {
            index.certificates.insert(id.to_owned(), previous_active);
            if let Some(previous_candidate) = previous_candidate.as_ref() {
                index
                    .pending_candidates
                    .insert(id.to_owned(), previous_candidate.clone());
                let _ = persist_candidate_manifest(&certificates_dir, id, previous_candidate);
            }
            index.events = previous_events;
            index.event_sequence = previous_sequence;
            return Err(error);
        }
        Ok(())
    }

    async fn ensure_ready(&self) -> Result<(), CertificateError> {
        if matches!(self.readiness().await, CertificateStoreReadiness::Ready) {
            Ok(())
        } else {
            Err(CertificateError::StoreUnavailable)
        }
    }

    pub(crate) async fn stage_manual(
        &self,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<StagedCertificate, CertificateError> {
        self.acquire_lease(id).await?;
        let (has_candidate, has_pending_dns) = {
            let index = self.index.lock().await;
            (
                index.pending_candidates.contains_key(id),
                index
                    .certificates
                    .get(id)
                    .and_then(|entry| entry.acme.as_ref())
                    .is_some_and(|acme| !acme.pending_dns_records.is_empty()),
            )
        };
        if has_candidate {
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        };
        if has_pending_dns {
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }
        match self.stage_import_with_lease(id, &request, CertificateSource::Manual, None, None) {
            Ok(mut staged) => {
                let operation = match operations::new_operation(OperationKind::Import) {
                    Ok(operation) => operation,
                    Err(error) => {
                        self.release_lease(id).await;
                        return Err(error);
                    }
                };
                staged.stored.metadata.current_operation = Some(operation.clone());
                let mut index = self.index.lock().await;
                if let Some(previous) = index.certificates.get(id).cloned() {
                    let previous_events = index.events.clone();
                    let previous_sequence = index.event_sequence;
                    let mut active = previous.clone();
                    active.metadata.current_operation = Some(operation.clone());
                    active.metadata.updated_at = operation.updated_at.clone();
                    index.certificates.insert(id.to_owned(), active);
                    let append = operations::append_event(
                        &mut index,
                        &operation.id,
                        id,
                        operations::CertificateEventKind::Accepted,
                        CertificateOperationStage::Queued,
                        None,
                    )
                    .and_then(|()| {
                        operations::append_event(
                            &mut index,
                            &operation.id,
                            id,
                            operations::CertificateEventKind::Started,
                            CertificateOperationStage::Queued,
                            None,
                        )
                    })
                    .and_then(|()| {
                        self.certificates_dir()
                            .and_then(|directory| persist_index(&directory, &index))
                    });
                    if let Err(error) = append {
                        index.certificates.insert(id.to_owned(), previous);
                        index.events = previous_events;
                        index.event_sequence = previous_sequence;
                        drop(index);
                        self.release_lease(id).await;
                        return Err(error);
                    }
                }
                drop(index);
                Ok(staged)
            }
            Err(error) => {
                self.release_lease(id).await;
                Err(error)
            }
        }
    }

    pub(crate) async fn stage_acme(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
        certificate_pem: String,
        private_key_pem: String,
    ) -> Result<StagedCertificate, CertificateError> {
        let stage_context = {
            let index = self.index.lock().await;
            match index.certificates.get(id) {
                None => Err(CertificateError::NotFound),
                Some(_) if index.pending_candidates.contains_key(id) => {
                    Err(CertificateError::OperationInProgress)
                }
                Some(current)
                    if !matches!(
                        current.metadata.operation,
                        CertificateOperation::Issuing | CertificateOperation::Renewing
                    ) =>
                {
                    Err(CertificateError::OperationInProgress)
                }
                Some(current) => Ok((
                    current.material_id.clone(),
                    current.metadata.operation,
                    current.metadata.current_operation.clone(),
                    current
                        .acme
                        .as_ref()
                        .map(|acme| acme.pending_dns_records.clone())
                        .unwrap_or_default(),
                )),
            }
        };
        let (base_material_id, activation_operation, mut current_operation, pending_dns_records) =
            stage_context?;
        let acme = self.stored_acme_configuration(id, request)?;
        let result = self.stage_import_with_lease(
            id,
            &CertificateImportRequest {
                certificate_pem,
                private_key_pem,
                chain_pem: None,
                required_domains: Some(request.domains.clone()),
            },
            CertificateSource::Acme,
            Some(request.environment),
            Some(acme),
        );
        let mut staged = result?;
        let now = utc_now()?;
        let Some(mut operation) = current_operation.take() else {
            // ACME material must be tied to the operation accepted by begin_issue or
            // begin_renewal.  Refusing an untracked candidate prevents an issued event from
            // being attributed to a fabricated operation after a partial restart.
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        };
        operation.stage = CertificateOperationStage::CertificateReady;
        operation.updated_at = now.clone();
        staged.stored.metadata.current_operation = Some(operation.clone());
        // The active entry owns the DNS cleanup journal. Carry the intents into the candidate as
        // well so a sidecar is self-contained if the index write is interrupted after staging.
        if let Some(acme) = staged.stored.acme.as_mut() {
            acme.pending_dns_records = pending_dns_records;
        }
        let candidate = StoredCertificateCandidate {
            version: CANDIDATE_MANIFEST_VERSION,
            staged: staged.stored.clone(),
            base_material_id,
            activation_operation,
            activation: CandidateActivation::default(),
        };
        let certificates_dir = self.ensure_certificates_dir()?;
        // Write the sidecar before the index pointer. This ordering makes a successful CA
        // response recoverable even if certificate-metadata.json is temporarily unavailable.
        persist_candidate_manifest(&certificates_dir, id, &candidate)?;
        let persistence = {
            let mut index = self.index.lock().await;
            let Some(active) = index.certificates.get_mut(id) else {
                self.release_lease(id).await;
                return Err(CertificateError::NotFound);
            };
            active.metadata.current_operation = Some(operation.clone());
            active.metadata.updated_at = now;
            index.pending_candidates.insert(id.to_owned(), candidate);
            operations::append_event(
                &mut index,
                &operation.id,
                id,
                CertificateEventKind::Issued,
                CertificateOperationStage::CertificateReady,
                None,
            )?;
            // The sidecar and in-memory candidate remain authoritative if the index write is
            // temporarily unavailable.  The caller can finalize the failure while holding the
            // lease, and a restart can reconcile the durable sidecar without placing a second
            // ACME order.
            persist_index(&certificates_dir, &index)
        };
        // Retain the lease through failure finalization so activation cannot race bookkeeping.
        persistence?;
        Ok(staged)
    }

    fn stored_acme_configuration(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
    ) -> Result<StoredAcmeConfiguration, CertificateError> {
        let dns_provider = request
            .dns_provider
            .as_ref()
            .map(|config| encrypt(config, id))
            .transpose()?;
        Ok(StoredAcmeConfiguration {
            contact_email: request.contact_email.clone(),
            challenge_type: request.challenge_type,
            dns_provider,
            pending_dns_records: Vec::new(),
        })
    }

    fn stage_import_with_lease(
        &self,
        id: &str,
        request: &CertificateImportRequest,
        source: CertificateSource,
        environment: Option<CertificateEnvironment>,
        acme: Option<StoredAcmeConfiguration>,
    ) -> Result<StagedCertificate, CertificateError> {
        if !is_canonical_uuid_v7(id)
            || request.certificate_pem.len() > MAX_CERTIFICATE_PEM_BYTES
            || request.private_key_pem.len() > MAX_PRIVATE_KEY_PEM_BYTES
            || request
                .chain_pem
                .as_ref()
                .is_some_and(|value| value.len() > MAX_CERTIFICATE_PEM_BYTES)
        {
            return Err(CertificateError::InvalidCertificate);
        }
        let parsed = ParsedCertificate::parse(request)?;
        let required = request.required_domains.as_deref().unwrap_or_default();
        if required.len() > 100
            || required
                .iter()
                .any(|domain| !certificate_covers(&parsed.domains, domain))
        {
            return Err(CertificateError::DomainMismatch);
        }

        let material_id = material_id(request);
        let certificates_dir = self.ensure_certificates_dir()?;
        let certificate_dir = certificates_dir
            .ensure_dir(id)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let versions_dir = certificate_dir
            .ensure_dir("versions")
            .map_err(|_| CertificateError::StoreUnavailable)?;
        ensure_material_version(
            &versions_dir,
            id,
            &material_id,
            parsed.fullchain.as_bytes(),
            request.private_key_pem.as_bytes(),
        )?;

        let challenge_type = acme
            .as_ref()
            .map(|configuration| configuration.challenge_type);

        Ok(StagedCertificate {
            id: id.to_owned(),
            stored: StoredCertificate {
                metadata: StoredMetadata {
                    id: id.to_owned(),
                    source,
                    environment,
                    domains: parsed.domains,
                    status: CertificateStatus::Valid,
                    operation: CertificateOperation::Idle,
                    issued_at: Some(parsed.issued_at),
                    expires_at: Some(parsed.expires_at),
                    issuer: Some(parsed.issuer),
                    fingerprint: Some(parsed.fingerprint),
                    last_error_code: None,
                    updated_at: utc_now()?,
                    attempt_count: 0,
                    last_attempt_at: None,
                    last_success_at: None,
                    current_operation: None,
                    challenge_type,
                    last_activated_at: None,
                    last_error_at: None,
                },
                material_id: Some(material_id),
                acme,
                next_attempt_at: None,
                retry_delay_seconds: None,
            },
        })
    }

    pub(crate) async fn pending_candidate_ids(&self) -> Result<Vec<String>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index.pending_candidates.keys().cloned().collect())
    }

    pub(crate) async fn begin_candidate_activation(
        &self,
        id: &str,
        scheduled: bool,
    ) -> Result<Option<StagedCertificate>, CertificateError> {
        self.acquire_lease(id).await?;
        let now = OffsetDateTime::now_utc();
        let (candidate, active) = {
            let index = self.index.lock().await;
            let Some(candidate) = index.pending_candidates.get(id).cloned() else {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            };
            let Some(active) = index.certificates.get(id).cloned() else {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::StoreUnavailable);
            };
            if active.material_id == candidate.staged.material_id {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            }
            if candidate.base_material_id != active.material_id {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::StoreUnavailable);
            }
            if active.metadata.operation != CertificateOperation::Idle {
                drop(index);
                self.release_lease(id).await;
                return Err(CertificateError::OperationInProgress);
            }
            if scheduled
                && candidate
                    .activation
                    .next_attempt_at
                    .as_deref()
                    .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
                    .is_some_and(|deadline| deadline > now)
            {
                drop(index);
                self.release_lease(id).await;
                return Ok(None);
            }
            (candidate, active)
        };

        let certificates_dir = match self.certificates_dir() {
            Ok(directory) => directory,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        if let Err(error) = validate_candidate_material(&certificates_dir, id, &candidate.staged) {
            self.finish_candidate_attention(id, error).await;
            return Err(error);
        }

        let now_string = match utc_now() {
            Ok(now) => now,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let mut attempted_candidate = candidate.clone();
        attempted_candidate.activation.attempt_count = attempted_candidate
            .activation
            .attempt_count
            .saturating_add(1);
        attempted_candidate.activation.last_attempt_at = Some(now_string.clone());
        attempted_candidate.activation.last_error_code = None;
        attempted_candidate.activation.next_attempt_at = None;
        let mut index = self.index.lock().await;
        let Some(current_candidate) = index.pending_candidates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return Ok(None);
        };
        let Some(current_active) = index.certificates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::StoreUnavailable);
        };
        if current_candidate.staged != candidate.staged
            || current_candidate.base_material_id != active.material_id
            || current_active.material_id != active.material_id
            || current_active.metadata.operation != CertificateOperation::Idle
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if let Err(error) = persist_candidate_manifest(&certificates_dir, id, &attempted_candidate)
        {
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }

        index
            .pending_candidates
            .insert(id.to_owned(), attempted_candidate.clone());
        let active_before = current_active;
        let mut active_attempt = active_before.clone();
        active_attempt.metadata.operation = attempted_candidate.activation_operation;
        active_attempt.metadata.last_error_code = None;
        active_attempt.metadata.updated_at = now_string;
        index.certificates.insert(id.to_owned(), active_attempt);
        // The sidecar is already durable. Retain both in-memory changes if the index is
        // temporarily unavailable; the caller can still attempt activation and a restart can
        // reconstruct the candidate from the sidecar.
        let _ = persist_index(&certificates_dir, &index);
        drop(index);
        Ok(Some(StagedCertificate {
            id: id.to_owned(),
            stored: attempted_candidate.staged,
        }))
    }

    pub(crate) async fn commit_staged(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let mut index = self.index.lock().await;
        if let Some(candidate) = index.pending_candidates.get(&staged.id).cloned() {
            let Some(previous) = index.certificates.get(&staged.id).cloned() else {
                drop(index);
                return Err(CertificateError::StoreUnavailable);
            };
            let mut staged_for_compare = staged.stored.clone();
            staged_for_compare.metadata.current_operation =
                candidate.staged.metadata.current_operation.clone();
            if candidate.staged != staged_for_compare
                || candidate.base_material_id != previous.material_id
            {
                drop(index);
                return Err(CertificateError::StoreUnavailable);
            }
            let mut committed = candidate.staged.clone();
            // The active entry owns the current provider configuration and DNS journal. Preserve
            // it across promotion so cleanup remains attributable to this certificate.
            committed.acme = previous.acme.clone().or(committed.acme);
            committed.metadata.operation = CertificateOperation::Idle;
            committed.metadata.status = CertificateStatus::Valid;
            committed.metadata.last_error_code = None;
            committed.metadata.attempt_count = 0;
            let activation_time = utc_now().ok();
            committed.metadata.last_success_at = activation_time.clone();
            committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            let operation_kind = committed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.kind);
            if let Some(operation) = committed.metadata.current_operation.as_mut() {
                operation.stage = CertificateOperationStage::Applied;
                operation.updated_at = committed
                    .metadata
                    .last_success_at
                    .clone()
                    .unwrap_or_else(|| operation.updated_at.clone());
            }
            committed.metadata.updated_at = activation_time
                .clone()
                .unwrap_or_else(|| committed.metadata.updated_at.clone());
            committed.metadata.last_activated_at = committed.metadata.last_success_at.clone();
            committed.next_attempt_at = None;
            committed.retry_delay_seconds = None;

            let previous_events = index.events.clone();
            let previous_event_sequence = index.event_sequence;
            let previous_candidate = index.pending_candidates.remove(&staged.id);
            let previous_active = index
                .certificates
                .insert(staged.id.clone(), committed.clone());
            let operation_id = committed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.id.clone());
            let append = operation_id.as_deref().map_or(Ok(()), |operation_id| {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Activated,
                    CertificateOperationStage::Applied,
                    None,
                )
                .and_then(|()| {
                    if operation_kind == Some(OperationKind::Renew) {
                        operations::append_event(
                            &mut index,
                            operation_id,
                            &staged.id,
                            operations::CertificateEventKind::Renewed,
                            CertificateOperationStage::Applied,
                            None,
                        )
                    } else {
                        Ok(())
                    }
                })
            });
            if let Err(error) = append {
                if let Some(previous_active) = previous_active.as_ref() {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous_active.clone());
                }
                if let Some(previous_candidate) = previous_candidate.as_ref() {
                    index
                        .pending_candidates
                        .insert(staged.id.clone(), previous_candidate.clone());
                }
                index.events = previous_events;
                index.event_sequence = previous_event_sequence;
                drop(index);
                return Err(error);
            }
            let result = self
                .certificates_dir()
                .and_then(|directory| persist_index(&directory, &index));
            if let Err(error) = result {
                if let Some(previous_active) = previous_active {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous_active);
                }
                if let Some(previous_candidate) = previous_candidate {
                    index
                        .pending_candidates
                        .insert(staged.id.clone(), previous_candidate);
                }
                index.events = previous_events;
                index.event_sequence = previous_event_sequence;
                // Keep the lease until the runtime has restored the previous Caddy state and
                // calls finish_candidate_failed. Releasing here would allow a new operation to
                // race that rollback while the candidate is still outstanding.
                drop(index);
                return Err(error);
            }
            let metadata = public_metadata_with_candidate(&committed, None);
            drop(index);
            if let Ok(directory) = self.certificates_dir() {
                let _ = remove_candidate_manifest(&directory, &staged.id);
            }
            self.release_lease(&staged.id).await;
            return Ok(metadata);
        }

        // A previous successful promotion may have left its cleanup manifest.
        // Remove it before another pointer change, otherwise restart could
        // mistake it for an outstanding candidate against a newer active version.
        self.certificates_dir()
            .and_then(|directory| remove_candidate_manifest(&directory, &staged.id))?;
        let mut committed = staged.stored.clone();
        if committed.metadata.source == CertificateSource::Acme {
            committed.metadata.attempt_count = 0;
            committed.metadata.last_success_at = utc_now().ok();
            committed.next_attempt_at = None;
            committed.retry_delay_seconds = None;
            if let Some(previous) = index.certificates.get(&staged.id) {
                committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            }
        } else if let Some(previous) = index.certificates.get(&staged.id) {
            // Importing replacement material is safe while a CA cooldown is
            // active, but it must not erase the cooldown or the ACME attempt
            // history that protects the next issuance request.
            committed.next_attempt_at = previous.next_attempt_at.clone();
            committed.retry_delay_seconds = previous.retry_delay_seconds;
            committed.metadata.attempt_count = previous.metadata.attempt_count;
            committed.metadata.last_attempt_at = previous.metadata.last_attempt_at.clone();
            committed.metadata.last_success_at = previous.metadata.last_success_at.clone();
        }
        let committed_at = utc_now().ok();
        if let Some(operation) = committed.metadata.current_operation.as_mut() {
            operation.stage = CertificateOperationStage::Applied;
            operation.updated_at = committed_at
                .clone()
                .unwrap_or_else(|| operation.updated_at.clone());
            committed.metadata.last_activated_at = Some(operation.updated_at.clone());
        }
        committed.metadata.updated_at =
            committed_at.unwrap_or_else(|| committed.metadata.updated_at.clone());
        let is_manual_import = committed.metadata.source == CertificateSource::Manual;
        let operation_id = committed
            .metadata
            .current_operation
            .as_ref()
            .map(|operation| operation.id.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let previous = index
            .certificates
            .insert(staged.id.clone(), committed.clone());
        let append = operation_id.as_deref().map_or(Ok(()), |operation_id| {
            let import_events = if is_manual_import {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Accepted,
                    CertificateOperationStage::Queued,
                    None,
                )
                .and_then(|()| {
                    operations::append_event(
                        &mut index,
                        operation_id,
                        &staged.id,
                        operations::CertificateEventKind::Started,
                        CertificateOperationStage::Queued,
                        None,
                    )
                })
            } else {
                Ok(())
            };
            import_events.and_then(|()| {
                operations::append_event(
                    &mut index,
                    operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Activated,
                    CertificateOperationStage::Applied,
                    None,
                )
            })
        });
        if let Err(error) = append {
            match previous.as_ref() {
                Some(previous) => {
                    index
                        .certificates
                        .insert(staged.id.clone(), previous.clone());
                }
                None => {
                    index.certificates.remove(&staged.id);
                }
            }
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            return Err(error);
        }
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = result {
            match previous {
                Some(previous) => {
                    index.certificates.insert(staged.id.clone(), previous);
                }
                None => {
                    index.certificates.remove(&staged.id);
                }
            }
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            return Err(error);
        }
        let metadata = public_metadata_with_candidate(&committed, None);
        drop(index);
        self.release_lease(&staged.id).await;
        Ok(metadata)
    }

    pub(crate) async fn discard_staged(&self, staged: &StagedCertificate) {
        let mut index = self.index.lock().await;
        if let Some(previous) = index.certificates.get(&staged.id).cloned()
            && previous
                .metadata
                .current_operation
                .as_ref()
                .is_some_and(|operation| {
                    staged
                        .stored
                        .metadata
                        .current_operation
                        .as_ref()
                        .is_some_and(|staged_operation| staged_operation.id == operation.id)
                })
        {
            let mut failed = previous;
            if let Some(operation) = failed.metadata.current_operation.as_mut() {
                operation.stage = CertificateOperationStage::Failed;
                operation.updated_at = utc_now().unwrap_or_else(|_| operation.updated_at.clone());
            }
            failed.metadata.updated_at = failed
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.updated_at.clone())
                .unwrap_or_else(|| failed.metadata.updated_at.clone());
            failed.metadata.status = if failed.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            failed.metadata.last_error_code =
                Some(CertificateError::RuntimeApplyFailed.code().to_owned());
            failed.metadata.last_error_at = utc_now().ok();
            index.certificates.insert(staged.id.clone(), failed);
            let operation_id = index
                .certificates
                .get(&staged.id)
                .and_then(|entry| entry.metadata.current_operation.as_ref())
                .map(|operation| operation.id.clone());
            if let Some(operation_id) = operation_id {
                let _ = operations::append_event(
                    &mut index,
                    &operation_id,
                    &staged.id,
                    operations::CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(CertificateError::RuntimeApplyFailed.code().to_owned()),
                );
            }
            if let Ok(directory) = self.certificates_dir() {
                let _ = persist_index(&directory, &index);
            }
        }
        drop(index);
        self.release_lease(&staged.id).await;
    }

    pub(crate) async fn finish_candidate_failed(
        &self,
        staged: &StagedCertificate,
        error: CertificateError,
    ) {
        let mut index = self.index.lock().await;
        let Some(previous_candidate) = index.pending_candidates.get(&staged.id).cloned() else {
            drop(index);
            self.release_lease(&staged.id).await;
            return;
        };
        let mut staged_for_compare = staged.stored.clone();
        staged_for_compare.metadata.current_operation =
            previous_candidate.staged.metadata.current_operation.clone();
        if previous_candidate.staged != staged_for_compare {
            drop(index);
            self.release_lease(&staged.id).await;
            return;
        }
        let now = utc_now().ok();
        let mut candidate = previous_candidate;
        candidate.activation.attempt_count = candidate.activation.attempt_count.max(1);
        let delay = next_candidate_retry_delay(
            &staged.id,
            candidate.activation.attempt_count,
            candidate.activation.retry_delay_seconds,
        );
        candidate.activation.retry_delay_seconds = Some(delay);
        candidate.activation.next_attempt_at = candidate_retry_deadline(delay);
        candidate.activation.last_error_code = Some(error.code().to_owned());
        if candidate.activation.last_attempt_at.is_none() {
            candidate.activation.last_attempt_at = now.clone();
        }
        if let Some(operation) = candidate.staged.metadata.current_operation.as_mut() {
            operation.stage = CertificateOperationStage::RetryScheduled;
            if let Some(now) = now.clone() {
                operation.updated_at = now;
            }
        }
        index
            .pending_candidates
            .insert(staged.id.clone(), candidate.clone());
        if let Some(active) = index.certificates.get_mut(&staged.id) {
            active.metadata.operation = CertificateOperation::Idle;
            active.metadata.status = if active.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            active.metadata.last_error_code = Some(error.code().to_owned());
            active.metadata.last_error_at = now.clone();
            active.metadata.current_operation = candidate.staged.metadata.current_operation.clone();
            if let Some(now) = now {
                active.metadata.updated_at = now;
            }
        }
        // Preserve the candidate in memory even if either persistence step is unavailable. The
        // sidecar is attempted first so the issued material remains recoverable after a restart.
        if let Ok(directory) = self.certificates_dir() {
            let _ = persist_candidate_manifest(&directory, &staged.id, &candidate);
            if let Some(operation) = candidate.staged.metadata.current_operation.as_ref() {
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    &staged.id,
                    operations::CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(error.code().to_owned()),
                );
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    &staged.id,
                    operations::CertificateEventKind::RetryScheduled,
                    CertificateOperationStage::RetryScheduled,
                    Some(error.code().to_owned()),
                );
            }
            let _ = persist_index(&directory, &index);
        }
        drop(index);
        self.release_lease(&staged.id).await;
    }

    async fn finish_candidate_attention(&self, id: &str, error: CertificateError) {
        let mut index = self.index.lock().await;
        let Some(mut candidate) = index.pending_candidates.get(id).cloned() else {
            drop(index);
            self.release_lease(id).await;
            return;
        };
        let Some(operation) = candidate.staged.metadata.current_operation.as_mut() else {
            drop(index);
            self.release_lease(id).await;
            return;
        };
        operation.stage = CertificateOperationStage::NeedsAttention;
        operation.updated_at = utc_now().unwrap_or_else(|_| operation.updated_at.clone());
        candidate.activation.last_error_code = Some(error.code().to_owned());
        candidate.activation.next_attempt_at = None;
        candidate.activation.retry_delay_seconds = None;
        index
            .pending_candidates
            .insert(id.to_owned(), candidate.clone());
        let candidate_operation = candidate.staged.metadata.current_operation.clone();
        if let Some(active) = index.certificates.get_mut(id) {
            active.metadata.operation = CertificateOperation::Idle;
            active.metadata.last_error_code = Some(error.code().to_owned());
            active.metadata.last_error_at = utc_now().ok();
            active.metadata.current_operation = candidate_operation.clone();
            active.metadata.updated_at =
                utc_now().unwrap_or_else(|_| active.metadata.updated_at.clone());
        }
        if let Ok(directory) = self.certificates_dir() {
            let _ = persist_candidate_manifest(&directory, id, &candidate);
            if let Some(operation) = candidate_operation {
                let _ = operations::append_event(
                    &mut index,
                    &operation.id,
                    id,
                    CertificateEventKind::Failed,
                    CertificateOperationStage::NeedsAttention,
                    Some(error.code().to_owned()),
                );
            }
            let _ = persist_index(&directory, &index);
        }
        drop(index);
        self.release_lease(id).await;
    }

    pub(crate) async fn begin_issue(
        &self,
        id: &str,
        request: CertificateIssueRequest,
        renewal: bool,
    ) -> Result<CertificateMetadata, CertificateError> {
        if !is_canonical_uuid_v7(id)
            || request.domains.is_empty()
            || request.domains.len() > 100
            || request.domains.iter().any(|domain| {
                !is_acme_request_domain(domain, request.challenge_type, request.environment)
            })
            || has_duplicate_domains(&request.domains)
            || (request.challenge_type == AcmeChallengeType::Http01
                && request
                    .domains
                    .iter()
                    .any(|domain| domain.starts_with("*.")))
            || (request.challenge_type == AcmeChallengeType::Http01
                && request.dns_provider.is_some())
            || (request.challenge_type == AcmeChallengeType::Dns01
                && request.dns_provider.is_none())
            || (!renewal && !request.accept_terms)
            || request
                .contact_email
                .as_deref()
                .is_some_and(|email| !is_valid_email(email))
        {
            return Err(if !request.accept_terms && !renewal {
                CertificateError::TermsRequired
            } else if request.challenge_type == AcmeChallengeType::Dns01
                && request.dns_provider.is_none()
            {
                CertificateError::AcmeDnsRequired
            } else {
                CertificateError::AcmeDomainInvalid
            });
        }
        let now = utc_now()?;
        let now_instant = OffsetDateTime::now_utc();
        let acme = if renewal {
            None
        } else {
            Some(self.stored_acme_configuration(id, &request)?)
        };
        self.acquire_lease(id).await?;
        let mut index = self.index.lock().await;
        if index
            .certificates
            .get(id)
            .is_some_and(|current| current.metadata.operation != CertificateOperation::Idle)
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index
            .certificates
            .get(id)
            .is_some_and(|current| retry_is_blocking(current, now_instant))
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if account_retry_is_blocking(&index, request.environment, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if !renewal
            && index
                .certificates
                .get(id)
                .and_then(|entry| entry.acme.as_ref())
                .is_some_and(|acme| !acme.pending_dns_records.is_empty())
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }
        let operation = operations::new_operation(if renewal {
            OperationKind::Renew
        } else {
            OperationKind::Issue
        })?;
        let stored = if let Some(current) = index.certificates.get(id) {
            let mut preserved = current.clone();
            let attempt_count = preserved.metadata.attempt_count.saturating_add(1);
            preserved.metadata.operation = if renewal {
                CertificateOperation::Renewing
            } else {
                CertificateOperation::Issuing
            };
            preserved.metadata.last_error_code = None;
            preserved.metadata.updated_at = now.clone();
            preserved.metadata.attempt_count = attempt_count;
            preserved.metadata.last_attempt_at = Some(now.clone());
            preserved.metadata.current_operation = Some(operation.clone());
            preserved.metadata.challenge_type = Some(request.challenge_type);
            preserved.next_attempt_at = None;
            if !renewal {
                // A replacement order must journal the credentials for its own
                // DNS records before any provider request.  There are no
                // pending records at this point, so replacing this config
                // cannot strand the previous provider credentials.
                preserved.acme = acme;
            }
            preserved
        } else {
            StoredCertificate {
                metadata: StoredMetadata {
                    id: id.to_owned(),
                    source: CertificateSource::Acme,
                    environment: Some(request.environment),
                    domains: canonical_domains(&request.domains),
                    status: CertificateStatus::Pending,
                    operation: if renewal {
                        CertificateOperation::Renewing
                    } else {
                        CertificateOperation::Issuing
                    },
                    issued_at: None,
                    expires_at: None,
                    issuer: None,
                    fingerprint: None,
                    last_error_code: None,
                    updated_at: now.clone(),
                    attempt_count: 1,
                    last_attempt_at: Some(now),
                    last_success_at: None,
                    current_operation: Some(operation.clone()),
                    challenge_type: Some(request.challenge_type),
                    last_activated_at: None,
                    last_error_at: None,
                },
                material_id: None,
                acme: Some(acme.expect("new ACME requests always have configuration")),
                next_attempt_at: None,
                retry_delay_seconds: None,
            }
        };
        let previous = index.certificates.insert(id.to_owned(), stored.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let operation_id = operation.id.as_str();
        if let Err(error) = operations::append_event(
            &mut index,
            operation_id,
            id,
            operations::CertificateEventKind::Accepted,
            CertificateOperationStage::Queued,
            None,
        )
        .and_then(|()| {
            operations::append_event(
                &mut index,
                operation_id,
                id,
                operations::CertificateEventKind::Started,
                CertificateOperationStage::Queued,
                None,
            )
        }) {
            index.events = previous_events.clone();
            index.event_sequence = previous_event_sequence;
            match previous {
                Some(previous) => {
                    index.certificates.insert(id.to_owned(), previous);
                }
                None => {
                    index.certificates.remove(id);
                }
            }
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        let persistence = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = persistence {
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            match previous {
                Some(previous) => {
                    index.certificates.insert(id.to_owned(), previous);
                }
                None => {
                    index.certificates.remove(id);
                }
            }
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        Ok(public_metadata(&stored))
    }

    pub(crate) async fn begin_renewal(
        &self,
        id: &str,
    ) -> Result<(CertificateMetadata, CertificateIssueRequest), CertificateError> {
        self.acquire_lease(id).await?;
        let now = match utc_now() {
            Ok(now) => now,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let now_instant = OffsetDateTime::now_utc();
        let mut index = self.index.lock().await;
        let Some(current) = index.certificates.get(id) else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::NotFound);
        };
        if current.metadata.source != CertificateSource::Acme {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::InvalidCertificate);
        }
        if current.metadata.operation != CertificateOperation::Idle {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if retry_is_blocking(current, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        let Some(environment) = current.metadata.environment else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::AcmeFailed);
        };
        if account_retry_is_blocking(&index, environment, now_instant) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        let Some(acme) = current.acme.as_ref() else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::InvalidCertificate);
        };
        let challenge_type = acme.challenge_type;
        let operation = match operations::new_operation(OperationKind::Renew) {
            Ok(operation) => operation,
            Err(error) => {
                drop(index);
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let previous = current.clone();
        let mut attempted = previous.clone();
        attempted.metadata.operation = CertificateOperation::Renewing;
        attempted.metadata.last_error_code = None;
        attempted.next_attempt_at = None;
        attempted.metadata.attempt_count = attempted.metadata.attempt_count.saturating_add(1);
        attempted.metadata.last_attempt_at = Some(now.clone());
        attempted.metadata.updated_at = now;
        attempted.metadata.current_operation = Some(operation.clone());
        index.certificates.insert(id.to_owned(), attempted.clone());
        let previous_events = index.events.clone();
        let previous_event_sequence = index.event_sequence;
        let operation_id = operation.id.as_str();
        if let Err(error) = operations::append_event(
            &mut index,
            operation_id,
            id,
            operations::CertificateEventKind::Accepted,
            CertificateOperationStage::Queued,
            None,
        )
        .and_then(|()| {
            operations::append_event(
                &mut index,
                operation_id,
                id,
                operations::CertificateEventKind::Started,
                CertificateOperationStage::Queued,
                None,
            )
        }) {
            index.certificates.insert(id.to_owned(), previous.clone());
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        if let Err(error) = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
        {
            index.certificates.insert(id.to_owned(), previous);
            index.events = previous_events;
            index.event_sequence = previous_event_sequence;
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }

        let dns_provider = match attempted
            .acme
            .as_ref()
            .and_then(|acme| acme.dns_provider.as_ref())
            .map(|encrypted| super::dns::decrypt(encrypted, id))
            .transpose()
        {
            Ok(dns_provider) => dns_provider,
            Err(error) => {
                drop(index);
                // Record a durable, actionable failure while retaining the
                // lease.  `finish_failed` releases it after the index update;
                // releasing first would let a concurrent operation race in
                // and overwrite the recovery state.
                self.finish_failed(id, error).await;
                return Err(error);
            }
        };
        let request = CertificateIssueRequest {
            domains: attempted.metadata.domains.clone(),
            environment,
            contact_email: attempted
                .acme
                .as_ref()
                .and_then(|acme| acme.contact_email.clone()),
            challenge_type,
            dns_provider,
            accept_terms: true,
        };
        Ok((public_metadata(&attempted), request))
    }

    /// Extend the durable retry deadline from an ACME `Retry-After` response.
    ///
    /// The ACME operation lease is held by the caller while this method runs,
    /// so this method deliberately does not acquire it again.  If persisting
    /// the update fails, the conservative in-memory deadline is retained until
    /// the next restart rather than allowing an immediate retry in this
    /// process.
    pub(crate) async fn defer_acme_retry(
        &self,
        id: &str,
        deadline: OffsetDateTime,
    ) -> Result<(), CertificateError> {
        if !is_canonical_uuid_v7(id) {
            return Err(CertificateError::NotFound);
        }
        let deadline = deadline
            .format(&Rfc3339)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let mut index = self.index.lock().await;
        let Some(previous) = index.certificates.get(id).cloned() else {
            return Err(CertificateError::NotFound);
        };
        if previous.metadata.source != CertificateSource::Acme
            && previous.metadata.operation == CertificateOperation::Idle
        {
            return Err(CertificateError::InvalidCertificate);
        }
        let mut updated = previous;
        updated.next_attempt_at =
            max_retry_deadline_string(updated.next_attempt_at.as_deref(), &deadline)
                .or(Some(deadline));
        if let Ok(now) = utc_now() {
            updated.metadata.updated_at = now;
        }
        index.certificates.insert(id.to_owned(), updated);
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        // Keep `updated` in memory if persistence fails.  Retrying before the
        // observed CA deadline would be less safe than requiring a restart.
        result
    }

    /// Extend the durable retry deadline for an ACME account environment.
    ///
    /// The deadline is shared by every certificate using that environment, so
    /// a CA rate limit cannot be bypassed by starting a different certificate
    /// order.  As with the per-certificate deadline, an in-memory update is
    /// retained when persistence fails so this process remains fail-closed.
    pub(crate) async fn defer_acme_account_retry(
        &self,
        environment: CertificateEnvironment,
        deadline: OffsetDateTime,
    ) -> Result<(), CertificateError> {
        let deadline = deadline
            .format(&Rfc3339)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        let mut index = self.index.lock().await;
        let current = index.acme_retry_until.get(&environment).map(String::as_str);
        let updated = max_retry_deadline_string(current, &deadline).unwrap_or(deadline);
        index.acme_retry_until.insert(environment, updated);
        self.certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
    }

    pub(crate) async fn finish_failed(&self, id: &str, error: CertificateError) {
        let pending_candidate = {
            let index = self.index.lock().await;
            index
                .pending_candidates
                .get(id)
                .map(|candidate| StagedCertificate {
                    id: id.to_owned(),
                    stored: candidate.staged.clone(),
                })
        };
        if let Some(staged) = pending_candidate {
            // A CA response may have been journaled just before a storage or cleanup error was
            // reported. Keep that candidate authoritative so this failure cannot open a second
            // order or erase recoverable material.
            self.finish_candidate_failed(&staged, error).await;
            return;
        }
        let mut index = self.index.lock().await;
        if let Some(entry) = index.certificates.get_mut(id) {
            let had_acme_operation = entry.metadata.operation != CertificateOperation::Idle;
            let retryable = entry.metadata.source == CertificateSource::Acme || had_acme_operation;
            let operation_id = entry
                .metadata
                .current_operation
                .as_ref()
                .map(|operation| operation.id.clone());
            entry.metadata.operation = CertificateOperation::Idle;
            entry.metadata.status = if entry.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            entry.metadata.last_error_code = Some(error.code().to_owned());
            if retryable {
                entry.metadata.attempt_count = entry.metadata.attempt_count.max(1);
                let delay =
                    next_retry_delay(id, entry.metadata.attempt_count, entry.retry_delay_seconds);
                entry.retry_delay_seconds = Some(delay);
                if let Some(deadline) = retry_deadline(delay) {
                    entry.next_attempt_at =
                        max_retry_deadline(entry.next_attempt_at.as_deref(), deadline);
                }
            }
            let now = utc_now().ok();
            if let Some(now) = now.clone() {
                if entry.metadata.last_attempt_at.is_none()
                    && entry.metadata.source == CertificateSource::Acme
                {
                    entry.metadata.last_attempt_at = Some(now.clone());
                }
                entry.metadata.last_error_at = Some(now.clone());
                if let Some(operation) = entry.metadata.current_operation.as_mut() {
                    operation.stage = if retryable {
                        CertificateOperationStage::RetryScheduled
                    } else {
                        CertificateOperationStage::Failed
                    };
                    operation.updated_at = now;
                }
                entry.metadata.updated_at =
                    utc_now().unwrap_or_else(|_| entry.metadata.updated_at.clone());
            }
            if let Some(operation_id) = operation_id {
                let stage = if retryable {
                    CertificateOperationStage::RetryScheduled
                } else {
                    CertificateOperationStage::Failed
                };
                let _ = operations::append_event(
                    &mut index,
                    &operation_id,
                    id,
                    CertificateEventKind::Failed,
                    CertificateOperationStage::Failed,
                    Some(error.code().to_owned()),
                );
                if retryable {
                    let _ = operations::append_event(
                        &mut index,
                        &operation_id,
                        id,
                        CertificateEventKind::RetryScheduled,
                        stage,
                        Some(error.code().to_owned()),
                    );
                }
            }
            let _ = self
                .certificates_dir()
                .and_then(|directory| persist_index(&directory, &index));
        }
        drop(index);
        self.release_lease(id).await;
    }

    /// Return DNS records left by an interrupted ACME operation.  The intent
    /// values contain no provider credentials and are only used to identify
    /// records owned by this certificate during restart/retry cleanup.
    pub(crate) async fn pending_dns_records(
        &self,
        id: &str,
    ) -> Result<Vec<DnsRecordIntent>, CertificateError> {
        let index = self.index.lock().await;
        index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)
            .map(|entry| {
                entry
                    .acme
                    .as_ref()
                    .map(|acme| acme.pending_dns_records.clone())
                    .unwrap_or_default()
            })
    }

    pub(crate) async fn pending_dns_cleanup_ids(&self) -> Result<Vec<String>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index
            .certificates
            .iter()
            .filter(|(_, entry)| {
                entry
                    .acme
                    .as_ref()
                    .is_some_and(|acme| !acme.pending_dns_records.is_empty())
            })
            .map(|(id, _)| id.clone())
            .collect())
    }

    /// Acquire the certificate lease and return the durable DNS cleanup work.  Credentials are
    /// decrypted only while the lease is held; callers must invoke `finish_dns_cleanup` on every
    /// returned item, including provider failures, so another operation cannot race cleanup.
    pub(crate) async fn begin_dns_cleanup(
        &self,
        id: &str,
    ) -> Result<
        Option<(
            CertificateEnvironment,
            DnsProviderConfig,
            Vec<DnsRecordIntent>,
        )>,
        CertificateError,
    > {
        self.acquire_lease(id).await?;
        let result = {
            let index = self.index.lock().await;
            match index.certificates.get(id) {
                None => Err(CertificateError::NotFound),
                Some(entry) => match entry.acme.as_ref() {
                    None => Ok(None),
                    Some(acme) if acme.pending_dns_records.is_empty() => Ok(None),
                    Some(acme) => entry
                        .metadata
                        .environment
                        .ok_or(CertificateError::DnsCredentialsUnavailable)
                        .and_then(|environment| {
                            acme.dns_provider
                                .as_ref()
                                .ok_or(CertificateError::DnsCredentialsUnavailable)
                                .and_then(|encrypted| {
                                    super::dns::decrypt(encrypted, id).map(|provider| {
                                        (environment, provider, acme.pending_dns_records.clone())
                                    })
                                })
                        })
                        .map(Some),
                },
            }
        };
        match result {
            Ok(Some(work)) => Ok(Some(work)),
            Ok(None) => {
                self.release_lease(id).await;
                Ok(None)
            }
            Err(error) => {
                self.release_lease(id).await;
                Err(error)
            }
        }
    }

    pub(crate) async fn finish_dns_cleanup(&self, id: &str) {
        self.release_lease(id).await;
    }

    /// Update the durable DNS cleanup journal while the caller owns the
    /// certificate operation lease.  The previous index entry is restored if
    /// persistence fails, so an intent can never disappear silently.
    pub(crate) async fn set_pending_dns_records(
        &self,
        id: &str,
        records: Vec<DnsRecordIntent>,
    ) -> Result<(), CertificateError> {
        if !is_canonical_uuid_v7(id)
            || records.len() > 256
            || records
                .iter()
                .any(|record| !dns_intent_belongs_to(record, id))
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let mut index = self.index.lock().await;
        let Some(previous) = index.certificates.get(id).cloned() else {
            return Err(CertificateError::NotFound);
        };
        if previous
            .acme
            .as_ref()
            .is_none_or(|acme| acme.challenge_type != AcmeChallengeType::Dns01)
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let mut updated = previous.clone();
        let now = utc_now()?;
        updated.metadata.updated_at = now;
        let Some(acme) = updated.acme.as_mut() else {
            return Err(CertificateError::DnsProviderInvalid);
        };
        acme.pending_dns_records = records;
        index.certificates.insert(id.to_owned(), updated);
        let result = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = result {
            index.certificates.insert(id.to_owned(), previous);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) async fn load_acme_account(
        &self,
        environment: CertificateEnvironment,
    ) -> Result<Option<Vec<u8>>, CertificateError> {
        let directory = self
            .ensure_certificates_dir()?
            .ensure_dir("acme-accounts")
            .map_err(|_| CertificateError::StoreUnavailable)?;
        read_regular_private_file(
            &directory,
            &format!("{}.json", environment_name(environment)),
            MAX_PRIVATE_KEY_PEM_BYTES,
        )
    }

    pub(crate) async fn store_acme_account(
        &self,
        environment: CertificateEnvironment,
        credentials: &[u8],
    ) -> Result<(), CertificateError> {
        if credentials.len() > MAX_PRIVATE_KEY_PEM_BYTES {
            return Err(CertificateError::StoreUnavailable);
        }
        let directory = self
            .ensure_certificates_dir()?
            .ensure_dir("acme-accounts")
            .map_err(|_| CertificateError::StoreUnavailable)?;
        write_private_file(
            &directory,
            &format!("{}.json", environment_name(environment)),
            credentials,
        )
    }

    pub(crate) async fn covers_domains(
        &self,
        id: &str,
        domains: &[String],
        require_unexpired: bool,
    ) -> Result<bool, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        // Previously verified routes survive a restart after certificate expiry, just as they
        // survive expiry in the running process. New activations still require a current cert.
        // Recovery continues to require valid stored material and matching domain ownership.
        Ok(entry.metadata.status == CertificateStatus::Valid
            && (!require_unexpired
                || entry
                    .metadata
                    .expires_at
                    .as_deref()
                    .is_some_and(|expires_at| {
                        OffsetDateTime::parse(expires_at, &Rfc3339)
                            .is_ok_and(|expires_at| expires_at > OffsetDateTime::now_utc())
                    }))
            && domains
                .iter()
                .all(|domain| certificate_covers(&entry.metadata.domains, domain)))
    }

    pub(crate) fn staged_material(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMaterial, CertificateError> {
        staged.material(&self.certificates_dir()?)
    }

    pub(crate) async fn material(&self, id: &str) -> Result<CertificateMaterial, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        if entry.metadata.status != CertificateStatus::Valid {
            return Err(CertificateError::NotFound);
        }
        let material_id = entry
            .material_id
            .clone()
            .ok_or(CertificateError::NotFound)?;
        material_at(&self.certificates_dir()?, id, &material_id)
    }

    pub(crate) async fn delete_if_unused(
        &self,
        id: &str,
        in_use: bool,
    ) -> Result<(), CertificateError> {
        if in_use {
            return Err(CertificateError::InUse);
        }
        let certificates_dir = self.certificates_dir()?;
        self.acquire_lease(id).await?;
        let mut index = self.index.lock().await;
        let Some(entry) = index.certificates.get(id) else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::NotFound);
        };
        if entry.metadata.operation != CertificateOperation::Idle {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if index.pending_candidates.contains_key(id) {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        if entry
            .acme
            .as_ref()
            .is_some_and(|acme| !acme.pending_dns_records.is_empty())
        {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }

        let tombstone = format!(
            ".deleted-{id}-{}-{}",
            std::process::id(),
            OffsetDateTime::now_utc().unix_timestamp_nanos(),
        );
        let moved_directory = match certificates_dir.open_dir(id) {
            Ok(_) => certificates_dir
                .rename_dir(id, &tombstone)
                .map(|_| Some(tombstone.clone()))
                .map_err(|_| CertificateError::StoreUnavailable),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if entry.material_id.is_some() {
                    Err(CertificateError::StoreUnavailable)
                } else {
                    Ok(None)
                }
            }
            Err(_) => Err(CertificateError::StoreUnavailable),
        };
        let moved_directory = match moved_directory {
            Ok(moved_directory) => moved_directory,
            Err(error) => {
                drop(index);
                self.release_lease(id).await;
                return Err(error);
            }
        };
        let removed = index.certificates.remove(id).expect("entry checked");
        if let Err(error) = persist_index(&certificates_dir, &index) {
            index.certificates.insert(id.to_owned(), removed);
            let restore = moved_directory
                .as_ref()
                .is_none_or(|tombstone| certificates_dir.rename_dir(tombstone, id).is_ok());
            drop(index);
            self.release_lease(id).await;
            return if restore {
                Err(error)
            } else {
                Err(CertificateError::StoreUnavailable)
            };
        }
        drop(index);
        if let Some(tombstone) = moved_directory
            && certificates_dir.remove_dir_tree(&tombstone).is_err()
        {
            self.release_lease(id).await;
            return Err(CertificateError::StoreUnavailable);
        }
        self.release_lease(id).await;
        Ok(())
    }

    /// Remove unreferenced material versions after the caller has confirmed that the active
    /// runtime and index agree. Candidate versions, active versions, and every version belonging
    /// to a leased certificate remain untouched so an in-flight activation can always roll back.
    pub(crate) async fn collect_garbage(&self) -> Result<(), CertificateError> {
        // Operations acquire the lease before the index. Keep the same lock order here so a
        // concurrent activation cannot mutate a pointer while versions are being enumerated.
        let leases = self.leases.lock().await;
        let index = self.index.lock().await;
        let certificates_dir = self.certificates_dir()?;
        let mut protected = BTreeMap::<String, BTreeSet<String>>::new();
        for (id, entry) in &index.certificates {
            if let Some(material_id) = &entry.material_id {
                protected
                    .entry(id.clone())
                    .or_default()
                    .insert(material_id.clone());
            }
            if let Some(candidate) = index.pending_candidates.get(id)
                && let Some(material_id) = &candidate.staged.material_id
            {
                protected
                    .entry(id.clone())
                    .or_default()
                    .insert(material_id.clone());
            }
        }

        let certificate_entries = std::fs::read_dir(certificates_dir.path())
            .map_err(|_| CertificateError::StoreUnavailable)?;
        for certificate_entry in certificate_entries {
            let certificate_entry =
                certificate_entry.map_err(|_| CertificateError::StoreUnavailable)?;
            let file_type = certificate_entry
                .file_type()
                .map_err(|_| CertificateError::StoreUnavailable)?;
            if !file_type.is_dir() {
                continue;
            }
            let Some(id) = certificate_entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_canonical_uuid_v7(&id) || !index.certificates.contains_key(&id) {
                continue;
            }
            if leases.contains(&id) {
                continue;
            }
            let certificate_dir = certificates_dir
                .open_dir(&id)
                .map_err(|_| CertificateError::StoreUnavailable)?;
            let versions_dir = match certificate_dir.open_dir("versions") {
                Ok(directory) => directory,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(_) => return Err(CertificateError::StoreUnavailable),
            };
            let versions = std::fs::read_dir(versions_dir.path())
                .map_err(|_| CertificateError::StoreUnavailable)?;
            for version in versions {
                let version = version.map_err(|_| CertificateError::StoreUnavailable)?;
                let file_type = version
                    .file_type()
                    .map_err(|_| CertificateError::StoreUnavailable)?;
                if !file_type.is_dir() {
                    continue;
                }
                let Some(version_id) = version.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                // Staging and tombstone directories may be involved in a recovery path. Leave
                // them for the explicit maintenance/recovery code instead of racing it here.
                if version_id.starts_with('.')
                    || version_id.len() != 64
                    || !version_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    continue;
                }
                if protected
                    .get(&id)
                    .is_some_and(|versions| versions.contains(&version_id))
                {
                    continue;
                }
                versions_dir
                    .remove_dir_tree(&version_id)
                    .map_err(|_| CertificateError::StoreUnavailable)?;
            }
        }
        drop(index);
        drop(leases);
        Ok(())
    }

    async fn acquire_lease(&self, id: &str) -> Result<(), CertificateError> {
        let mut leases = self.leases.lock().await;
        if !leases.insert(id.to_owned()) {
            return Err(CertificateError::OperationInProgress);
        }
        Ok(())
    }

    async fn release_lease(&self, id: &str) {
        self.leases.lock().await.remove(id);
    }

    fn state_dir(&self) -> Result<SafeDir, CertificateError> {
        state_dir(&self.state_dir).map_err(|_| CertificateError::StoreUnavailable)
    }

    fn certificates_dir(&self) -> Result<SafeDir, CertificateError> {
        self.state_dir()?
            .open_dir(CERTIFICATES_DIRECTORY)
            .map_err(|_| CertificateError::StoreUnavailable)
    }

    fn ensure_certificates_dir(&self) -> Result<SafeDir, CertificateError> {
        self.state_dir()?
            .ensure_dir(CERTIFICATES_DIRECTORY)
            .map_err(|_| CertificateError::StoreUnavailable)
    }
}

fn ensure_issued_event(
    index: &mut CertificateIndex,
    id: &str,
    candidate: &StoredCertificateCandidate,
) -> Result<(), CertificateError> {
    let operation = candidate
        .staged
        .metadata
        .current_operation
        .as_ref()
        .ok_or(CertificateError::StoreUnavailable)?;
    if !operations::current_operation_is_valid(operation)
        || !matches!(operation.kind, OperationKind::Issue | OperationKind::Renew)
    {
        return Err(CertificateError::StoreUnavailable);
    }

    {
        let active = index
            .certificates
            .get_mut(id)
            .ok_or(CertificateError::StoreUnavailable)?;
        match active.metadata.current_operation.as_ref() {
            Some(current) if current.id != operation.id => {
                return Err(CertificateError::StoreUnavailable);
            }
            Some(_) => {}
            None => {
                active.metadata.current_operation = Some(operation.clone());
            }
        }
    }

    let already_recorded = index.events.iter().any(|event| {
        event.operation_id == operation.id
            && event.certificate_id == id
            && event.kind == CertificateEventKind::Issued
            && event.stage == CertificateOperationStage::CertificateReady
            && event.error_code.is_none()
    });
    if already_recorded {
        return Ok(());
    }

    operations::append_event(
        index,
        &operation.id,
        id,
        CertificateEventKind::Issued,
        CertificateOperationStage::CertificateReady,
        None,
    )?;
    Ok(())
}

fn reconcile_candidate_manifests(
    certificates_dir: &SafeDir,
    index: &mut CertificateIndex,
) -> Result<bool, CertificateError> {
    let certificate_ids: Vec<String> = index.certificates.keys().cloned().collect();
    let mut changed = false;

    for id in certificate_ids {
        let mut sidecar = read_candidate_manifest(certificates_dir, &id)?;
        let mut indexed = index.pending_candidates.get(&id).cloned();
        if indexed.is_some() || sidecar.is_some() {
            let candidate_operation = indexed
                .as_ref()
                .and_then(|candidate| candidate.staged.metadata.current_operation.clone())
                .or_else(|| {
                    sidecar
                        .as_ref()
                        .and_then(|candidate| candidate.staged.metadata.current_operation.clone())
                })
                .map(Ok)
                .unwrap_or_else(|| {
                    let activation_operation = indexed
                        .as_ref()
                        .map(|candidate| candidate.activation_operation)
                        .or_else(|| {
                            sidecar
                                .as_ref()
                                .map(|candidate| candidate.activation_operation)
                        });
                    operations::new_operation(match activation_operation {
                        Some(CertificateOperation::Renewing) => OperationKind::Renew,
                        _ => OperationKind::Issue,
                    })
                })?;
            if let Some(candidate) = indexed.as_mut()
                && candidate.staged.metadata.current_operation.is_none()
            {
                candidate.staged.metadata.current_operation = Some(candidate_operation.clone());
                changed = true;
            }
            if let Some(candidate) = sidecar.as_mut()
                && candidate.staged.metadata.current_operation.is_none()
            {
                candidate.staged.metadata.current_operation = Some(candidate_operation.clone());
                changed = true;
            }
            if let Some(active) = index.certificates.get_mut(&id) {
                let active_operation = active.metadata.current_operation.clone();
                match active_operation.as_ref() {
                    Some(current) if current.id == candidate_operation.id => {
                        if current != &candidate_operation {
                            active.metadata.current_operation = Some(candidate_operation.clone());
                            active.metadata.updated_at = candidate_operation.updated_at.clone();
                            changed = true;
                        }
                    }
                    Some(_) => {}
                    None => {
                        active.metadata.current_operation = Some(candidate_operation);
                        changed = true;
                    }
                }
            }
        }
        match (indexed, sidecar) {
            (Some(indexed), Some(sidecar)) => {
                if !candidate_is_valid(&id, &sidecar) || !candidate_is_valid(&id, &indexed) {
                    return Err(CertificateError::StoreUnavailable);
                }
                let active = index
                    .certificates
                    .get(&id)
                    .ok_or(CertificateError::StoreUnavailable)?;
                if active.material_id == sidecar.staged.material_id {
                    index.pending_candidates.remove(&id);
                    remove_candidate_manifest(certificates_dir, &id)?;
                    changed = true;
                    continue;
                }
                if sidecar.base_material_id != active.material_id
                    || indexed.base_material_id != active.material_id
                {
                    return Err(CertificateError::StoreUnavailable);
                }
                if indexed != sidecar {
                    // The sidecar is written before the index so it is the durable source of
                    // truth when a process stops between those two writes.
                    index.pending_candidates.insert(id, sidecar);
                    changed = true;
                }
            }
            (Some(indexed), None) => {
                if !candidate_is_valid(&id, &indexed) {
                    return Err(CertificateError::StoreUnavailable);
                }
                let active = index
                    .certificates
                    .get(&id)
                    .ok_or(CertificateError::StoreUnavailable)?;
                if active.material_id == indexed.staged.material_id {
                    index.pending_candidates.remove(&id);
                    changed = true;
                    continue;
                }
                if indexed.base_material_id != active.material_id {
                    return Err(CertificateError::StoreUnavailable);
                }
                // Older candidate indexes did not have a sidecar. Recreate one before exposing
                // the candidate to the runtime so a later index write cannot lose the material.
                persist_candidate_manifest(certificates_dir, &id, &indexed)?;
            }
            (None, Some(sidecar)) => {
                if !candidate_is_valid(&id, &sidecar) {
                    return Err(CertificateError::StoreUnavailable);
                }
                let active = index
                    .certificates
                    .get(&id)
                    .ok_or(CertificateError::StoreUnavailable)?;
                if active.material_id == sidecar.staged.material_id {
                    // The index promotion completed but cleanup of the sidecar did not. The
                    // active pointer is authoritative, so this manifest is safe to remove.
                    remove_candidate_manifest(certificates_dir, &id)?;
                } else {
                    if sidecar.base_material_id != active.material_id {
                        return Err(CertificateError::StoreUnavailable);
                    }
                    index.pending_candidates.insert(id.clone(), sidecar);
                    let candidate = index
                        .pending_candidates
                        .get(&id)
                        .cloned()
                        .ok_or(CertificateError::StoreUnavailable)?;
                    ensure_issued_event(index, &id, &candidate)?;
                    changed = true;
                }
            }
            (None, None) => {}
        }
    }

    if index
        .pending_candidates
        .keys()
        .any(|id| !index.certificates.contains_key(id))
    {
        return Err(CertificateError::StoreUnavailable);
    }

    Ok(changed)
}

fn read_candidate_manifest(
    certificates_dir: &SafeDir,
    id: &str,
) -> Result<Option<StoredCertificateCandidate>, CertificateError> {
    let certificate_dir = match certificates_dir.open_dir(id) {
        Ok(directory) => directory,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(CertificateError::StoreUnavailable),
    };
    let Some(bytes) = read_regular_private_file(
        &certificate_dir,
        CANDIDATE_MANIFEST_FILE,
        MAX_CANDIDATE_MANIFEST_BYTES,
    )?
    else {
        return Ok(None);
    };
    let candidate =
        serde_json::from_slice(&bytes).map_err(|_| CertificateError::StoreUnavailable)?;
    Ok(Some(candidate))
}

fn persist_candidate_manifest(
    certificates_dir: &SafeDir,
    id: &str,
    candidate: &StoredCertificateCandidate,
) -> Result<(), CertificateError> {
    if !candidate_is_valid(id, candidate) {
        return Err(CertificateError::StoreUnavailable);
    }
    let certificate_dir = certificates_dir
        .open_dir(id)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let bytes = serde_json::to_vec(candidate).map_err(|_| CertificateError::StoreUnavailable)?;
    if bytes.len() > MAX_CANDIDATE_MANIFEST_BYTES {
        return Err(CertificateError::StoreUnavailable);
    }
    write_private_file(&certificate_dir, CANDIDATE_MANIFEST_FILE, &bytes)?;
    #[cfg(unix)]
    certificate_dir
        .sync()
        .map_err(|_| CertificateError::StoreUnavailable)?;
    Ok(())
}

fn remove_candidate_manifest(certificates_dir: &SafeDir, id: &str) -> Result<(), CertificateError> {
    let certificate_dir = match certificates_dir.open_dir(id) {
        Ok(directory) => directory,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(CertificateError::StoreUnavailable),
    };
    let path = match certificate_dir.file_path(CANDIDATE_MANIFEST_FILE) {
        Ok(path) => path,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(CertificateError::StoreUnavailable),
    };
    std::fs::remove_file(path).map_err(|_| CertificateError::StoreUnavailable)?;
    #[cfg(unix)]
    certificate_dir
        .sync()
        .map_err(|_| CertificateError::StoreUnavailable)?;
    Ok(())
}

fn candidate_is_valid(id: &str, candidate: &StoredCertificateCandidate) -> bool {
    let staged = &candidate.staged;
    candidate.version == CANDIDATE_MANIFEST_VERSION
        && is_canonical_uuid_v7(id)
        && staged.metadata.id == id
        && staged.metadata.source == CertificateSource::Acme
        && staged.metadata.environment.is_some()
        && staged.metadata.status == CertificateStatus::Valid
        && staged.metadata.operation == CertificateOperation::Idle
        && (1..=100).contains(&staged.metadata.domains.len())
        && staged
            .metadata
            .domains
            .iter()
            .all(|domain| is_certificate_domain(domain))
        && staged.material_id.as_ref().is_some_and(|material_id| {
            material_id.len() == 64 && material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        && staged
            .metadata
            .fingerprint
            .as_ref()
            .is_some_and(|fingerprint| valid_fingerprint(fingerprint))
        && staged
            .metadata
            .issued_at
            .as_ref()
            .is_some_and(|timestamp| valid_timestamp(timestamp))
        && staged
            .metadata
            .expires_at
            .as_ref()
            .is_some_and(|timestamp| valid_timestamp(timestamp))
        && valid_timestamp(&staged.metadata.updated_at)
        && staged
            .metadata
            .issuer
            .as_ref()
            .is_none_or(|issuer| issuer.len() <= 512)
        && staged
            .next_attempt_at
            .as_ref()
            .is_none_or(|timestamp| valid_timestamp(timestamp))
        && staged.retry_delay_seconds.is_none_or(|delay| {
            (MIN_ACME_RETRY_DELAY_SECONDS..=MAX_ACME_RETRY_DELAY_SECONDS).contains(&delay)
        })
        && candidate
            .base_material_id
            .as_ref()
            .is_none_or(|material_id| {
                material_id.len() == 64 && material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        && matches!(
            candidate.activation_operation,
            CertificateOperation::Issuing | CertificateOperation::Renewing
        )
        && candidate
            .activation
            .next_attempt_at
            .as_ref()
            .is_none_or(|timestamp| valid_timestamp(timestamp))
        && candidate
            .activation
            .last_attempt_at
            .as_ref()
            .is_none_or(|timestamp| valid_timestamp(timestamp))
        && candidate
            .activation
            .last_error_code
            .as_ref()
            .is_none_or(|error| error.len() <= 128)
        && candidate
            .activation
            .retry_delay_seconds
            .is_none_or(|delay| {
                (MIN_CANDIDATE_RETRY_DELAY_SECONDS..=MAX_CANDIDATE_RETRY_DELAY_SECONDS)
                    .contains(&delay)
            })
        && staged.acme.as_ref().is_some_and(|acme| {
            let provider_is_valid = match acme.challenge_type {
                AcmeChallengeType::Http01 => acme.dns_provider.is_none(),
                AcmeChallengeType::Dns01 => acme.dns_provider.as_ref().is_some_and(|config| {
                    config.version == 1
                        && config.nonce.len() == 12
                        && (16..=8 * 1024).contains(&config.ciphertext.len())
                }),
            };
            provider_is_valid
                && acme.pending_dns_records.len() <= 256
                && acme
                    .pending_dns_records
                    .iter()
                    .all(|intent| dns_intent_belongs_to(intent, id))
                && (acme.challenge_type == AcmeChallengeType::Dns01
                    || acme.pending_dns_records.is_empty())
        })
}

fn ensure_material_version(
    versions_dir: &SafeDir,
    id: &str,
    material_id: &str,
    fullchain: &[u8],
    private_key: &[u8],
) -> Result<(), CertificateError> {
    if !is_canonical_uuid_v7(id)
        || material_id.len() != 64
        || !material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(CertificateError::StoreUnavailable);
    }
    match versions_dir.open_dir(material_id) {
        Ok(version_dir) => return ensure_complete_material_version(&version_dir).map(|_| ()),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(CertificateError::StoreUnavailable),
    }

    let staging = format!(
        ".staging-{id}-{material_id}-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos(),
    );
    let staging_dir = versions_dir
        .ensure_dir(&staging)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let result = (|| {
        write_private_file(&staging_dir, "fullchain.pem", fullchain)?;
        write_private_file(&staging_dir, "private-key.pem", private_key)?;
        ensure_complete_material_version(&staging_dir)?;
        #[cfg(unix)]
        staging_dir
            .sync()
            .map_err(|_| CertificateError::StoreUnavailable)?;
        versions_dir
            .rename_dir(&staging, material_id)
            .map_err(|_| CertificateError::StoreUnavailable)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = versions_dir.remove_dir_tree(&staging);
    }
    result
}

fn ensure_complete_material_version(
    version_dir: &SafeDir,
) -> Result<(PathBuf, PathBuf), CertificateError> {
    let fullchain_path = version_dir
        .file_path("fullchain.pem")
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let private_key_path = version_dir
        .file_path("private-key.pem")
        .map_err(|_| CertificateError::StoreUnavailable)?;
    Ok((fullchain_path, private_key_path))
}

fn material_at(
    certificates_dir: &SafeDir,
    id: &str,
    material_id: &str,
) -> Result<CertificateMaterial, CertificateError> {
    if !is_canonical_uuid_v7(id)
        || material_id.len() != 64
        || !material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(CertificateError::StoreUnavailable);
    }
    let certificate_dir = certificates_dir
        .open_dir(id)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let versions_dir = certificate_dir
        .open_dir("versions")
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let version_dir = versions_dir
        .open_dir(material_id)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let (fullchain_path, private_key_path) = ensure_complete_material_version(&version_dir)?;
    Ok(CertificateMaterial {
        fullchain_path,
        private_key_path,
    })
}

fn validate_candidate_material(
    certificates_dir: &SafeDir,
    id: &str,
    staged: &StoredCertificate,
) -> Result<(), CertificateError> {
    let material_id = staged
        .material_id
        .as_deref()
        .ok_or(CertificateError::StoreUnavailable)?;
    let certificate_dir = certificates_dir
        .open_dir(id)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let versions_dir = certificate_dir
        .open_dir("versions")
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let version_dir = versions_dir
        .open_dir(material_id)
        .map_err(|_| CertificateError::StoreUnavailable)?;
    let fullchain =
        read_regular_private_file(&version_dir, "fullchain.pem", MAX_CERTIFICATE_PEM_BYTES)?
            .ok_or(CertificateError::StoreUnavailable)?;
    let private_key =
        read_regular_private_file(&version_dir, "private-key.pem", MAX_PRIVATE_KEY_PEM_BYTES)?
            .ok_or(CertificateError::StoreUnavailable)?;
    let fullchain =
        String::from_utf8(fullchain).map_err(|_| CertificateError::InvalidCertificate)?;
    let private_key =
        String::from_utf8(private_key).map_err(|_| CertificateError::InvalidCertificate)?;
    let parsed = ParsedCertificate::parse(&CertificateImportRequest {
        certificate_pem: fullchain,
        private_key_pem: private_key,
        chain_pem: None,
        required_domains: None,
    })?;
    if parsed.domains != staged.metadata.domains
        || staged.metadata.fingerprint.as_deref() != Some(parsed.fingerprint.as_str())
        || staged.metadata.issued_at.as_deref() != Some(parsed.issued_at.as_str())
        || staged.metadata.expires_at.as_deref() != Some(parsed.expires_at.as_str())
        || staged.metadata.issuer.as_deref() != Some(parsed.issuer.as_str())
    {
        return Err(CertificateError::StoreUnavailable);
    }
    Ok(())
}

fn public_metadata(stored: &StoredCertificate) -> CertificateMetadata {
    public_metadata_with_candidate(stored, None)
}

fn public_metadata_with_candidate(
    stored: &StoredCertificate,
    candidate: Option<&StoredCertificateCandidate>,
) -> CertificateMetadata {
    CertificateMetadata {
        id: stored.metadata.id.clone(),
        source: stored.metadata.source,
        environment: stored.metadata.environment,
        domains: stored.metadata.domains.clone(),
        status: stored.metadata.status,
        operation: stored.metadata.operation,
        issued_at: stored.metadata.issued_at.clone(),
        expires_at: stored.metadata.expires_at.clone(),
        issuer: stored.metadata.issuer.clone(),
        fingerprint: stored.metadata.fingerprint.clone(),
        last_error_code: stored.metadata.last_error_code.clone(),
        updated_at: stored.metadata.updated_at.clone(),
        next_attempt_at: stored.next_attempt_at.clone(),
        attempt_count: stored.metadata.attempt_count,
        last_attempt_at: stored.metadata.last_attempt_at.clone(),
        last_success_at: stored.metadata.last_success_at.clone(),
        next_renewal_at: next_renewal_at(stored),
        candidate: candidate.and_then(candidate_metadata),
        dns_cleanup_pending: stored
            .acme
            .as_ref()
            .is_some_and(|acme| !acme.pending_dns_records.is_empty()),
        current_operation: stored.metadata.current_operation.clone(),
        challenge_type: stored
            .metadata
            .challenge_type
            .or_else(|| stored.acme.as_ref().map(|acme| acme.challenge_type)),
        last_activated_at: stored.metadata.last_activated_at.clone(),
        last_error_at: stored.metadata.last_error_at.clone(),
    }
}

fn candidate_metadata(candidate: &StoredCertificateCandidate) -> Option<CertificateCandidate> {
    Some(CertificateCandidate {
        fingerprint: candidate.staged.metadata.fingerprint.clone()?,
        issued_at: candidate.staged.metadata.issued_at.clone()?,
        expires_at: candidate.staged.metadata.expires_at.clone()?,
        last_error_code: candidate.activation.last_error_code.clone(),
        next_attempt_at: candidate.activation.next_attempt_at.clone(),
    })
}

struct ParsedCertificate {
    fullchain: String,
    domains: Vec<String>,
    issued_at: String,
    expires_at: String,
    issuer: String,
    fingerprint: String,
}

impl ParsedCertificate {
    fn parse(request: &CertificateImportRequest) -> Result<Self, CertificateError> {
        if !has_only_pem_blocks(&request.certificate_pem, &["CERTIFICATE"], false)
            || !request
                .chain_pem
                .as_deref()
                .is_none_or(|chain| has_only_pem_blocks(chain, &["CERTIFICATE"], false))
            || !has_only_pem_blocks(
                &request.private_key_pem,
                &["PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY"],
                true,
            )
        {
            return Err(CertificateError::InvalidCertificate);
        }

        let mut certificates: Vec<CertificateDer<'static>> =
            CertificateDer::pem_slice_iter(request.certificate_pem.as_bytes())
                .collect::<Result<_, _>>()
                .map_err(|_| CertificateError::InvalidCertificate)?;
        if certificates.is_empty() || certificates.len() > 100 {
            return Err(CertificateError::InvalidCertificate);
        }
        if let Some(chain) = &request.chain_pem {
            certificates.extend(
                CertificateDer::pem_slice_iter(chain.as_bytes())
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|_| CertificateError::InvalidCertificate)?,
            );
        }
        let key = PrivateKeyDer::from_pem_slice(request.private_key_pem.as_bytes())
            .map_err(|_| CertificateError::InvalidCertificate)?;
        ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certificates.clone(), key)
            .map_err(|_| CertificateError::KeyMismatch)?;
        let leaf = certificates
            .first()
            .ok_or(CertificateError::InvalidCertificate)?;
        let (_, certificate) = parse_x509_certificate(leaf.as_ref())
            .map_err(|_| CertificateError::InvalidCertificate)?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let not_before = certificate.validity().not_before.timestamp();
        let not_after = certificate.validity().not_after.timestamp();
        if not_before > now || not_after <= now {
            return Err(CertificateError::CertificateExpired);
        }
        let subject_alternative_names = certificate
            .subject_alternative_name()
            .map_err(|_| CertificateError::InvalidCertificate)?;
        let mut domains = subject_alternative_names
            .as_ref()
            .map(|extension| {
                extension
                    .value
                    .general_names
                    .iter()
                    .filter_map(|name| match name {
                        GeneralName::DNSName(value) => Some(value.to_ascii_lowercase()),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_else(Vec::new);
        if subject_alternative_names.is_none() {
            for value in certificate
                .subject()
                .iter_common_name()
                .filter_map(|name| name.as_str().ok())
            {
                domains.push(value.to_ascii_lowercase());
            }
        }
        domains.sort_unstable();
        domains.dedup();
        if domains.is_empty()
            || domains.len() > 100
            || domains.iter().any(|domain| !is_certificate_domain(domain))
        {
            return Err(CertificateError::InvalidCertificate);
        }
        let mut fullchain = request.certificate_pem.clone();
        if let Some(chain) = request.chain_pem.as_deref() {
            if !fullchain.ends_with('\n') {
                fullchain.push('\n');
            }
            fullchain.push_str(chain);
        }
        Ok(Self {
            fullchain,
            domains,
            issued_at: format_timestamp(not_before)?,
            expires_at: format_timestamp(not_after)?,
            issuer: truncate(certificate.issuer().to_string(), 512),
            fingerprint: {
                let digest = Sha256::digest(leaf.as_ref());
                let digest: &[u8] = digest.as_ref();
                format!(
                    "sha256:{}",
                    digest
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect::<String>()
                )
            },
        })
    }
}

fn material_id(request: &CertificateImportRequest) -> String {
    let mut hash = Sha256::new();
    hash.update(request.certificate_pem.as_bytes());
    hash.update([0]);
    hash.update(request.chain_pem.as_deref().unwrap_or("").as_bytes());
    hash.update([0]);
    hash.update(request.private_key_pem.as_bytes());
    {
        let digest = hash.finalize();
        let digest: &[u8] = digest.as_ref();
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    }
}

fn environment_name(environment: CertificateEnvironment) -> &'static str {
    match environment {
        CertificateEnvironment::Staging => "staging",
        CertificateEnvironment::Production => "production",
    }
}

fn canonical_domains(domains: &[String]) -> Vec<String> {
    let mut result = domains.to_vec();
    result.sort_unstable();
    result.dedup();
    result
}

fn has_duplicate_domains(domains: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    domains.iter().any(|domain| !seen.insert(domain.as_str()))
}

fn dns_intent_belongs_to(intent: &DnsRecordIntent, certificate_id: &str) -> bool {
    intent.validate().is_ok() && intent.marker == format!("rentnerproxy-acme:{certificate_id}")
}

fn certificate_covers(names: &[String], domain: &str) -> bool {
    let domain = domain.to_ascii_lowercase();
    names
        .iter()
        .any(|name| name == &domain || wildcard_covers(name, &domain))
}

fn wildcard_covers(pattern: &str, domain: &str) -> bool {
    let Some(suffix) = pattern.strip_prefix("*.") else {
        return false;
    };
    domain.strip_suffix(suffix).is_some_and(|prefix| {
        prefix.ends_with('.') && prefix.len() > 1 && !prefix[..prefix.len() - 1].contains('.')
    })
}

fn is_certificate_domain(value: &str) -> bool {
    if is_canonical_domain(value) {
        return value.contains('.');
    }
    value.strip_prefix("*.").is_some_and(|suffix| {
        value.len() <= 253
            && suffix.contains('.')
            && suffix.parse::<std::net::Ipv4Addr>().is_err()
            && is_canonical_domain(suffix)
    })
}

fn is_acme_request_domain(
    value: &str,
    challenge_type: AcmeChallengeType,
    environment: CertificateEnvironment,
) -> bool {
    let (name, wildcard) = match value.strip_prefix("*.") {
        Some(suffix) => (suffix, true),
        None => (value, false),
    };
    if challenge_type == AcmeChallengeType::Dns01 && "_acme-challenge.".len() + name.len() > 253 {
        return false;
    }
    if wildcard
        && (challenge_type != AcmeChallengeType::Dns01 || value.len() > 253 || name.contains('*'))
    {
        return false;
    }
    is_public_acme_domain(
        name,
        challenge_type == AcmeChallengeType::Http01
            && environment == CertificateEnvironment::Staging
            && test_acme_directory_configured(),
    )
}

fn is_public_acme_domain(value: &str, allow_invalid: bool) -> bool {
    if !is_canonical_domain(value) || !value.contains('.') {
        return false;
    }
    match value.rsplit('.').next() {
        Some("invalid") => allow_invalid,
        Some(
            "test" | "localhost" | "example" | "local" | "internal" | "onion" | "home" | "lan",
        ) => false,
        Some(_) => true,
        None => false,
    }
}

fn test_acme_directory_configured() -> bool {
    std::env::var_os("RENTNERPROXY_ACME_TEST_DIRECTORY_URL").is_some()
        && std::env::var_os("RENTNERPROXY_ACME_TEST_ROOT_CERT").is_some()
}

fn is_valid_email(value: &str) -> bool {
    value.len() <= 320
        && value == value.trim()
        && value
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && is_canonical_domain(domain))
}

fn format_timestamp(timestamp: i64) -> Result<String, CertificateError> {
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|_| CertificateError::InvalidCertificate)?
        .format(&Rfc3339)
        .map_err(|_| CertificateError::InvalidCertificate)
}

fn utc_now() -> Result<String, CertificateError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| CertificateError::StoreUnavailable)
}
fn truncate(mut value: String, maximum: usize) -> String {
    if value.len() <= maximum {
        return value;
    }
    let mut end = maximum;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    value
}

fn has_only_pem_blocks(value: &str, labels: &[&str], exactly_one: bool) -> bool {
    let mut remainder = value.trim();
    let mut count = 0;
    while !remainder.is_empty() {
        let Some(label) = labels
            .iter()
            .find(|label| remainder.starts_with(&format!("-----BEGIN {label}-----")))
        else {
            return false;
        };
        let begin = format!("-----BEGIN {label}-----");
        let end = format!("-----END {label}-----");
        let after_begin = &remainder[begin.len()..];
        let Some(end_index) = after_begin.find(&end) else {
            return false;
        };
        let body = &after_begin[..end_index];
        if body.is_empty()
            || !body.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'+' | b'/' | b'=' | b'\r' | b'\n' | b' ' | b'\t')
            })
        {
            return false;
        }
        count += 1;
        remainder = after_begin[end_index + end.len()..].trim();
    }
    count > 0 && (!exactly_one || count == 1)
}

fn write_private_file(
    directory: &SafeDir,
    component: &str,
    bytes: &[u8],
) -> Result<(), CertificateError> {
    #[cfg(test)]
    if crate::tests::fixtures::should_fail_private_key_write(
        &directory
            .child_path(component)
            .map_err(|_| CertificateError::StoreUnavailable)?,
    ) {
        return Err(CertificateError::StoreUnavailable);
    }
    directory
        .atomic_write(component, bytes)
        .map_err(|_| CertificateError::StoreUnavailable)
}

fn read_regular_private_file(
    directory: &SafeDir,
    component: &str,
    maximum_bytes: usize,
) -> Result<Option<Vec<u8>>, CertificateError> {
    match directory.read_file(component, maximum_bytes) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(CertificateError::StoreUnavailable),
    }
}
fn index_is_valid(index: &CertificateIndex) -> bool {
    operations::journal_is_valid(index)
        && index.certificates.len() <= MAX_CERTIFICATES
        && index.pending_candidates.len() <= MAX_CERTIFICATES
        && index.pending_candidates.iter().all(|(id, candidate)| {
            index.certificates.contains_key(id) && candidate_is_valid(id, candidate)
        })
        && index
            .acme_retry_until
            .values()
            .all(|timestamp| valid_timestamp(timestamp))
        && index.certificates.iter().all(|(id, entry)| {
            is_canonical_uuid_v7(id)
                && entry.metadata.id == *id
                && (entry.metadata.source != CertificateSource::Acme || entry.acme.is_some())
                && (1..=100).contains(&entry.metadata.domains.len())
                && entry
                    .metadata
                    .domains
                    .iter()
                    .all(|domain| is_certificate_domain(domain))
                && entry
                    .metadata
                    .issuer
                    .as_ref()
                    .is_none_or(|issuer| issuer.len() <= 512)
                && entry
                    .metadata
                    .fingerprint
                    .as_ref()
                    .is_none_or(|fingerprint| {
                        fingerprint.len() == 71
                            && fingerprint.starts_with("sha256:")
                            && fingerprint[7..]
                                .bytes()
                                .all(|byte| byte.is_ascii_hexdigit())
                    })
                && entry
                    .metadata
                    .issued_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .expires_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && valid_timestamp(&entry.metadata.updated_at)
                && entry
                    .metadata
                    .current_operation
                    .as_ref()
                    .is_none_or(operations::current_operation_is_valid)
                && entry
                    .metadata
                    .last_activated_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_error_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry.material_id.as_ref().is_none_or(|material_id| {
                    material_id.len() == 64
                        && material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                && entry
                    .next_attempt_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_attempt_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .metadata
                    .last_success_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .retry_delay_seconds
                    .is_none_or(|delay| (1_800..=21_600).contains(&delay))
                && entry.acme.as_ref().is_none_or(|acme| {
                    let provider_is_valid = match acme.challenge_type {
                        AcmeChallengeType::Http01 => acme.dns_provider.is_none(),
                        AcmeChallengeType::Dns01 => {
                            acme.dns_provider.as_ref().is_some_and(|config| {
                                config.version == 1
                                    && config.nonce.len() == 12
                                    && (16..=8 * 1024).contains(&config.ciphertext.len())
                            })
                        }
                    };
                    provider_is_valid
                        && acme.pending_dns_records.len() <= 256
                        && acme
                            .pending_dns_records
                            .iter()
                            .all(|intent| dns_intent_belongs_to(intent, id))
                        && (acme.challenge_type == AcmeChallengeType::Dns01
                            || acme.pending_dns_records.is_empty())
                })
        })
}

fn retry_deadline(delay_seconds: u32) -> Option<OffsetDateTime> {
    OffsetDateTime::now_utc().checked_add(time::Duration::seconds(i64::from(delay_seconds)))
}

fn max_retry_deadline(existing: Option<&str>, candidate: OffsetDateTime) -> Option<String> {
    let candidate = candidate.format(&Rfc3339).ok()?;
    max_retry_deadline_string(existing, &candidate).or(Some(candidate))
}

fn max_retry_deadline_string(existing: Option<&str>, candidate: &str) -> Option<String> {
    match existing {
        Some(existing)
            if OffsetDateTime::parse(existing, &Rfc3339)
                .ok()
                .zip(OffsetDateTime::parse(candidate, &Rfc3339).ok())
                .is_some_and(|(existing, candidate)| existing >= candidate) =>
        {
            Some(existing.to_owned())
        }
        _ => Some(candidate.to_owned()),
    }
}

fn retry_is_blocking(entry: &StoredCertificate, now: OffsetDateTime) -> bool {
    entry
        .next_attempt_at
        .as_deref()
        .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
        .is_some_and(|deadline| deadline > now)
}

fn account_retry_is_blocking(
    index: &CertificateIndex,
    environment: CertificateEnvironment,
    now: OffsetDateTime,
) -> bool {
    index
        .acme_retry_until
        .get(&environment)
        .and_then(|deadline| OffsetDateTime::parse(deadline, &Rfc3339).ok())
        .is_some_and(|deadline| deadline > now)
}

fn next_retry_delay(id: &str, attempt_count: u32, previous: Option<u32>) -> u32 {
    let exponent = attempt_count.saturating_sub(1).min(4);
    let base = u64::from(MIN_ACME_RETRY_DELAY_SECONDS)
        .saturating_mul(1_u64 << exponent)
        .min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS));
    let previous = previous
        .unwrap_or(base as u32)
        .clamp(MIN_ACME_RETRY_DELAY_SECONDS, MAX_ACME_RETRY_DELAY_SECONDS);
    let base = base.max(u64::from(previous));
    let jitter_max = (base / 4).min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS).saturating_sub(base));
    let entropy = OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .unsigned_abs() as u64
        ^ id.bytes().fold(0_u64, |hash, byte| {
            hash.wrapping_mul(16777619).wrapping_add(u64::from(byte))
        });
    base.saturating_add(if jitter_max == 0 {
        0
    } else {
        entropy % (jitter_max + 1)
    })
    .min(u64::from(MAX_ACME_RETRY_DELAY_SECONDS)) as u32
}

fn next_candidate_retry_delay(id: &str, attempt_count: u32, previous: Option<u32>) -> u32 {
    let exponent = attempt_count.saturating_sub(1).min(3);
    let base = u64::from(MIN_CANDIDATE_RETRY_DELAY_SECONDS)
        .saturating_mul(1_u64 << exponent)
        .min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS));
    let previous = previous.unwrap_or(base as u32).clamp(
        MIN_CANDIDATE_RETRY_DELAY_SECONDS,
        MAX_CANDIDATE_RETRY_DELAY_SECONDS,
    );
    let base = base.max(u64::from(previous));
    let jitter_max =
        (base / 4).min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS).saturating_sub(base));
    let entropy = OffsetDateTime::now_utc()
        .unix_timestamp_nanos()
        .unsigned_abs() as u64
        ^ id.bytes().fold(0_u64, |hash, byte| {
            hash.wrapping_mul(16777619).wrapping_add(u64::from(byte))
        });
    base.saturating_add(if jitter_max == 0 {
        0
    } else {
        entropy % (jitter_max + 1)
    })
    .min(u64::from(MAX_CANDIDATE_RETRY_DELAY_SECONDS)) as u32
}

fn candidate_retry_deadline(delay_seconds: u32) -> Option<String> {
    OffsetDateTime::now_utc()
        .checked_add(time::Duration::seconds(i64::from(delay_seconds)))
        .and_then(|deadline| deadline.format(&Rfc3339).ok())
}

fn next_renewal_at(stored: &StoredCertificate) -> Option<String> {
    if stored.metadata.source != CertificateSource::Acme {
        return None;
    }
    let issued = stored
        .metadata
        .issued_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())?;
    let expires = stored
        .metadata
        .expires_at
        .as_deref()
        .and_then(|value| OffsetDateTime::parse(value, &Rfc3339).ok())?;
    let due = renewal_timestamp(issued, expires)?;
    due.format(&Rfc3339).ok()
}

pub(crate) fn renewal_timestamp(
    issued: OffsetDateTime,
    expires: OffsetDateTime,
) -> Option<OffsetDateTime> {
    let lifetime = expires - issued;
    if lifetime <= time::Duration::ZERO {
        return None;
    }
    let elapsed =
        time::Duration::nanoseconds_i128(lifetime.whole_nanoseconds().saturating_mul(2) / 3);
    issued.checked_add(elapsed)
}

fn valid_timestamp(value: &str) -> bool {
    value.len() <= 40 && OffsetDateTime::parse(value, &Rfc3339).is_ok()
}

fn valid_fingerprint(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn persist_index(directory: &SafeDir, index: &CertificateIndex) -> Result<(), CertificateError> {
    if !index_is_valid(index) {
        return Err(CertificateError::StoreUnavailable);
    }
    let bytes = serde_json::to_vec(index).map_err(|_| CertificateError::StoreUnavailable)?;
    let recovery_headroom = index
        .certificates
        .values()
        .filter(|entry| entry.metadata.operation != CertificateOperation::Idle)
        .count()
        * INTERRUPTED_OPERATION_HEADROOM_BYTES;
    if bytes.len().saturating_add(recovery_headroom) > MAX_CERTIFICATE_INDEX_BYTES {
        return Err(CertificateError::StoreUnavailable);
    }
    write_private_file(directory, CERTIFICATE_INDEX_FILE, &bytes)
}
