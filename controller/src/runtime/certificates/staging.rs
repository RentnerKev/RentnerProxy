use super::material_files::{ParsedCertificate, ensure_material_version, material_id};
use super::persistence::persist_index;
use super::recovery::persist_candidate_manifest;
use super::validation::{certificate_covers, utc_now};
use super::{
    CANDIDATE_MANIFEST_VERSION, CandidateActivation, CertificateEnvironment, CertificateError,
    CertificateEventKind, CertificateImportRequest, CertificateIssueRequest, CertificateOperation,
    CertificateOperationStage, CertificateSource, CertificateStatus, CertificateStore,
    MAX_CERTIFICATE_PEM_BYTES, MAX_PRIVATE_KEY_PEM_BYTES, OperationKind, StagedCertificate,
    StoredAcmeConfiguration, StoredCertificate, StoredCertificateCandidate, StoredMetadata,
    encrypt, is_canonical_uuid_v7, operations,
};

impl CertificateStore {
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
            self.release_lease(id).await;
            return Err(CertificateError::OperationInProgress);
        };
        operation.stage = CertificateOperationStage::CertificateReady;
        operation.updated_at = now.clone();
        staged.stored.metadata.current_operation = Some(operation.clone());

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

            persist_index(&certificates_dir, &index)
        };

        persistence?;
        Ok(staged)
    }

    pub(super) fn stored_acme_configuration(
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
}
