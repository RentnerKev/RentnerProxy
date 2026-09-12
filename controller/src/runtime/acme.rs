mod accounts;
#[path = "acme_http.rs"]
mod acme_http;
mod order;
use super::{
    ProxyRuntime,
    dns::{DnsProvider, DnsRecordIntent},
};
use crate::{
    runtime::certificates::{AcmeChallengeType, CertificateError, CertificateIssueRequest},
    server::challenges::ChallengeStore,
};
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{Semaphore, SemaphorePermit},
    time::timeout,
};
const ORDER_TIMEOUT: Duration = Duration::from_secs(120);
const DNS_ORDER_TIMEOUT: Duration = Duration::from_secs(180);
const DNS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(60);
static ACME_JOBS: Semaphore = Semaphore::const_new(4);

impl ProxyRuntime {
    pub(crate) async fn recover_dns_cleanup(self: &Arc<Self>) {
        let Ok(mut ids) = self.certificate_store.pending_dns_cleanup_ids().await else {
            return;
        };
        if !ids.is_empty() {
            let offset = self
                .dns_cleanup_cursor
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                % ids.len();
            ids.rotate_left(offset);
        }
        for id in ids {
            if self.stopping.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let Ok(permit) = ACME_JOBS.try_acquire() else {
                break;
            };
            let runtime = Arc::clone(self);
            tokio::spawn(async move {
                let _permit = permit;
                runtime.recover_dns_cleanup_one(&id).await;
            });
        }
    }

    async fn recover_dns_cleanup_one(&self, id: &str) {
        let work = match self.certificate_store.begin_dns_cleanup(id).await {
            Ok(Some(work)) => work,
            Ok(None) | Err(_) => return,
        };
        let (environment, config, intents) = work;
        let result = match DnsProvider::from_config(config, environment) {
            Ok(provider) => self.cleanup_dns_challenges(id, &provider, &intents).await,
            Err(error) => Err(error),
        };
        let _ = result;
        self.certificate_store.finish_dns_cleanup(id).await;
    }

    pub(crate) async fn start_acme_issue(
        self: &Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        if self
            .certificate_store
            .pending_candidate_ids()
            .await?
            .iter()
            .any(|candidate_id| candidate_id == &id)
        {
            return Err(CertificateError::OperationInProgress);
        }
        let permit = ACME_JOBS
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        let metadata = self
            .certificate_store
            .begin_issue(&id, request.clone(), false)
            .await?;
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _permit = permit;
            runtime.issue_acme_inner(id, request, challenges).await;
        });
        Ok(metadata)
    }

    pub(crate) async fn start_acme_renewal(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        if let Some(metadata) = self.retry_certificate_candidate(&id, false).await? {
            return Ok(metadata);
        }
        let permit = ACME_JOBS
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        self.renew_with_permit(id, challenges, permit).await
    }

    pub(crate) async fn start_scheduled_acme_renewal(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let permit = ACME_JOBS
            .acquire()
            .await
            .map_err(|_| CertificateError::OperationInProgress)?;
        let certificate = self.certificate_store.get(&id).await?;
        if !self.certificate_store.renewal_is_allowed(&id).await
            || !Self::renewal_is_due(&certificate)
        {
            return Err(CertificateError::OperationInProgress);
        }
        self.renew_with_permit(id, challenges, permit).await
    }

    async fn renew_with_permit(
        self: &Arc<Self>,
        id: String,
        challenges: ChallengeStore,
        permit: SemaphorePermit<'static>,
    ) -> Result<super::CertificateMetadata, CertificateError> {
        let (metadata, request) = self.certificate_store.begin_renewal(&id).await?;
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _permit = permit;
            runtime.issue_acme_inner(id, request, challenges).await;
        });
        Ok(metadata)
    }

    async fn issue_acme_inner(
        self: Arc<Self>,
        id: String,
        request: CertificateIssueRequest,
        challenges: ChallengeStore,
    ) {
        let dns_provider = match request.challenge_type {
            AcmeChallengeType::Http01 => None,
            AcmeChallengeType::Dns01 => {
                let Some(config) = request.dns_provider.clone() else {
                    self.certificate_store
                        .finish_failed(&id, CertificateError::AcmeDnsRequired)
                        .await;
                    return;
                };
                match DnsProvider::from_config(config, request.environment) {
                    Ok(provider) => Some(provider),
                    Err(error) => {
                        self.certificate_store.finish_failed(&id, error).await;
                        return;
                    }
                }
            }
        };
        let previous_intents = match self.certificate_store.pending_dns_records(&id).await {
            Ok(intents) => intents,
            Err(error) => {
                self.certificate_store.finish_failed(&id, error).await;
                return;
            }
        };
        if !previous_intents.is_empty() {
            let cleanup = match dns_provider.as_ref() {
                Some(provider) => {
                    self.cleanup_dns_challenges(&id, provider, &previous_intents)
                        .await
                }
                None => Err(CertificateError::DnsCleanupFailed),
            };
            if let Err(error) = cleanup {
                self.certificate_store.finish_failed(&id, error).await;
                return;
            }
        }
        let mut registered = Vec::new();
        let mut dns_intents: Vec<DnsRecordIntent> = Vec::new();
        let order_result = timeout(
            if request.challenge_type == AcmeChallengeType::Dns01 {
                DNS_ORDER_TIMEOUT
            } else {
                ORDER_TIMEOUT
            },
            self.issue_acme(
                &id,
                &request,
                &challenges,
                &mut registered,
                dns_provider.as_ref(),
                &mut dns_intents,
            ),
        )
        .await
        .unwrap_or(Err(CertificateError::AcmeFailed));
        let (candidate, issue_error) = match order_result {
            Ok((certificate_pem, private_key_pem)) => {
                match self
                    .certificate_store
                    .stage_acme(&id, &request, certificate_pem, private_key_pem)
                    .await
                {
                    Ok(staged) => (Some(staged), None),
                    Err(error) => (None, Some(error)),
                }
            }
            Err(error) => (None, Some(error)),
        };
        for (domain, token) in registered {
            challenges.remove(&domain, &token).await;
        }
        if let Some(staged) = candidate {
            let _ = self.commit_or_reapply_staged_certificate(staged).await;
            self.recover_dns_cleanup_one(&id).await;
            return;
        }
        if let Some(error) = issue_error {
            self.certificate_store.finish_failed(&id, error).await;
        }
        self.recover_dns_cleanup_one(&id).await;
    }

    async fn cleanup_dns_challenges(
        &self,
        id: &str,
        provider: &DnsProvider,
        intents: &[DnsRecordIntent],
    ) -> Result<(), CertificateError> {
        if intents.is_empty() {
            return Ok(());
        }
        timeout(DNS_CLEANUP_TIMEOUT, async {
            for (index, intent) in intents.iter().enumerate() {
                provider
                    .cleanup_intents(std::slice::from_ref(intent))
                    .await?;
                self.certificate_store
                    .set_pending_dns_records(id, intents[index + 1..].to_vec())
                    .await?;
            }
            Ok(())
        })
        .await
        .map_err(|_| CertificateError::DnsCleanupFailed)?
    }
}
