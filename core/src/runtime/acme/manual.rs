use std::{collections::BTreeSet, sync::Arc, time::Duration};

use instant_acme::{
    AuthorizationStatus, ChallengeStatus, ChallengeType, Identifier, NewOrder, Order, OrderStatus,
    RetryPolicy,
};
use rcgen::{CertificateParams, DistinguishedName, KeyPair};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::time::timeout;

use super::{
    ACME_JOBS, DNS_ORDER_TIMEOUT, acme_http::AcmeResponseObserver, order::requested_identifier,
};
use crate::runtime::{
    CertificateMetadata, CertificateOperationStage, ProxyRuntime,
    certificates::{
        CertificateError, CertificateIssueRequest, CertificateOperation, ManualDnsActionRequest,
        ManualDnsOrder, ManualDnsPhase, ManualDnsRecord,
    },
    manual_dns_propagation,
};

const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(20);

struct ManualAccount {
    account: instant_acme::Account,
    identity: String,
    directory: String,
    observer: AcmeResponseObserver,
}

enum ManualOutcome {
    Paused,
    Issued(String, String),
}

impl ProxyRuntime {
    pub(super) async fn issue_manual_dns_inner(
        self: &Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
    ) {
        let operation_id = match self.certificate_store.get(&id).await {
            Ok(metadata) => match metadata.current_operation {
                Some(operation) => operation.id,
                None => return,
            },
            Err(_) => return,
        };
        let result = timeout(
            DNS_ORDER_TIMEOUT,
            self.prepare_manual_dns(&id, &request, &operation_id),
        )
        .await
        .unwrap_or(Err(CertificateError::AcmeFailed));
        self.finish_manual_dns_result(&id, &request, &operation_id, result)
            .await;
    }

    pub(crate) async fn start_manual_dns_continue(
        self: &Arc<Self>,
        id: String,
        action: ManualDnsActionRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        if self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(CertificateError::OperationInProgress);
        }
        let permit = ACME_JOBS
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        let Some((metadata, request, order)) = self
            .certificate_store
            .begin_manual_dns_continuation(&id, &action)
            .await?
        else {
            return self.certificate_store.get(&id).await;
        };
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _permit = permit;
            runtime.resume_manual_dns_inner(id, request, order).await;
        });
        Ok(metadata)
    }

    pub(crate) async fn recover_manual_dns(self: &Arc<Self>) {
        if self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let _ = self.certificate_store.expire_manual_dns_orders().await;
        let Ok(ids) = self.certificate_store.pending_manual_dns_resume_ids().await else {
            return;
        };
        for id in ids {
            if self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let Ok(permit) = ACME_JOBS.try_acquire() else {
                break;
            };
            let Ok(Some((request, order))) =
                self.certificate_store.begin_manual_dns_recovery(&id).await
            else {
                continue;
            };
            let runtime = Arc::clone(self);
            tokio::spawn(async move {
                let _permit = permit;
                runtime.resume_manual_dns_inner(id, request, order).await;
            });
        }
    }

    async fn resume_manual_dns_inner(
        self: &Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
        saved: ManualDnsOrder,
    ) {
        let operation_id = saved.operation_id.clone();
        let result = timeout(
            DNS_ORDER_TIMEOUT,
            self.resume_manual_dns(&id, &request, saved),
        )
        .await
        .unwrap_or(Err(CertificateError::AcmeFailed));
        self.finish_manual_dns_result(&id, &request, &operation_id, result)
            .await;
    }

    async fn finish_manual_dns_result(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        operation_id: &str,
        result: Result<ManualOutcome, CertificateError>,
    ) {
        match result {
            Ok(ManualOutcome::Paused) => {}
            Ok(ManualOutcome::Issued(certificate, key)) => {
                match self
                    .certificate_store
                    .stage_acme(id, request, certificate, key)
                    .await
                {
                    Ok(staged) => {
                        let _ = self.commit_or_reapply_staged_certificate(staged).await;
                    }
                    Err(CertificateError::StoreUnavailable) => {
                        let _ = self
                            .certificate_store
                            .release_manual_dns_for_recovery(
                                id,
                                operation_id,
                                CertificateError::StoreUnavailable,
                            )
                            .await;
                    }
                    Err(error) => {
                        let _ = self
                            .certificate_store
                            .finish_manual_dns_failed(id, operation_id, error)
                            .await;
                    }
                }
            }
            Err(error) => {
                let Ok(metadata) = self.certificate_store.get(id).await else {
                    return;
                };
                if metadata.operation == CertificateOperation::Idle
                    || metadata
                        .current_operation
                        .is_none_or(|operation| operation.id != operation_id)
                {
                    return;
                }
                let saved = match self.certificate_store.load_manual_dns_order(id).await {
                    Ok(saved) => saved,
                    Err(_) => return,
                };
                if saved
                    .as_ref()
                    .is_some_and(|(_, order)| order.operation_id != operation_id)
                {
                    return;
                }
                if saved.is_none()
                    && matches!(
                        error,
                        CertificateError::AcmeFailed | CertificateError::StoreUnavailable
                    )
                {
                    self.certificate_store.finish_failed(id, error).await;
                    return;
                }
                let recoverable = !matches!(
                    error,
                    CertificateError::ManualDnsExpired | CertificateError::ManualDnsOrderInvalid
                ) && saved.is_some_and(|(_, order)| {
                    matches!(
                        order.phase,
                        ManualDnsPhase::CheckingDns
                            | ManualDnsPhase::Validating
                            | ManualDnsPhase::Finalizing
                    )
                });
                if recoverable {
                    let _ = self
                        .certificate_store
                        .release_manual_dns_for_recovery(id, operation_id, error)
                        .await;
                } else {
                    let _ = self
                        .certificate_store
                        .finish_manual_dns_failed(id, operation_id, error)
                        .await;
                }
            }
        }
    }

    async fn prepare_manual_dns(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        operation_id: &str,
    ) -> Result<ManualOutcome, CertificateError> {
        self.certificate_store
            .record_operation_stage(id, CertificateOperationStage::CreatingOrder)
            .await?;
        let observer = AcmeResponseObserver::default();
        let (account, identity, directory) = timeout(
            ACCOUNT_TIMEOUT,
            self.manual_acme_account(id, request, None, observer.clone()),
        )
        .await
        .map_err(|_| CertificateError::AcmeFailed)??;
        self.prepare_manual_dns_with_account(
            id,
            request,
            operation_id,
            ManualAccount {
                account,
                identity,
                directory,
                observer,
            },
        )
        .await
    }

    async fn prepare_manual_dns_with_account(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
        operation_id: &str,
        connection: ManualAccount,
    ) -> Result<ManualOutcome, CertificateError> {
        let ManualAccount {
            account,
            identity,
            directory,
            observer,
        } = connection;
        let identifiers = request
            .domains
            .iter()
            .cloned()
            .map(Identifier::Dns)
            .collect::<Vec<_>>();
        let mut order = account
            .new_order(&NewOrder::new(&identifiers))
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        validate_order_urls(&mut order, &directory)?;
        let expires_at = observer
            .expires_at(order.url())
            .ok_or(CertificateError::ManualDnsOrderInvalid)?;
        require_unexpired(&expires_at)?;
        let mut saved = ManualDnsOrder {
            version: 1,
            operation_id: operation_id.to_owned(),
            challenge_set_id: operation_id.to_owned(),
            account_identity: identity,
            order_url: order.url().to_owned(),
            expires_at,
            records: Vec::new(),
            phase: ManualDnsPhase::CheckingDns,
            private_key_pem: None,
            csr_der: None,
            last_checked_at: None,
            last_error_code: None,
        };
        self.certificate_store
            .store_manual_dns_order(id, saved.clone())
            .await?;
        saved.records =
            collect_records(&mut order, request, &saved.expires_at, &observer, None).await?;
        for record in &saved.records {
            saved.expires_at = earlier_expiry(&saved.expires_at, &record.expires_at)?;
        }
        if !saved.records.is_empty() {
            saved.phase = ManualDnsPhase::AwaitingInput;
            self.certificate_store
                .park_manual_dns_order(id, saved)
                .await?;
            return Ok(ManualOutcome::Paused);
        }
        self.finish_manual_order(id, request, &mut order, saved)
            .await
    }

    async fn resume_manual_dns(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        saved: ManualDnsOrder,
    ) -> Result<ManualOutcome, CertificateError> {
        require_unexpired(&saved.expires_at)?;
        let observer = AcmeResponseObserver::default();
        let (account, identity, directory) = timeout(
            ACCOUNT_TIMEOUT,
            self.manual_acme_account(id, request, Some(&saved.account_identity), observer.clone()),
        )
        .await
        .map_err(|_| CertificateError::AcmeFailed)??;
        self.resume_manual_dns_with_account(
            id,
            request,
            saved,
            ManualAccount {
                account,
                identity,
                directory,
                observer,
            },
        )
        .await
    }

    async fn resume_manual_dns_with_account(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
        mut saved: ManualDnsOrder,
        connection: ManualAccount,
    ) -> Result<ManualOutcome, CertificateError> {
        let ManualAccount {
            account,
            directory,
            observer,
            ..
        } = connection;
        require_same_origin(&saved.order_url, &directory)?;
        let mut order = account
            .order(saved.order_url.clone())
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        validate_order_urls(&mut order, &directory)?;
        if let Some(expires) = observer.expires_at(&saved.order_url) {
            saved.expires_at = earlier_expiry(&saved.expires_at, &expires)?;
        }
        require_unexpired(&saved.expires_at)?;
        let preparing = saved.records.is_empty() && saved.phase == ManualDnsPhase::CheckingDns;
        let records = collect_records(
            &mut order,
            request,
            &saved.expires_at,
            &observer,
            if preparing {
                None
            } else {
                Some(&saved.records)
            },
        )
        .await?;
        if preparing && !records.is_empty() {
            saved.records = records;
            for record in &saved.records {
                saved.expires_at = earlier_expiry(&saved.expires_at, &record.expires_at)?;
            }
            saved.phase = ManualDnsPhase::AwaitingInput;
            self.certificate_store
                .park_manual_dns_order(id, saved)
                .await?;
            return Ok(ManualOutcome::Paused);
        }
        for record in &records {
            saved.expires_at = earlier_expiry(&saved.expires_at, &record.expires_at)?;
        }
        if order.state().status == OrderStatus::Pending && !records.is_empty() {
            // Recheck propagation on every resume before triggering any still-pending validation.
            let checked =
                manual_dns_propagation::check_records(&records, request.environment).await;
            if self
                .validate_manual_dns_check(id, &mut order, &mut saved, checked)
                .await?
            {
                return Ok(ManualOutcome::Paused);
            }
        }
        self.finish_manual_order(id, request, &mut order, saved)
            .await
    }

    async fn validate_manual_dns_check(
        &self,
        id: &str,
        order: &mut Order,
        saved: &mut ManualDnsOrder,
        checked: Result<(), CertificateError>,
    ) -> Result<bool, CertificateError> {
        require_unexpired(&saved.expires_at)?;
        saved.last_checked_at = Some(
            OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|_| CertificateError::StoreUnavailable)?,
        );
        if let Err(
            error @ (CertificateError::ManualDnsNotPropagated
            | CertificateError::ManualDnsLookupFailed),
        ) = checked
        {
            saved.last_error_code = Some(error.code().to_owned());
            saved.phase = ManualDnsPhase::AwaitingInput;
            self.certificate_store
                .park_manual_dns_order(id, saved.clone())
                .await?;
            return Ok(true);
        }
        checked?;
        saved.last_error_code = None;
        saved.phase = ManualDnsPhase::Validating;
        self.certificate_store
            .store_manual_dns_order(id, saved.clone())
            .await?;
        let mut authorizations = order.authorizations();
        while let Some(authorization) = authorizations.next().await {
            let mut authorization = authorization.map_err(|_| CertificateError::AcmeFailed)?;
            if authorization.status == AuthorizationStatus::Valid {
                continue;
            }
            if authorization.status != AuthorizationStatus::Pending {
                return Err(CertificateError::ManualDnsOrderInvalid);
            }
            let mut challenge = authorization
                .challenge(ChallengeType::Dns01)
                .ok_or(CertificateError::ManualDnsOrderInvalid)?;
            if challenge.status == ChallengeStatus::Pending {
                challenge
                    .set_ready()
                    .await
                    .map_err(|_| CertificateError::AcmeFailed)?;
            } else if !matches!(
                challenge.status,
                ChallengeStatus::Processing | ChallengeStatus::Valid
            ) {
                return Err(CertificateError::ManualDnsOrderInvalid);
            }
        }
        Ok(false)
    }

    async fn finish_manual_order(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
        order: &mut Order,
        mut saved: ManualDnsOrder,
    ) -> Result<ManualOutcome, CertificateError> {
        match order.state().status {
            OrderStatus::Pending => {
                self.certificate_store
                    .record_operation_stage(id, CertificateOperationStage::WaitingForValidation)
                    .await?;
                if order
                    .poll_ready(&RetryPolicy::default())
                    .await
                    .map_err(|_| order_error(order))?
                    != OrderStatus::Ready
                {
                    return Err(CertificateError::ManualDnsOrderInvalid);
                }
            }
            OrderStatus::Ready | OrderStatus::Processing | OrderStatus::Valid => {}
            _ => return Err(CertificateError::ManualDnsOrderInvalid),
        }
        if order.state().status == OrderStatus::Ready {
            ensure_saved_csr(&mut saved, &request.domains)?;
            saved.phase = ManualDnsPhase::Finalizing;
            // Persist both key and exact CSR before the first finalization request.
            self.certificate_store
                .store_manual_dns_order(id, saved.clone())
                .await?;
            self.certificate_store
                .record_operation_stage(id, CertificateOperationStage::Finalizing)
                .await?;
            order
                .finalize_csr(
                    saved
                        .csr_der
                        .as_deref()
                        .ok_or(CertificateError::StoreUnavailable)?,
                )
                .await
                .map_err(|_| CertificateError::AcmeFailed)?;
        }
        let key = saved
            .private_key_pem
            .ok_or(CertificateError::StoreUnavailable)?;
        let certificate = order
            .poll_certificate(&RetryPolicy::default())
            .await
            .map_err(|_| order_error(order))?;
        Ok(ManualOutcome::Issued(certificate, key))
    }
}

fn order_error(order: &mut Order) -> CertificateError {
    if order.state().status == OrderStatus::Invalid {
        CertificateError::ManualDnsOrderInvalid
    } else {
        CertificateError::AcmeFailed
    }
}

fn require_same_origin(url: &str, directory: &str) -> Result<(), CertificateError> {
    let uri = reqwest::Url::parse(url).map_err(|_| CertificateError::ManualDnsOrderInvalid)?;
    let directory =
        reqwest::Url::parse(directory).map_err(|_| CertificateError::ManualDnsOrderInvalid)?;
    if url.len() > 2048
        || uri.scheme() != "https"
        || uri.origin() != directory.origin()
        || !uri.username().is_empty()
        || uri.password().is_some()
        || uri.fragment().is_some()
    {
        return Err(CertificateError::ManualDnsOrderInvalid);
    }
    Ok(())
}

fn validate_order_urls(order: &mut Order, directory: &str) -> Result<(), CertificateError> {
    require_same_origin(order.url(), directory)?;
    let state = order.state();
    require_same_origin(&state.finalize, directory)?;
    for authorization in &state.authorizations {
        require_same_origin(&authorization.url, directory)?;
    }
    if let Some(url) = &state.certificate {
        require_same_origin(url, directory)?;
    }
    Ok(())
}

fn require_unexpired(expires: &str) -> Result<(), CertificateError> {
    let expires = OffsetDateTime::parse(expires, &Rfc3339)
        .map_err(|_| CertificateError::ManualDnsOrderInvalid)?;
    if expires <= OffsetDateTime::now_utc() {
        return Err(CertificateError::ManualDnsExpired);
    }
    Ok(())
}

fn earlier_expiry(left: &str, right: &str) -> Result<String, CertificateError> {
    let l = OffsetDateTime::parse(left, &Rfc3339).map_err(|_| CertificateError::AcmeFailed)?;
    let r = OffsetDateTime::parse(right, &Rfc3339).map_err(|_| CertificateError::AcmeFailed)?;
    Ok(if l <= r { left } else { right }.to_owned())
}

async fn collect_records(
    order: &mut Order,
    request: &CertificateIssueRequest,
    expires: &str,
    observer: &AcmeResponseObserver,
    saved: Option<&[ManualDnsRecord]>,
) -> Result<Vec<ManualDnsRecord>, CertificateError> {
    let mut seen = BTreeSet::new();
    let mut records = Vec::new();
    let origin = order.url().to_owned();
    let mut authorizations = order.authorizations();
    while let Some(authorization) = authorizations.next().await {
        let mut authorization = authorization.map_err(|_| CertificateError::AcmeFailed)?;
        let (identifier, bare) =
            requested_identifier(&authorization.identifier(), &request.domains)
                .map_err(|_| CertificateError::ManualDnsOrderInvalid)?;
        if !seen.insert(identifier.clone()) {
            return Err(CertificateError::ManualDnsOrderInvalid);
        }
        if authorization.status == AuthorizationStatus::Valid {
            continue;
        }
        if authorization.status != AuthorizationStatus::Pending {
            return Err(CertificateError::ManualDnsOrderInvalid);
        }
        let authorization_expiry = observer
            .expires_at(authorization.url())
            .unwrap_or_else(|| expires.to_owned());
        let expiry = earlier_expiry(expires, &authorization_expiry)?;
        require_unexpired(&expiry)?;
        let challenge = authorization
            .challenge(ChallengeType::Dns01)
            .ok_or(CertificateError::ManualDnsOrderInvalid)?;
        require_same_origin(&challenge.url, &origin)?;
        let record = ManualDnsRecord {
            identifier,
            owner: format!("_acme-challenge.{bare}"),
            value: challenge.key_authorization().dns_value(),
            expires_at: expiry,
        };
        if let Some(saved) = saved
            && !saved.iter().any(|expected| {
                expected.identifier == record.identifier
                    && expected.owner == record.owner
                    && expected.value == record.value
            })
        {
            return Err(CertificateError::ManualDnsOrderInvalid);
        }
        records.push(record);
    }
    if seen != request.domains.iter().cloned().collect::<BTreeSet<_>>() {
        return Err(CertificateError::ManualDnsOrderInvalid);
    }
    Ok(records)
}

fn ensure_saved_csr(
    saved: &mut ManualDnsOrder,
    domains: &[String],
) -> Result<(), CertificateError> {
    match (&saved.private_key_pem, &saved.csr_der) {
        (Some(_), Some(_)) => return Ok(()),
        (None, None) => {}
        _ => return Err(CertificateError::StoreUnavailable),
    }
    let mut params =
        CertificateParams::new(domains.to_vec()).map_err(|_| CertificateError::AcmeFailed)?;
    params.distinguished_name = DistinguishedName::new();
    let key = KeyPair::generate().map_err(|_| CertificateError::AcmeFailed)?;
    let csr = params
        .serialize_request(&key)
        .map_err(|_| CertificateError::AcmeFailed)?;
    saved.private_key_pem = Some(key.serialize_pem());
    saved.csr_der = Some(csr.der().to_vec());
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/private/acme_manual.rs"]
mod tests;
