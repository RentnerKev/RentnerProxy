use crate::{
    runtime::{
        CertificateOperationStage, ProxyRuntime,
        certificates::{AcmeChallengeType, CertificateError, CertificateIssueRequest},
        dns::{DnsProvider, DnsRecordIntent},
    },
    server::challenges::ChallengeStore,
};
use instant_acme::{
    AuthorizationStatus, ChallengeType, Identifier, NewOrder, OrderStatus, RetryPolicy,
};
use std::{sync::Arc, time::Duration};
use tokio::time::timeout;
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(20);
const DNS_PROPAGATION_WAIT: Duration = Duration::from_secs(30);

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
        if let Some(provider) = dns_provider {
            provider.validate_sans(&request.domains).await?;
        }
        let account = timeout(ACCOUNT_TIMEOUT, self.acme_account(id, request))
            .await
            .map_err(|_| CertificateError::AcmeFailed)??;
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
                    let intent = DnsRecordIntent::new(id, &bare_domain, &value)?;
                    dns_intents.push(intent.clone());
                    self.certificate_store
                        .set_pending_dns_records(id, dns_intents.clone())
                        .await?;
                    provider.present(&intent).await?;
                    presented = true;
                }
                if presented {
                    tokio::time::sleep(DNS_PROPAGATION_WAIT).await;
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

fn requested_identifier(
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
mod dns_authorization_tests {
    use super::*;

    #[test]
    fn wildcard_authorization_is_not_interchangeable_with_apex_or_child() {
        let apex = Identifier::Dns("example.com".to_owned());
        let child = Identifier::Dns("child.example.com".to_owned());
        let requested = vec!["*.example.com".to_owned()];
        assert_eq!(
            requested_identifier(&apex.authorized(true), &requested).unwrap(),
            ("*.example.com".to_owned(), "example.com".to_owned())
        );
        assert!(requested_identifier(&apex.authorized(false), &requested).is_err());
        assert!(requested_identifier(&child.authorized(false), &requested).is_err());
        assert!(requested_identifier(&child.authorized(true), &requested).is_err());
    }

    #[test]
    fn mixed_sans_keep_distinct_authorizations_with_one_txt_owner() {
        let identifier = Identifier::Dns("example.com".to_owned());
        let requested = vec!["*.example.com".to_owned(), "example.com".to_owned()];
        let apex = requested_identifier(&identifier.authorized(false), &requested).unwrap();
        let wildcard = requested_identifier(&identifier.authorized(true), &requested).unwrap();
        assert_ne!(apex.0, wildcard.0);
        assert_eq!(apex.1, wildcard.1);
        for name in [
            "other.com",
            "badexample.com",
            "example.com.other.com",
            "*.example.com",
        ] {
            assert!(
                requested_identifier(
                    &Identifier::Dns(name.to_owned()).authorized(false),
                    &requested
                )
                .is_err()
            );
        }
    }
}
