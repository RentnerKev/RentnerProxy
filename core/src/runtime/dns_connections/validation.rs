use super::{
    Error, Reference,
    models::{Metadata, Zone},
};
use crate::proxy::{is_canonical_domain, is_canonical_uuid_v7};
use std::{collections::BTreeSet, time::Duration};

pub(super) fn id(value: &str) -> Result<(), Error> {
    is_canonical_uuid_v7(value)
        .then_some(())
        .ok_or(Error::InvalidInput)
}
pub(super) fn zone_id(value: &str) -> bool {
    crate::runtime::dns::capabilities::ProviderId::Cloudflare.valid_zone_id(value)
}
pub(super) fn token(value: &str) -> Result<(), Error> {
    (!value.is_empty() && value.len() <= 512 && value.bytes().all(|b| (0x21..=0x7e).contains(&b)))
        .then_some(())
        .ok_or(Error::InvalidInput)
}
pub(super) fn name(value: &str) -> Result<(), Error> {
    (!value.trim().is_empty()
        && value == value.trim()
        && value.encode_utf16().count() <= 100
        && !value.chars().any(is_control_or_format))
    .then_some(())
    .ok_or(Error::InvalidInput)
}

// Unicode General_Category=Cf complements Rust's Cc is_control check.
fn is_control_or_format(c: char) -> bool {
    c.is_control()
        || matches!(c,
        '\u{ad}' | '\u{600}'..='\u{605}' | '\u{61c}' | '\u{6dd}' | '\u{70f}' |
        '\u{890}'..='\u{891}' | '\u{8e2}' | '\u{180e}' | '\u{200b}'..='\u{200f}' |
        '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206f}' |
        '\u{feff}' | '\u{fff9}'..='\u{fffb}' | '\u{110bd}' | '\u{110cd}' |
        '\u{13430}'..='\u{1343f}' | '\u{1bca0}'..='\u{1bca3}' |
        '\u{1d173}'..='\u{1d17a}' | '\u{e0001}' | '\u{e0020}'..='\u{e007f}')
}

pub(super) fn selection(ids: &[String], nonempty: bool) -> Result<(), Error> {
    if ids.len() > 50 {
        return Err(Error::ZoneLimit);
    }
    if (nonempty && ids.is_empty())
        || ids.iter().any(|v| !zone_id(v))
        || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
    {
        return Err(Error::InvalidInput);
    }
    Ok(())
}
pub(super) fn reference(value: &Reference) -> Result<(), Error> {
    id(&value.connection_id)?;
    id(&value.consumer.id)?;
    zone_id(&value.zone_id)
        .then_some(())
        .ok_or(Error::InvalidInput)
}
pub(super) fn metadata(m: &Metadata) -> Result<(), Error> {
    id(&m.id)?;
    id(&m.created_by_user_id)?;
    name(&m.name)?;
    if crate::runtime::dns::capabilities::ProviderId::parse(&m.provider).is_none()
        || m.ownership != "instance"
        || m.revision == 0
        || timestamp(&m.updated_at)? < timestamp(&m.created_at)?
    {
        return Err(Error::InvalidInput);
    }
    selection(
        &m.zones.iter().map(|z| z.id.clone()).collect::<Vec<_>>(),
        true,
    )?;
    if m.verification.zone_ids.len() > 50
        || m.verification
            .zone_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != m.verification.zone_ids.len()
        || m.verification
            .zone_ids
            .iter()
            .any(|id| !m.zones.iter().any(|zone| &zone.id == id))
        || (m.verification.status == super::models::ConnectionStatus::Connected
            && (m.verification.checked_at.is_none()
                || m.verification.error.is_some()
                || m.verification.zone_ids.len() != m.zones.len()))
        || (m.verification.status != super::models::ConnectionStatus::Connected
            && !m.verification.zone_ids.is_empty())
    {
        return Err(Error::InvalidInput);
    }
    if let Some(checked_at) = &m.verification.checked_at {
        timestamp(checked_at)?;
    }
    if m.zones.iter().any(|z| !is_canonical_domain(&z.name)) || m.references.len() > 10000 {
        return Err(Error::InvalidInput);
    }
    let mut refs = BTreeSet::new();
    for r in &m.references {
        id(&r.consumer.id)?;
        if !m.zones.iter().any(|z| z.id == r.zone_id)
            || !refs.insert((r.zone_id.clone(), r.consumer.clone()))
        {
            return Err(Error::InvalidInput);
        }
    }
    Ok(())
}

pub(super) async fn permitted(
    provider: crate::runtime::dns::capabilities::ProviderId,
    endpoint: &str,
    token: &str,
) -> Result<Vec<Zone>, Error> {
    if !provider.supports(crate::runtime::dns::capabilities::Operation::ZoneDiscovery) {
        return Err(Error::InvalidInput);
    }
    match provider {
        crate::runtime::dns::capabilities::ProviderId::Cloudflare => {
            permitted_cloudflare(endpoint, token).await
        }
    }
}

async fn permitted_cloudflare(endpoint: &str, token: &str) -> Result<Vec<Zone>, Error> {
    tokio::time::timeout(Duration::from_secs(20), list(endpoint, token))
        .await
        .map_err(|_| Error::ProviderUnavailable)?
}
async fn list(endpoint: &str, token: &str) -> Result<Vec<Zone>, Error> {
    super::super::tls::ensure_crypto_provider();
    let builder = reqwest::Client::builder();
    #[cfg(test)]
    let builder = builder.no_proxy();
    let client = builder
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| Error::ProviderUnavailable)?;
    let mut zones = Vec::new();
    let mut seen = BTreeSet::new();
    for page in 1..=25_u32 {
        let mut url = reqwest::Url::parse(endpoint)
            .and_then(|u| u.join("zones"))
            .map_err(|_| Error::ProviderUnavailable)?;
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("per_page", "20");
        let mut response = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| Error::ProviderUnavailable)?;
        match response.status().as_u16() {
            401 | 403 => return Err(Error::ProviderUnauthorized),
            429 => return Err(Error::ProviderRateLimited),
            _ => {}
        }
        if !response.status().is_success() {
            return Err(Error::ProviderUnavailable);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::ProviderUnavailable)?
        {
            if bytes.len() + chunk.len() > 65536 {
                return Err(Error::ProviderUnavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        let envelope: super::super::dns::api::CloudflareResponse<
            Vec<super::super::dns::api::CloudflareZone>,
        > = serde_json::from_slice(&bytes).map_err(|_| Error::ProviderUnavailable)?;
        if !envelope.success {
            return Err(if envelope.errors.iter().any(|e| e.is_unauthorized()) {
                Error::ProviderUnauthorized
            } else {
                Error::ProviderUnavailable
            });
        }
        let entries = envelope.result.ok_or(Error::ProviderUnavailable)?;
        if entries.len() > 20 {
            return Err(Error::ProviderUnavailable);
        }
        let info = envelope.result_info.ok_or(Error::ProviderUnavailable)?;
        if info.page != Some(page) || info.per_page != Some(20) {
            return Err(Error::ProviderUnavailable);
        }
        let total = info.total_pages.ok_or(Error::ProviderUnavailable)?;
        if total > 25 {
            return Err(Error::ZoneLimit);
        }
        for zone in entries {
            if !zone_id(&zone.id)
                || !is_canonical_domain(&zone.name)
                || !seen.insert(zone.id.clone())
            {
                return Err(Error::ProviderUnavailable);
            }
            zones.push(Zone {
                id: zone.id,
                name: zone.name,
            });
        }
        if zones.len() > 500 {
            return Err(Error::ZoneLimit);
        }
        if page >= total {
            return Ok(zones);
        }
    }
    Err(Error::ZoneLimit)
}

pub(super) fn timestamp(value: &str) -> Result<time::OffsetDateTime, Error> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map_err(|_| Error::InvalidInput)
}
