use super::super::{
    AcmeChallengeType, CertificateError, CertificateEventKind, CertificateIndex,
    CertificateIssueRequest, CertificateMetadata, CertificateOperation, CertificateOperationStage,
    CertificateStatus, CertificateStore, StoredCertificate,
    material_files::public_metadata,
    operations,
    persistence::persist_index,
    scheduling::{account_retry_is_blocking, retry_is_blocking},
    validation::utc_now,
};
use super::{
    DnsValidationMode, ManualDnsActionRequest, ManualDnsOrder, ManualDnsPhase,
    manual_order_is_valid,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

type ManualWork = (CertificateIssueRequest, ManualDnsOrder);

fn request(entry: &StoredCertificate) -> Result<CertificateIssueRequest, CertificateError> {
    let acme = entry
        .acme
        .as_ref()
        .ok_or(CertificateError::ManualDnsOrderInvalid)?;
    if acme.dns_mode != DnsValidationMode::Manual || acme.challenge_type != AcmeChallengeType::Dns01
    {
        return Err(CertificateError::ManualDnsOrderInvalid);
    }
    Ok(CertificateIssueRequest {
        domains: entry.metadata.domains.clone(),
        environment: entry
            .metadata
            .environment
            .ok_or(CertificateError::ManualDnsOrderInvalid)?,
        contact_email: acme.contact_email.clone(),
        challenge_type: AcmeChallengeType::Dns01,
        dns_mode: DnsValidationMode::Manual,
        dns_provider: None,
        accept_terms: true,
    })
}

fn order(entry: &StoredCertificate) -> Result<&ManualDnsOrder, CertificateError> {
    entry
        .acme
        .as_ref()
        .and_then(|acme| acme.manual_order.as_ref())
        .ok_or(CertificateError::ManualDnsOrderInvalid)
}

fn action_matches(entry: &StoredCertificate, action: &ManualDnsActionRequest) -> bool {
    entry
        .metadata
        .current_operation
        .as_ref()
        .is_some_and(|operation| operation.id == action.operation_id)
        && order(entry).is_ok_and(|order| {
            order.operation_id == action.operation_id
                && order.challenge_set_id == action.challenge_set_id
        })
}

fn expired(order: &ManualDnsOrder) -> bool {
    OffsetDateTime::parse(&order.expires_at, &Rfc3339)
        .ok()
        .is_none_or(|expires| expires <= OffsetDateTime::now_utc())
}

impl CertificateStore {
    // Keep index updates, event publication and rollback in one transaction.
    async fn mutate_manual_dns<F>(
        &self,
        id: &str,
        operation_id: &str,
        mutate: F,
    ) -> Result<CertificateMetadata, CertificateError>
    where
        F: FnOnce(
            &mut StoredCertificate,
            bool,
        ) -> Result<Option<CertificateEventKind>, CertificateError>,
    {
        let mut index = self.index.lock().await;
        let previous = index
            .certificates
            .get(id)
            .cloned()
            .ok_or(CertificateError::NotFound)?;
        if previous
            .metadata
            .current_operation
            .as_ref()
            .is_none_or(|operation| operation.id != operation_id)
        {
            return Err(CertificateError::OperationInProgress);
        }
        let events = index.events.clone();
        let sequence = index.event_sequence;
        let now = OffsetDateTime::now_utc();
        let backoff_blocked = retry_is_blocking(&previous, now)
            || previous
                .metadata
                .environment
                .is_some_and(|environment| account_retry_is_blocking(&index, environment, now));
        let result = (|| {
            let entry = index
                .certificates
                .get_mut(id)
                .ok_or(CertificateError::NotFound)?;
            let event = mutate(entry, backoff_blocked)?;
            let now = utc_now()?;
            entry.metadata.updated_at = now.clone();
            let operation = entry
                .metadata
                .current_operation
                .as_mut()
                .ok_or(CertificateError::OperationInProgress)?;
            operation.updated_at = now;
            let stage = operation.stage;
            let error = entry.metadata.last_error_code.clone();
            if let Some(event) = event {
                operations::append_event(&mut index, operation_id, id, event, stage, error)?;
            }
            persist_index(&self.certificates_dir()?, &index)?;
            Ok(public_metadata(
                index
                    .certificates
                    .get(id)
                    .ok_or(CertificateError::NotFound)?,
            ))
        })();
        if result.is_err() {
            index.certificates.insert(id.to_owned(), previous);
            index.events = events;
            index.event_sequence = sequence;
        }
        result
    }

    pub(crate) async fn load_manual_dns_order(
        &self,
        id: &str,
    ) -> Result<Option<ManualWork>, CertificateError> {
        let index = self.index.lock().await;
        let entry = index
            .certificates
            .get(id)
            .ok_or(CertificateError::NotFound)?;
        entry
            .acme
            .as_ref()
            .and_then(|acme| acme.manual_order.clone())
            .map(|order| request(entry).map(|request| (request, order)))
            .transpose()
    }

    pub(crate) async fn store_manual_dns_order(
        &self,
        id: &str,
        new: ManualDnsOrder,
    ) -> Result<(), CertificateError> {
        if !self.leases.lock().await.contains(id) {
            return Err(CertificateError::OperationInProgress);
        }
        let operation_id = new.operation_id.clone();
        self.mutate_manual_dns(id, &operation_id, |entry, _| {
            if !manual_order_is_valid(entry, &new) {
                return Err(CertificateError::ManualDnsOrderInvalid);
            }
            if let Ok(old) = order(entry)
                && (old.operation_id != new.operation_id
                    || old.challenge_set_id != new.challenge_set_id
                    || old.account_identity != new.account_identity
                    || old.order_url != new.order_url
                    || old.phase.is_terminal()
                    || (!old.records.is_empty() && old.records != new.records))
            {
                return Err(CertificateError::ManualDnsOrderInvalid);
            }
            let stage = match new.phase {
                ManualDnsPhase::AwaitingInput => CertificateOperationStage::AwaitingDns,
                ManualDnsPhase::CheckingDns => CertificateOperationStage::CheckingDns,
                ManualDnsPhase::Validating => CertificateOperationStage::WaitingForValidation,
                ManualDnsPhase::Finalizing => CertificateOperationStage::Finalizing,
                _ => return Err(CertificateError::OperationInProgress),
            };
            entry.metadata.current_operation.as_mut().unwrap().stage = stage;
            entry.metadata.last_error_code = new.last_error_code.clone();
            entry.acme.as_mut().unwrap().manual_order = Some(new);
            Ok((stage == CertificateOperationStage::AwaitingDns)
                .then_some(CertificateEventKind::OperatorActionRequired))
        })
        .await
        .map(|_| ())
    }

    pub(crate) async fn park_manual_dns_order(
        &self,
        id: &str,
        new: ManualDnsOrder,
    ) -> Result<(), CertificateError> {
        if new.phase != ManualDnsPhase::AwaitingInput {
            return Err(CertificateError::ManualDnsOrderInvalid);
        }
        let result = self.store_manual_dns_order(id, new).await;
        if result.is_ok() {
            self.release_lease(id).await;
        }
        result
    }

    pub(crate) async fn begin_manual_dns_continuation(
        &self,
        id: &str,
        action: &ManualDnsActionRequest,
    ) -> Result<
        Option<(CertificateMetadata, CertificateIssueRequest, ManualDnsOrder)>,
        CertificateError,
    > {
        if self.acquire_lease(id).await.is_err() {
            let index = self.index.lock().await;
            let entry = index
                .certificates
                .get(id)
                .ok_or(CertificateError::NotFound)?;
            return if action_matches(entry, action)
                && order(entry).is_ok_and(|order| {
                    matches!(
                        order.phase,
                        ManualDnsPhase::CheckingDns
                            | ManualDnsPhase::Validating
                            | ManualDnsPhase::Finalizing
                    )
                }) {
                Ok(None)
            } else {
                Err(CertificateError::OperationInProgress)
            };
        }
        let result = self
            .mutate_manual_dns(id, &action.operation_id, |entry, backoff_blocked| {
                if backoff_blocked {
                    return Err(CertificateError::OperationInProgress);
                }
                if !action_matches(entry, action)
                    || order(entry)?.phase != ManualDnsPhase::AwaitingInput
                {
                    return Err(CertificateError::OperationInProgress);
                }
                if expired(order(entry)?) {
                    return Err(CertificateError::ManualDnsExpired);
                }
                let now = utc_now()?;
                let order = entry.acme.as_mut().unwrap().manual_order.as_mut().unwrap();
                order.phase = ManualDnsPhase::CheckingDns;
                order.last_checked_at = Some(now);
                order.last_error_code = None;
                entry.metadata.last_error_code = None;
                entry.metadata.current_operation.as_mut().unwrap().stage =
                    CertificateOperationStage::CheckingDns;
                Ok(None)
            })
            .await;
        match result {
            Ok(metadata) => {
                let work = self.load_manual_dns_order(id).await;
                match work {
                    Ok(Some((request, order))) => Ok(Some((metadata, request, order))),
                    _ => {
                        self.release_lease(id).await;
                        Err(CertificateError::StoreUnavailable)
                    }
                }
            }
            Err(error) => {
                if error == CertificateError::ManualDnsExpired {
                    self.finish_manual_dns_failed(id, &action.operation_id, error)
                        .await?;
                } else {
                    self.release_lease(id).await;
                }
                Err(error)
            }
        }
    }

    pub(crate) async fn begin_manual_dns_recovery(
        &self,
        id: &str,
    ) -> Result<Option<ManualWork>, CertificateError> {
        if self.acquire_lease(id).await.is_err() {
            return Ok(None);
        }
        let result = {
            let index = self.index.lock().await;
            index
                .certificates
                .get(id)
                .ok_or(CertificateError::NotFound)
                .and_then(|entry| {
                    let order = order(entry)?;
                    if !resumable(&index, id, entry, order) {
                        return Ok(None);
                    }
                    Ok(Some((request(entry)?, order.clone())))
                })
        };
        if !matches!(result, Ok(Some(_))) {
            self.release_lease(id).await;
        }
        result
    }

    pub(crate) async fn pending_manual_dns_resume_ids(
        &self,
    ) -> Result<Vec<String>, CertificateError> {
        let index = self.index.lock().await;
        Ok(index
            .certificates
            .iter()
            .filter(|(id, entry)| {
                order(entry).is_ok_and(|order| resumable(&index, id, entry, order))
            })
            .map(|(id, _)| id.clone())
            .collect())
    }

    pub(crate) async fn release_manual_dns_for_recovery(
        &self,
        id: &str,
        operation_id: &str,
        error: CertificateError,
    ) -> Result<(), CertificateError> {
        let result = self
            .mutate_manual_dns(id, operation_id, |entry, _| {
                if order(entry)?.phase.is_terminal() {
                    return Err(CertificateError::OperationInProgress);
                }
                entry.metadata.last_error_code = Some(error.code().to_owned());
                entry.metadata.last_error_at = Some(utc_now()?);
                let deadline = OffsetDateTime::now_utc()
                    .checked_add(time::Duration::seconds(60))
                    .and_then(|value| value.format(&Rfc3339).ok())
                    .ok_or(CertificateError::StoreUnavailable)?;
                entry.next_attempt_at = super::super::scheduling::max_retry_deadline_string(
                    entry.next_attempt_at.as_deref(),
                    &deadline,
                )
                .or(Some(deadline));
                entry
                    .acme
                    .as_mut()
                    .unwrap()
                    .manual_order
                    .as_mut()
                    .unwrap()
                    .last_error_code = Some(error.code().to_owned());
                let order = entry.acme.as_mut().unwrap().manual_order.as_mut().unwrap();
                if order.phase == ManualDnsPhase::CheckingDns && !order.records.is_empty() {
                    order.phase = ManualDnsPhase::AwaitingInput;
                    entry.metadata.current_operation.as_mut().unwrap().stage =
                        CertificateOperationStage::AwaitingDns;
                    Ok(Some(CertificateEventKind::OperatorActionRequired))
                } else {
                    Ok(None)
                }
            })
            .await;
        self.release_lease(id).await;
        result.map(|_| ())
    }

    pub(crate) async fn finish_manual_dns_failed(
        &self,
        id: &str,
        operation_id: &str,
        error: CertificateError,
    ) -> Result<(), CertificateError> {
        let result = self
            .mutate_manual_dns(id, operation_id, |entry, _| {
                let phase = match error {
                    CertificateError::ManualDnsExpired => ManualDnsPhase::Expired,
                    CertificateError::ManualDnsCancelled => ManualDnsPhase::Cancelled,
                    _ => ManualDnsPhase::Failed,
                };
                let acme = entry
                    .acme
                    .as_mut()
                    .filter(|acme| acme.dns_mode == DnsValidationMode::Manual)
                    .ok_or(CertificateError::ManualDnsOrderInvalid)?;
                if let Some(order) = acme.manual_order.as_mut() {
                    if order.phase.is_terminal() {
                        return Err(CertificateError::OperationInProgress);
                    }
                    if order.operation_id != operation_id {
                        return Err(CertificateError::OperationInProgress);
                    }
                    order.phase = phase;
                    order.last_error_code = Some(error.code().to_owned());
                    order.private_key_pem = None;
                    order.csr_der = None;
                }
                entry.metadata.operation = CertificateOperation::Idle;
                if entry.material_id.is_none() {
                    entry.metadata.status = CertificateStatus::Failed;
                }
                entry.metadata.last_error_code = Some(error.code().to_owned());
                entry.metadata.last_error_at = Some(utc_now()?);
                entry.next_attempt_at = None;
                entry.retry_delay_seconds = None;
                let stage = match phase {
                    ManualDnsPhase::Expired => CertificateOperationStage::Expired,
                    ManualDnsPhase::Cancelled => CertificateOperationStage::Cancelled,
                    _ => CertificateOperationStage::NeedsAttention,
                };
                entry.metadata.current_operation.as_mut().unwrap().stage = stage;
                Ok(Some(match phase {
                    ManualDnsPhase::Expired => CertificateEventKind::Expired,
                    ManualDnsPhase::Cancelled => CertificateEventKind::Cancelled,
                    _ => CertificateEventKind::Failed,
                }))
            })
            .await;
        self.release_lease(id).await;
        result.map(|_| ())
    }

    pub(crate) async fn cancel_manual_dns_order(
        &self,
        id: &str,
        action: &ManualDnsActionRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        self.acquire_lease(id).await?;
        let allowed = {
            let index = self.index.lock().await;
            index
                .certificates
                .get(id)
                .ok_or(CertificateError::NotFound)
                .and_then(|entry| {
                    if action_matches(entry, action)
                        && order(entry)
                            .is_ok_and(|order| order.phase == ManualDnsPhase::AwaitingInput)
                    {
                        Ok(())
                    } else {
                        Err(CertificateError::OperationInProgress)
                    }
                })
        };
        if let Err(error) = allowed {
            self.release_lease(id).await;
            return Err(error);
        }
        self.finish_manual_dns_failed(
            id,
            &action.operation_id,
            CertificateError::ManualDnsCancelled,
        )
        .await?;
        self.get(id).await
    }

    pub(crate) async fn expire_manual_dns_orders(&self) -> Result<(), CertificateError> {
        let expired_orders = {
            let index = self.index.lock().await;
            index
                .certificates
                .iter()
                .filter_map(|(id, entry)| {
                    let order = order(entry).ok()?;
                    (!order.phase.is_terminal()
                        && expired(order)
                        && !index.pending_candidates.contains_key(id))
                    .then(|| (id.clone(), order.operation_id.clone()))
                })
                .collect::<Vec<_>>()
        };
        for (id, operation_id) in expired_orders {
            if self.acquire_lease(&id).await.is_err() {
                continue;
            }
            let still_expired = {
                let index = self.index.lock().await;
                index.certificates.get(&id).is_some_and(|entry| {
                    order(entry).is_ok_and(|order| {
                        order.operation_id == operation_id
                            && !order.phase.is_terminal()
                            && expired(order)
                    }) && !index.pending_candidates.contains_key(&id)
                })
            };
            if !still_expired {
                self.release_lease(&id).await;
                continue;
            }
            self.finish_manual_dns_failed(&id, &operation_id, CertificateError::ManualDnsExpired)
                .await?;
        }
        Ok(())
    }
}

fn resumable(
    index: &CertificateIndex,
    id: &str,
    entry: &StoredCertificate,
    order: &ManualDnsOrder,
) -> bool {
    let now = OffsetDateTime::now_utc();
    entry.metadata.operation != CertificateOperation::Idle
        && !index.pending_candidates.contains_key(id)
        && !retry_is_blocking(entry, now)
        && entry
            .metadata
            .environment
            .is_some_and(|environment| !account_retry_is_blocking(index, environment, now))
        && (matches!(
            order.phase,
            ManualDnsPhase::Validating | ManualDnsPhase::Finalizing
        ) || (order.phase == ManualDnsPhase::CheckingDns && order.records.is_empty()))
}
