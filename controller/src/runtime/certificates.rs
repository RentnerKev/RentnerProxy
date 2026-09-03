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

use super::state::{SafeDir, state_dir};

pub(crate) const MAX_CERTIFICATE_PEM_BYTES: usize = 256 * 1024;
pub(crate) const MAX_PRIVATE_KEY_PEM_BYTES: usize = 64 * 1024;
const CERTIFICATE_INDEX_FILE: &str = "certificate-metadata.json";
const CERTIFICATES_DIRECTORY: &str = "certificates";
const MAX_CERTIFICATE_INDEX_BYTES: usize = 8 * 1024 * 1024;

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
    pub(crate) accept_terms: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CertificateSource {
    Manual,
    Acme,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredCertificate {
    #[serde(flatten)]
    metadata: StoredMetadata,
    material_id: Option<String>,
    #[serde(default)]
    acme: Option<StoredAcmeConfiguration>,
    #[serde(default)]
    retry_after: Option<String>,
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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredAcmeConfiguration {
    contact_email: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CertificateIndex {
    certificates: BTreeMap<String, StoredCertificate>,
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
                entry.retry_after = retry_after(1_800);
                entry.retry_delay_seconds = Some(1_800);
                entry.metadata.updated_at = utc_now()?;
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
        index
            .certificates
            .get(id)
            .and_then(|entry| entry.retry_after.as_deref())
            .is_none_or(|retry_after| {
                OffsetDateTime::parse(retry_after, &Rfc3339)
                    .is_ok_and(|retry_after| retry_after <= OffsetDateTime::now_utc())
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
        self.stage_import_with_lease(
            id,
            &CertificateImportRequest {
                certificate_pem,
                private_key_pem,
                chain_pem: None,
                required_domains: Some(request.domains.clone()),
            },
            CertificateSource::Acme,
            Some(request.environment),
            Some(StoredAcmeConfiguration {
                contact_email: request.contact_email.clone(),
            }),
        )
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
                },
                material_id: Some(material_id),
                acme,
                retry_after: None,
                retry_delay_seconds: None,
            },
        })
    }

    pub(crate) async fn commit_staged(
        &self,
        staged: &StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let mut index = self.index.lock().await;
        let previous = index
            .certificates
            .insert(staged.id.clone(), staged.stored.clone());
        if let Err(error) = persist_index(&self.certificates_dir()?, &index) {
            match previous {
                Some(previous) => {
                    index.certificates.insert(staged.id.clone(), previous);
                }
                None => {
                    index.certificates.remove(&staged.id);
                }
            }
            return Err(error);
        }
        let metadata = public_metadata(&staged.stored);
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
            || request.domains.iter().any(|domain| !is_acme_domain(domain))
            || (!renewal && !request.accept_terms)
            || request
                .contact_email
                .as_deref()
                .is_some_and(|email| !is_valid_email(email))
        {
            return Err(if !request.accept_terms && !renewal {
                CertificateError::TermsRequired
            } else {
                CertificateError::AcmeDomainInvalid
            });
        }
        let now = utc_now()?;
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
        let stored = if let Some(current) = index.certificates.get(id) {
            let mut preserved = current.clone();
            preserved.metadata.operation = if renewal {
                CertificateOperation::Renewing
            } else {
                CertificateOperation::Issuing
            };
            preserved.metadata.last_error_code = None;
            preserved.metadata.updated_at = now;
            preserved.retry_after = None;
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
                    updated_at: now,
                },
                material_id: None,
                acme: Some(StoredAcmeConfiguration {
                    contact_email: request.contact_email,
                }),
                retry_after: None,
                retry_delay_seconds: None,
            }
        };
        let previous = index.certificates.insert(id.to_owned(), stored.clone());
        if let Err(error) = persist_index(&self.certificates_dir()?, &index) {
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
        let mut index = self.index.lock().await;
        let Some(entry) = index.certificates.get_mut(id) else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::NotFound);
        };
        if entry.metadata.source != CertificateSource::Acme {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::InvalidCertificate);
        }
        if entry.metadata.operation != CertificateOperation::Idle {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        }
        let Some(environment) = entry.metadata.environment else {
            drop(index);
            self.release_lease(id).await;
            return Err(CertificateError::AcmeFailed);
        };
        let previous = entry.clone();
        entry.metadata.operation = CertificateOperation::Renewing;
        entry.metadata.last_error_code = None;
        entry.retry_after = None;
        entry.metadata.updated_at = now;
        let metadata = public_metadata(entry);
        let request = CertificateIssueRequest {
            domains: entry.metadata.domains.clone(),
            environment,
            contact_email: entry
                .acme
                .as_ref()
                .and_then(|acme| acme.contact_email.clone()),
            accept_terms: true,
        };
        if let Err(error) = persist_index(&self.certificates_dir()?, &index) {
            index.certificates.insert(id.to_owned(), previous);
            drop(index);
            self.release_lease(id).await;
            return Err(error);
        }
        Ok((metadata, request))
    }
    pub(crate) async fn finish_failed(&self, id: &str, error: CertificateError) {
        let mut index = self.index.lock().await;
        if let Some(entry) = index.certificates.get_mut(id) {
            entry.metadata.operation = CertificateOperation::Idle;
            entry.metadata.status = if entry.material_id.is_some() {
                CertificateStatus::Valid
            } else {
                CertificateStatus::Failed
            };
            entry.metadata.last_error_code = Some(error.code().to_owned());
            if entry.metadata.source == CertificateSource::Acme {
                let delay = entry
                    .retry_delay_seconds
                    .unwrap_or(900)
                    .saturating_mul(2)
                    .clamp(1_800, 21_600);
                entry.retry_delay_seconds = Some(delay);
                entry.retry_after = retry_after(delay);
            }
            if let Ok(now) = utc_now() {
                entry.metadata.updated_at = now;
            }
            let _ = self
                .certificates_dir()
                .and_then(|directory| persist_index(&directory, &index));
        }
        drop(index);
        self.release_lease(id).await;
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
    ) -> Result<bool, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        Ok(entry.metadata.status == CertificateStatus::Valid
            && entry
                .metadata
                .expires_at
                .as_deref()
                .is_some_and(|expires_at| {
                    OffsetDateTime::parse(expires_at, &Rfc3339)
                        .is_ok_and(|expires_at| expires_at > OffsetDateTime::now_utc())
                })
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
        suffix.contains('.')
            && suffix.parse::<std::net::Ipv4Addr>().is_err()
            && is_canonical_domain(suffix)
    })
}

fn is_acme_domain(value: &str) -> bool {
    is_canonical_domain(value) && value.contains('.') && !value.ends_with(".test")
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
    index.certificates.len() <= 10_000
        && index.certificates.iter().all(|(id, entry)| {
            is_canonical_uuid_v7(id)
                && entry.metadata.id == *id
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
                    .retry_after
                    .as_ref()
                    .is_none_or(|timestamp| valid_timestamp(timestamp))
                && entry
                    .retry_delay_seconds
                    .is_none_or(|delay| (1_800..=21_600).contains(&delay))
        })
}

fn retry_after(delay_seconds: u32) -> Option<String> {
    OffsetDateTime::now_utc()
        .checked_add(time::Duration::seconds(i64::from(delay_seconds)))
        .and_then(|timestamp| timestamp.format(&Rfc3339).ok())
}

fn valid_timestamp(value: &str) -> bool {
    value.len() <= 40 && OffsetDateTime::parse(value, &Rfc3339).is_ok()
}
fn persist_index(directory: &SafeDir, index: &CertificateIndex) -> Result<(), CertificateError> {
    let bytes = serde_json::to_vec(index).map_err(|_| CertificateError::StoreUnavailable)?;
    write_private_file(directory, CERTIFICATE_INDEX_FILE, &bytes)
}
