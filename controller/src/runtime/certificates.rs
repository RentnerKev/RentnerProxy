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

pub(crate) const MAX_CERTIFICATE_PEM_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PRIVATE_KEY_PEM_BYTES: usize = 64 * 1024;
const CERTIFICATE_INDEX_FILE: &str = "certificate-metadata.json";
const CERTIFICATES_DIRECTORY: &str = "certificates";
const MAX_CERTIFICATE_INDEX_BYTES: usize = 8 * 1024 * 1024;
const MAX_CERTIFICATES: usize = 10_000;
// Leave room for error codes, retry timestamps, attempt metadata and delays
// after interrupted ACME jobs.
const INTERRUPTED_OPERATION_HEADROOM_BYTES: usize = 384;
const MIN_ACME_RETRY_DELAY_SECONDS: u32 = 1_800;
const MAX_ACME_RETRY_DELAY_SECONDS: u32 = 21_600;
const MAX_ACME_ATTEMPT_COUNT: u32 = 32;

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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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
}

impl CertificateStore {
    pub(crate) fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            index: tokio::sync::Mutex::new(CertificateIndex::default()),
            leases: tokio::sync::Mutex::new(BTreeSet::new()),
        }
    }

    pub(crate) async fn initialize(&self) -> Result<(), CertificateError> {
        let certificates_dir = self.ensure_certificates_dir()?;
        let mut index = match read_regular_private_file(
            &certificates_dir,
            CERTIFICATE_INDEX_FILE,
            MAX_CERTIFICATE_INDEX_BYTES,
        )? {
            Some(bytes) => {
                serde_json::from_slice(&bytes).map_err(|_| CertificateError::StoreUnavailable)?
            }
            None => CertificateIndex::default(),
        };
        if !index_is_valid(&index) {
            return Err(CertificateError::StoreUnavailable);
        }
        let mut recovered_interrupted_operation = false;
        let recovery_now = utc_now()?;
        let recovery_deadline = OffsetDateTime::now_utc().checked_add(time::Duration::seconds(
            i64::from(MIN_ACME_RETRY_DELAY_SECONDS),
        ));
        for entry in index.certificates.values_mut() {
            if entry.metadata.operation != CertificateOperation::Idle {
                entry.metadata.operation = CertificateOperation::Idle;
                entry.metadata.status = if entry.material_id.is_some() {
                    CertificateStatus::Valid
                } else {
                    CertificateStatus::Failed
                };
                entry.metadata.last_error_code =
                    Some(CertificateError::AcmeFailed.code().to_owned());
                entry.metadata.attempt_count = entry.metadata.attempt_count.max(1);
                if entry.metadata.last_attempt_at.is_none() {
                    entry.metadata.last_attempt_at = Some(recovery_now.clone());
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
                recovered_interrupted_operation = true;
            }
        }
        if recovered_interrupted_operation {
            persist_index(&certificates_dir, &index)?;
        }
        *self.index.lock().await = index;
        Ok(())
    }

    pub(crate) async fn renewal_is_allowed(&self, id: &str) -> bool {
        let index = self.index.lock().await;
        let now = OffsetDateTime::now_utc();
        index.certificates.get(id).is_some_and(|entry| {
            !retry_is_blocking(entry, now)
                && entry
                    .metadata
                    .environment
                    .is_none_or(|environment| !account_retry_is_blocking(&index, environment, now))
        })
    }
    pub(crate) async fn list(&self) -> Result<Vec<CertificateMetadata>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index.certificates.values().map(public_metadata).collect())
    }

    pub(crate) async fn get(&self, id: &str) -> Result<CertificateMetadata, CertificateError> {
        let index = self.index.lock().await;
        index
            .certificates
            .get(id)
            .map(public_metadata)
            .ok_or(CertificateError::NotFound)
    }

    pub(crate) async fn stage_manual(
        &self,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<StagedCertificate, CertificateError> {
        self.acquire_lease(id).await?;
        let has_pending_dns = {
            let index = self.index.lock().await;
            index
                .certificates
                .get(id)
                .and_then(|entry| entry.acme.as_ref())
                .is_some_and(|acme| !acme.pending_dns_records.is_empty())
        };
        if has_pending_dns {
            self.release_lease(id).await;
            return Err(CertificateError::DnsCleanupFailed);
        }
        match self.stage_import_with_lease(id, &request, CertificateSource::Manual, None, None) {
            Ok(staged) => Ok(staged),
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
        let acme = match self.stored_acme_configuration(id, request) {
            Ok(acme) => acme,
            Err(error) => {
                self.release_lease(id).await;
                return Err(error);
            }
        };
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
        if result.is_err() {
            self.release_lease(id).await;
        }
        result
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
                },
                material_id: Some(material_id),
                acme,
                next_attempt_at: None,
                retry_delay_seconds: None,
            },
        })
    }

    pub(crate) async fn commit_staged(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let mut index = self.index.lock().await;
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
        let previous = index
            .certificates
            .insert(staged.id.clone(), committed.clone());
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
            drop(index);
            self.release_lease(&staged.id).await;
            return Err(error);
        }
        let metadata = public_metadata(&committed);
        drop(index);
        self.release_lease(&staged.id).await;
        Ok(metadata)
    }

    pub(crate) async fn discard_staged(&self, staged: &StagedCertificate) {
        self.release_lease(&staged.id).await;
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
        let stored = if let Some(current) = index.certificates.get(id) {
            let mut preserved = current.clone();
            let attempt_count = preserved
                .metadata
                .attempt_count
                .saturating_add(1)
                .min(MAX_ACME_ATTEMPT_COUNT);
            preserved.metadata.operation = if renewal {
                CertificateOperation::Renewing
            } else {
                CertificateOperation::Issuing
            };
            preserved.metadata.last_error_code = None;
            preserved.metadata.updated_at = now.clone();
            preserved.metadata.attempt_count = attempt_count;
            preserved.metadata.last_attempt_at = Some(now.clone());
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
                },
                material_id: None,
                acme: Some(acme.expect("new ACME requests always have configuration")),
                next_attempt_at: None,
                retry_delay_seconds: None,
            }
        };
        let previous = index.certificates.insert(id.to_owned(), stored.clone());
        let persistence = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index));
        if let Err(error) = persistence {
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
        let previous = current.clone();
        let mut attempted = previous.clone();
        attempted.metadata.operation = CertificateOperation::Renewing;
        attempted.metadata.last_error_code = None;
        attempted.next_attempt_at = None;
        attempted.metadata.attempt_count = attempted
            .metadata
            .attempt_count
            .saturating_add(1)
            .min(MAX_ACME_ATTEMPT_COUNT);
        attempted.metadata.last_attempt_at = Some(now.clone());
        attempted.metadata.updated_at = now;
        index.certificates.insert(id.to_owned(), attempted.clone());
        if let Err(error) = self
            .certificates_dir()
            .and_then(|directory| persist_index(&directory, &index))
        {
            index.certificates.insert(id.to_owned(), previous);
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
        let mut index = self.index.lock().await;
        if let Some(entry) = index.certificates.get_mut(id) {
            let had_acme_operation = entry.metadata.operation != CertificateOperation::Idle;
            entry.metadata.operation = CertificateOperation::Idle;
            entry.metadata.status = if entry.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            entry.metadata.last_error_code = Some(error.code().to_owned());
            if entry.metadata.source == CertificateSource::Acme || had_acme_operation {
                entry.metadata.attempt_count = entry
                    .metadata
                    .attempt_count
                    .clamp(1, MAX_ACME_ATTEMPT_COUNT);
                let delay =
                    next_retry_delay(id, entry.metadata.attempt_count, entry.retry_delay_seconds);
                entry.retry_delay_seconds = Some(delay);
                if let Some(deadline) = retry_deadline(delay) {
                    entry.next_attempt_at =
                        max_retry_deadline(entry.next_attempt_at.as_deref(), deadline);
                }
            }
            if let Ok(now) = utc_now() {
                if entry.metadata.last_attempt_at.is_none()
                    && entry.metadata.source == CertificateSource::Acme
                {
                    entry.metadata.last_attempt_at = Some(now.clone());
                }
                entry.metadata.updated_at = now;
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
fn public_metadata(stored: &StoredCertificate) -> CertificateMetadata {
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
    }
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
    index.certificates.len() <= MAX_CERTIFICATES
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
                && entry.material_id.as_ref().is_none_or(|material_id| {
                    material_id.len() == 64
                        && material_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                && entry
                    .next_attempt_at
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry.metadata.attempt_count <= MAX_ACME_ATTEMPT_COUNT
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
