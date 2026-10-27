use super::{Entry, Error, ProviderId, Store};
use crate::runtime::dns::{DnsProvider, DnsProviderConfig};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::runtime) struct SetupSnapshot {
    pub(in crate::runtime) provider: ProviderId,
    pub(in crate::runtime) revision: u32,
    pub(in crate::runtime) zone_name: String,
}

fn snapshot(entry: &Entry, zone: &str, revision: u32) -> Result<SetupSnapshot, Error> {
    if entry.metadata.revision != revision {
        return Err(Error::ConnectionConflict);
    }
    let selected = entry
        .metadata
        .zones
        .iter()
        .find(|selected| selected.id == zone)
        .ok_or(Error::ZoneNotPermitted)?;
    if !entry.metadata.verified_for(zone) {
        return Err(Error::ProviderUnauthorized);
    }
    Ok(SetupSnapshot {
        provider: super::resolve_provider(None, Some(entry))?,
        revision,
        zone_name: selected.name.clone(),
    })
}

impl Store {
    pub(in crate::runtime) async fn setup_snapshot(
        &self,
        id: &str,
        zone: &str,
        revision: u32,
    ) -> Result<SetupSnapshot, Error> {
        super::validation::id(id)?;
        let mut state = self.lock().await?;
        let entry = Self::registry(&mut state)?
            .connections
            .iter()
            .find(|entry| entry.metadata.id == id)
            .ok_or(Error::ConnectionNotFound)?;
        snapshot(entry, zone, revision)
    }
    pub(in crate::runtime) async fn setup_provider(
        &self,
        id: &str,
        zone: &str,
        revision: u32,
    ) -> Result<DnsProvider, Error> {
        super::validation::id(id)?;
        let mut state = self.lock().await?;
        let entry = Self::registry(&mut state)?
            .connections
            .iter()
            .find(|entry| entry.metadata.id == id)
            .ok_or(Error::ConnectionNotFound)?;
        let snapshot = snapshot(entry, zone, revision)?;
        let api_token = self.decrypt(entry)?;
        let config = match snapshot.provider {
            ProviderId::Cloudflare => DnsProviderConfig::Cloudflare {
                zone_id: zone.to_owned(),
                api_token,
            },
            ProviderId::Desec => DnsProviderConfig::Desec {
                zone_id: zone.to_owned(),
                api_token,
            },
            ProviderId::Hetzner => DnsProviderConfig::Hetzner {
                zone_id: zone.to_owned(),
                api_token,
            },
        };
        DnsProvider::for_connection_check(config, &self.provider_endpoint(snapshot.provider)?)
            .map_err(|_| Error::ProviderUnavailable)
    }
}
