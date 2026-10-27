use super::{Error, Registry, Store};
use tokio::sync::MutexGuard;

// The registry guard fences credential rotation, zone removal and deletion for
// the complete read/modify/verify sequence of one selected DNS record.
pub(in crate::runtime) struct RecordAccess<'a> {
    _state: MutexGuard<'a, Option<Registry>>,
    pub(in crate::runtime) zone_name: String,
    pub(in crate::runtime) provider: crate::runtime::dns::capabilities::ProviderId,
    pub(in crate::runtime) token: String,
    pub(in crate::runtime) endpoint: &'a str,
}

impl Store {
    pub(in crate::runtime) async fn resolve_config(
        &self,
        config: &crate::runtime::dns::DnsProviderConfig,
    ) -> Result<crate::runtime::dns::DnsProviderConfig, Error> {
        let Some((provider, connection_id, zone_id)) = config.connection() else {
            return Ok(config.clone());
        };
        let access = self.record_access(connection_id, zone_id).await?;
        if access.provider != provider {
            return Err(Error::InvalidInput);
        }
        match provider {
            super::ProviderId::Hetzner => Ok(crate::runtime::dns::DnsProviderConfig::Hetzner {
                zone_id: zone_id.to_owned(),
                api_token: access.token.clone(),
            }),
            super::ProviderId::Desec => Ok(crate::runtime::dns::DnsProviderConfig::Desec {
                zone_id: zone_id.to_owned(),
                api_token: access.token.clone(),
            }),
            super::ProviderId::Cloudflare => {
                Ok(crate::runtime::dns::DnsProviderConfig::Cloudflare {
                    zone_id: zone_id.to_owned(),
                    api_token: access.token.clone(),
                })
            }
        }
    }

    pub(in crate::runtime) async fn matching_connection(
        &self,
        config: &crate::runtime::dns::DnsProviderConfig,
    ) -> Result<Option<crate::runtime::dns::DnsProviderConfig>, Error> {
        let Some((zone_id, token)) = config.credential() else {
            return Ok(None);
        };
        let mut state = self.lock().await?;
        for entry in &Self::registry(&mut state)?.connections {
            // Adoption is optional; an unreadable candidate must remain repairable
            // without blocking unrelated accounts. Explicit use still fails closed.
            if super::resolve_provider(None, Some(entry))? == config.provider_id()
                && entry.metadata.verified_for(zone_id)
                && self.decrypt(entry).is_ok_and(|stored| stored == token)
            {
                return Ok(Some(crate::runtime::dns::DnsProviderConfig::Connection {
                    provider: config.provider_id(),
                    connection_id: entry.metadata.id.clone(),
                    zone_id: zone_id.to_owned(),
                }));
            }
        }
        Ok(None)
    }

    pub(in crate::runtime) async fn record_access(
        &self,
        connection: &str,
        zone: &str,
    ) -> Result<RecordAccess<'_>, Error> {
        let mut state = self.lock().await?;
        let entry = Self::registry(&mut state)?
            .connections
            .iter()
            .find(|entry| entry.metadata.id == connection)
            .ok_or(Error::ConnectionNotFound)?;
        let zone_name = entry
            .metadata
            .zones
            .iter()
            .find(|entry| entry.id == zone)
            .ok_or(Error::ZoneNotPermitted)?
            .name
            .clone();
        let provider = super::resolve_provider(None, Some(entry))?;
        let token = self.decrypt(entry)?;
        Ok(RecordAccess {
            _state: state,
            zone_name,
            provider,
            token,
            endpoint: self.provider_endpoint(provider),
        })
    }

    #[cfg(test)]
    pub(in crate::runtime) fn fixture(path: std::path::PathBuf, endpoint: String) -> Self {
        let mut store = Self::new(path);
        store.key = Some([7; 32]);
        store.endpoint = Some(endpoint);
        store
    }
}
