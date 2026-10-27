use super::{
    ProxyRuntime,
    certificates::CertificateError,
    dns::DnsProviderConfig,
    dns_connections::{self, Consumer, ConsumerType, Reference},
};

fn reference(id: &str, config: &DnsProviderConfig) -> Option<Reference> {
    config
        .connection()
        .map(|(_, connection_id, zone_id)| Reference {
            connection_id: connection_id.to_owned(),
            zone_id: zone_id.to_owned(),
            consumer: Consumer {
                r#type: ConsumerType::Dns01,
                id: id.to_owned(),
            },
        })
}

pub(super) fn certificate_error(error: dns_connections::Error) -> CertificateError {
    match error {
        dns_connections::Error::ProviderUnauthorized => CertificateError::DnsProviderUnauthorized,
        dns_connections::Error::ZoneNotPermitted | dns_connections::Error::InvalidInput => {
            CertificateError::DnsProviderInvalid
        }
        _ => CertificateError::DnsCredentialsUnavailable,
    }
}

impl ProxyRuntime {
    // Callers hold Store::bindings across reference reservation and certificate
    // persistence. A reconciliation cannot prune another request's reservation.
    pub(crate) async fn reconcile_provider_connections(
        &self,
    ) -> Result<(), dns_connections::Error> {
        let configurations = self
            .certificate_store
            .dns_configurations()
            .await
            .map_err(connection_error)?;
        for (id, config, idle) in configurations {
            if idle
                && config.connection().is_none()
                && let Some(connection) = self.dns_connections.matching_connection(&config).await?
                && let Some(usage) = reference(&id, &connection)
            {
                match self
                    .dns_connections
                    .certificate_references(&[usage], true, true)
                    .await
                {
                    Ok(()) => {}
                    Err(dns_connections::Error::StoreUnavailable) => {
                        return Err(dns_connections::Error::StoreUnavailable);
                    }
                    Err(_) => continue,
                }
                match self
                    .certificate_store
                    .adopt_dns_connection(&id, &config, &connection)
                    .await
                {
                    Ok(())
                    | Err(CertificateError::OperationInProgress | CertificateError::NotFound) => {}
                    Err(_) => return Err(dns_connections::Error::StoreUnavailable),
                }
            }
        }
        let references = self
            .certificate_store
            .dns_configurations()
            .await
            .map_err(connection_error)?
            .iter()
            .filter_map(|(id, config, _)| reference(id, config))
            .collect::<Vec<_>>();
        self.dns_connections
            .certificate_references(&references, false, false)
            .await
    }

    pub(super) async fn reserve_certificate_connection(
        &self,
        id: &str,
        request: &super::certificates::CertificateIssueRequest,
    ) -> Result<(), CertificateError> {
        let Some(config) = &request.dns_provider else {
            return Ok(());
        };
        let Some(usage) = reference(id, config) else {
            return Ok(());
        };
        let validated = self
            .dns_connections
            .validate_reference(usage.clone())
            .await
            .map_err(certificate_error)?;
        if request.dns_mode != super::certificates::DnsValidationMode::Delegated
            && request.domains.iter().any(|domain| {
                let domain = domain.strip_prefix("*.").unwrap_or(domain);
                domain != validated.zone.name
                    && !domain
                        .strip_suffix(&validated.zone.name)
                        .is_some_and(|prefix| prefix.ends_with('.'))
            })
        {
            return Err(CertificateError::DnsProviderInvalid);
        }
        let resolved = self
            .dns_connections
            .resolve_config(config)
            .await
            .map_err(certificate_error)?;
        if resolved.provider_id() != config.provider_id() {
            return Err(CertificateError::DnsProviderInvalid);
        }
        self.dns_connections
            .certificate_references(&[usage], true, true)
            .await
            .map_err(certificate_error)
    }
}

fn connection_error(error: CertificateError) -> dns_connections::Error {
    match error {
        CertificateError::DnsCredentialsUnavailable => {
            dns_connections::Error::CredentialsUnavailable
        }
        _ => dns_connections::Error::StoreUnavailable,
    }
}
