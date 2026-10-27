use crate::{
    runtime::{
        CertificateOperationStage, ProxyRuntime,
        certificates::{
            AcmeChallengeType, CertificateError, CertificateIssueRequest, DnsValidationMode,
        },
        dns::{DnsDelegationBinding, DnsProvider, DnsRecordIntent},
    },
    server::challenges::ChallengeStore,
};
use instant_acme::{
    AuthorizationStatus, ChallengeType, Identifier, NewOrder, OrderStatus, RetryPolicy,
};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::time::timeout;
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(20);
const DNS_PROPAGATION_WAIT: Duration = Duration::from_secs(30);

struct ChallengeRegistrations<'a> {
    http: &'a mut Vec<(String, String)>,
    dns: &'a mut Vec<DnsRecordIntent>,
    delegated: BTreeMap<String, DnsDelegationBinding>,
}

impl ProxyRuntime {
    pub(super) async fn issue_acme(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        challenges: &ChallengeStore,
        registered: &mut Vec<(String, String)>,
        dns_provider: Option<&DnsProvider>,
        dns_intents: &mut Vec<DnsRecordIntent>,
    ) -> Result<(String, String), CertificateError> {
        self.certificate_store
            .record_operation_stage(id, CertificateOperationStage::CreatingOrder)
            .await?;
        let delegated = if let Some(provider) = dns_provider {
            if request.dns_mode == DnsValidationMode::Delegated {
                super::delegated::bindings(request, provider).await?
            } else {
                provider.validate_sans(&request.domains).await?;
                BTreeMap::new()
            }
        } else {
            BTreeMap::new()
        };
        let account = timeout(ACCOUNT_TIMEOUT, self.acme_account(id, request))
            .await
            .map_err(|_| CertificateError::AcmeFailed)??;
        self.issue_acme_with_account(
            id,
            request,
            challenges,
            ChallengeRegistrations {
                http: registered,
                dns: dns_intents,
                delegated,
            },
            dns_provider,
            account,
        )
        .await
    }

    async fn issue_acme_with_account(
        &self,
        id: &str,
        request: &CertificateIssueRequest,
        challenges: &ChallengeStore,
        registrations: ChallengeRegistrations<'_>,
        dns_provider: Option<&DnsProvider>,
        account: instant_acme::Account,
    ) -> Result<(String, String), CertificateError> {
        let ChallengeRegistrations {
            http: registered,
            dns: dns_intents,
            delegated,
        } = registrations;
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

        self.certificate_store
            .record_operation_stage(id, CertificateOperationStage::PreparingChallenge)
            .await?;

        match request.challenge_type {
            AcmeChallengeType::Http01 => {
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    if authorization.wildcard {
                        return Err(CertificateError::AcmeDnsRequired);
                    }
                    match authorization.status {
                        AuthorizationStatus::Pending => {}
                        AuthorizationStatus::Valid => continue,
                        _ => return Err(CertificateError::AcmeFailed),
                    }
                    let mut challenge = authorization
                        .challenge(ChallengeType::Http01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    let (domain, _) =
                        requested_identifier(challenge.identifier(), &request.domains)?;
                    if challenge.identifier().wildcard {
                        return Err(CertificateError::AcmeFailed);
                    }
                    let token = challenge.token.clone();
                    let value = challenge.key_authorization().as_str().to_owned();
                    challenges
                        .insert(domain.clone(), token.clone(), value)
                        .await?;
                    registered.push((domain, token));
                    challenge
                        .set_ready()
                        .await
                        .map_err(|_| CertificateError::AcmeFailed)?;
                }
            }
            AcmeChallengeType::Dns01 => {
                let provider = dns_provider.ok_or(CertificateError::AcmeDnsRequired)?;
                let current_proofs_start = dns_intents.len();
                let mut presented = false;
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    match authorization.status {
                        AuthorizationStatus::Pending => {}
                        AuthorizationStatus::Valid => continue,
                        _ => return Err(CertificateError::AcmeFailed),
                    }
                    let challenge = authorization
                        .challenge(ChallengeType::Dns01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    let (_, bare_domain) =
                        requested_identifier(challenge.identifier(), &request.domains)?;
                    let value = challenge.key_authorization().dns_value();
                    let mut intent = DnsRecordIntent::new(id, &bare_domain, &value)?;
                    if request.dns_mode == DnsValidationMode::Delegated {
                        let binding = delegated
                            .get(&bare_domain)
                            .ok_or(CertificateError::DnsDelegationInvalid)?;
                        super::delegated::recheck(binding, request.environment).await?;
                        intent = intent.with_delegation(binding.clone())?;
                    }
                    if request.dns_mode == DnsValidationMode::Delegated {
                        super::delegated::present(
                            &self.certificate_store,
                            id,
                            provider,
                            dns_intents,
                            intent,
                        )
                        .await?;
                    } else {
                        dns_intents.push(intent.clone());
                        self.certificate_store
                            .set_pending_dns_records(id, dns_intents.clone())
                            .await?;
                        provider.present(&intent).await?;
                    }
                    presented = true;
                }
                if presented {
                    if request.dns_mode == DnsValidationMode::Delegated {
                        super::delegated::wait_for_records(
                            &dns_intents[current_proofs_start..],
                            request.environment,
                            &self.certificate_store,
                            id,
                        )
                        .await?;
                    } else {
                        tokio::time::sleep(DNS_PROPAGATION_WAIT).await;
                    }
                }
                let mut authorizations = order.authorizations();
                while let Some(result) = authorizations.next().await {
                    let mut authorization = result.map_err(|_| CertificateError::AcmeFailed)?;
                    requested_identifier(&authorization.identifier(), &request.domains)?;
                    if authorization.status == AuthorizationStatus::Valid {
                        continue;
                    }
                    if authorization.status != AuthorizationStatus::Pending {
                        return Err(CertificateError::AcmeFailed);
                    }
                    let mut challenge = authorization
                        .challenge(ChallengeType::Dns01)
                        .ok_or(CertificateError::AcmeFailed)?;
                    requested_identifier(challenge.identifier(), &request.domains)?;
                    if request.dns_mode == DnsValidationMode::Delegated {
                        super::delegated::check_cancelled(&self.certificate_store, id).await?;
                    }
                    challenge
                        .set_ready()
                        .await
                        .map_err(|_| CertificateError::AcmeFailed)?;
                }
            }
        }

        self.certificate_store
            .record_operation_stage(id, CertificateOperationStage::WaitingForValidation)
            .await?;
        let status = order
            .poll_ready(&RetryPolicy::default())
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        if status != OrderStatus::Ready {
            return Err(CertificateError::AcmeFailed);
        }
        self.certificate_store
            .record_operation_stage(id, CertificateOperationStage::Finalizing)
            .await?;
        let private_key_pem = order
            .finalize()
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        let certificate_pem = order
            .poll_certificate(&RetryPolicy::default())
            .await
            .map_err(|_| CertificateError::AcmeFailed)?;
        Ok((certificate_pem, private_key_pem))
    }
}

pub(super) fn requested_identifier(
    authorized: &instant_acme::AuthorizedIdentifier<'_>,
    requested: &[String],
) -> Result<(String, String), CertificateError> {
    let Identifier::Dns(name) = authorized.identifier else {
        return Err(CertificateError::AcmeFailed);
    };
    if !crate::proxy::is_canonical_domain(name) {
        return Err(CertificateError::AcmeFailed);
    }
    let full_name = authorized.to_string();
    if !requested.contains(&full_name) {
        return Err(CertificateError::AcmeFailed);
    }
    Ok((full_name, name.clone()))
}

#[cfg(test)]
#[path = "../../../tests/private/acme_orders.rs"]
mod dns_authorization_tests;
