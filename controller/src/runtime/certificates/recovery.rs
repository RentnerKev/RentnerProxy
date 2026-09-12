use super::scheduling::{valid_fingerprint, valid_timestamp};
use super::validation::{
    dns_intent_belongs_to, is_certificate_domain, read_regular_private_file, write_private_file,
};
use super::{
    AcmeChallengeType, CANDIDATE_MANIFEST_FILE, CANDIDATE_MANIFEST_VERSION, CertificateError,
    CertificateEventKind, CertificateIndex, CertificateOperation, CertificateOperationStage,
    CertificateSource, CertificateStatus, ErrorKind, MAX_ACME_RETRY_DELAY_SECONDS,
    MAX_CANDIDATE_MANIFEST_BYTES, MAX_CANDIDATE_RETRY_DELAY_SECONDS, MIN_ACME_RETRY_DELAY_SECONDS,
    MIN_CANDIDATE_RETRY_DELAY_SECONDS, OperationKind, SafeDir, StoredCertificateCandidate,
    is_canonical_uuid_v7, operations,
};

pub(super) fn ensure_issued_event(
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

pub(super) fn reconcile_candidate_manifests(
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

pub(super) fn read_candidate_manifest(
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

pub(super) fn persist_candidate_manifest(
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

pub(super) fn remove_candidate_manifest(
    certificates_dir: &SafeDir,
    id: &str,
) -> Result<(), CertificateError> {
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

pub(super) fn candidate_is_valid(id: &str, candidate: &StoredCertificateCandidate) -> bool {
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
