use super::{Error, ProviderId, models::Zone};
use crate::runtime::hetzner::{Api, ErrorKind};
use std::{collections::BTreeSet, time::Duration};

pub(super) async fn permitted(endpoint: &str, token: &str) -> Result<Vec<Zone>, Error> {
    super::super::tls::ensure_crypto_provider();
    let builder = reqwest::Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none());
    #[cfg(test)]
    let builder = builder.no_proxy();
    let client = builder.build().map_err(|_| Error::ProviderUnavailable)?;
    let base = reqwest::Url::parse(endpoint).map_err(|_| Error::ProviderUnavailable)?;
    let api = Api::new(
        &client,
        &base,
        token,
        tokio::time::Instant::now() + Duration::from_secs(20),
    );
    let mut zones = Vec::new();
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    for page in 1..=10 {
        let result = api
            .zones_page(page)
            .await
            .map_err(|error| match error.kind {
                ErrorKind::Unauthorized => Error::ProviderUnauthorized,
                ErrorKind::RateLimited => Error::ProviderRateLimited,
                _ => Error::ProviderUnavailable,
            })?;
        for zone in result.items {
            let id = zone.id.to_string();
            if !ProviderId::Hetzner.valid_zone_id(&id)
                || !ids.insert(id.clone())
                || !names.insert(zone.name.clone())
            {
                return Err(Error::ProviderUnavailable);
            }
            if zone.mode == "primary" {
                zones.push(Zone {
                    id,
                    name: zone.name,
                });
            }
        }
        if result.next_page.is_none() {
            zones.sort_by(|left, right| left.name.cmp(&right.name));
            return Ok(zones);
        }
    }
    Err(Error::ZoneLimit)
}

#[cfg(test)]
mod tests;
