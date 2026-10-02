use super::scheduling::next_renewal_at;
use super::validation::{
    format_timestamp, has_only_pem_blocks, is_certificate_domain, read_regular_private_file,
    truncate, write_private_file,
};
use super::{
    CertificateCandidate, CertificateDer, CertificateError, CertificateImportRequest,
    CertificateMaterial, CertificateMetadata, ErrorKind, GeneralName, MAX_CERTIFICATE_PEM_BYTES,
    MAX_PRIVATE_KEY_PEM_BYTES, OffsetDateTime, PathBuf, PrivateKeyDer, SafeDir, ServerConfig,
    Sha256, StoredCertificate, StoredCertificateCandidate, is_canonical_uuid_v7,
    parse_x509_certificate,
};

use rustls::pki_types::pem::PemObject;
use sha2::Digest;

pub(super) fn ensure_material_version(
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

pub(super) fn ensure_complete_material_version(
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

pub(super) fn material_at(
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

pub(super) fn validate_candidate_material(
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

pub(super) fn public_metadata(stored: &StoredCertificate) -> CertificateMetadata {
    public_metadata_with_candidate(stored, None)
}

pub(super) fn public_metadata_with_candidate(
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

pub(super) struct ParsedCertificate {
    pub(super) fullchain: String,
    pub(super) domains: Vec<String>,
    pub(super) issued_at: String,
    pub(super) expires_at: String,
    pub(super) issuer: String,
    pub(super) fingerprint: String,
}

impl ParsedCertificate {
    pub(super) fn parse(request: &CertificateImportRequest) -> Result<Self, CertificateError> {
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

pub(super) fn material_id(request: &CertificateImportRequest) -> String {
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
