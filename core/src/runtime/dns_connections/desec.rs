use super::{Error, ProviderId, models::Zone};
use serde::Deserialize;
use std::{collections::BTreeSet, time::Duration};

#[derive(Deserialize)]
struct Domain {
    name: String,
}

pub(super) async fn permitted(endpoint: &str, token: &str) -> Result<Vec<Zone>, Error> {
    tokio::time::timeout(Duration::from_secs(20), list(endpoint, token))
        .await
        .map_err(|_| Error::ProviderUnavailable)?
}

async fn list(endpoint: &str, token: &str) -> Result<Vec<Zone>, Error> {
    super::super::tls::ensure_crypto_provider();
    let builder = reqwest::Client::builder()
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15));
    #[cfg(test)]
    let builder = builder.no_proxy();
    let client = builder.build().map_err(|_| Error::ProviderUnavailable)?;
    let mut url = reqwest::Url::parse(endpoint)
        .and_then(|url| url.join("domains/"))
        .map_err(|_| Error::ProviderUnavailable)?;
    url.query_pairs_mut().append_pair("cursor", "");
    let mut response = client
        .get(url)
        .header(reqwest::header::AUTHORIZATION, format!("Token {token}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| Error::ProviderUnavailable)?;
    match response.status().as_u16() {
        401 | 403 => return Err(Error::ProviderUnauthorized),
        429 => return Err(Error::ProviderRateLimited),
        200 => {}
        _ => return Err(Error::ProviderUnavailable),
    }
    // The product exposes at most 500 zones. Never follow a provider-supplied
    // pagination URL with credentials or silently accept a partial catalogue.
    for header in response.headers().get_all(reqwest::header::LINK) {
        let value = header.to_str().map_err(|_| Error::ProviderUnavailable)?;
        if value.split(',').any(|link| {
            link.split(';').skip(1).any(|parameter| {
                parameter
                    .trim()
                    .split_once('=')
                    .is_some_and(|(key, value)| {
                        key.trim().eq_ignore_ascii_case("rel")
                            && value
                                .trim()
                                .trim_matches('"')
                                .split_ascii_whitespace()
                                .any(|relation| relation == "next")
                    })
            })
        }) {
            return Err(Error::ZoneLimit);
        }
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error::ProviderUnavailable)?
    {
        if bytes.len().saturating_add(chunk.len()) > 512 * 1024 {
            return Err(Error::ProviderUnavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    let domains: Vec<Domain> =
        serde_json::from_slice(&bytes).map_err(|_| Error::ProviderUnavailable)?;
    if domains.len() > 500 {
        return Err(Error::ZoneLimit);
    }
    let mut seen = BTreeSet::new();
    domains
        .into_iter()
        .map(|domain| {
            if !ProviderId::Desec.valid_zone_id(&domain.name) || !seen.insert(domain.name.clone()) {
                return Err(Error::ProviderUnavailable);
            }
            Ok(Zone {
                id: domain.name.clone(),
                name: domain.name,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
