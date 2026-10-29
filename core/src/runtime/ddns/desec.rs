use super::{
    http,
    models::{Error, Failure, Target},
    provider::{Provider, Record},
};
use aws_lc_rs::digest::{Context, SHA256};
use reqwest::{Method, Url};
use serde::Deserialize;
use std::{collections::BTreeSet, net::IpAddr};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Deserialize)]
struct Domain {
    name: String,
    minimum_ttl: u32,
}
#[derive(Deserialize)]
struct Rrset {
    domain: String,
    subname: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    created: String,
    ttl: u32,
    records: Vec<String>,
}

fn subname(target: &Target) -> Result<&str, Failure> {
    if target.name == target.zone_id {
        return Ok("");
    }
    target
        .name
        .strip_suffix(&target.zone_id)
        .and_then(|prefix| prefix.strip_suffix('.'))
        .filter(|prefix| !prefix.is_empty() && prefix.len() <= 178)
        .ok_or_else(|| Error::InvalidInput.into())
}
fn url(provider: &Provider<'_>, target: &Target, suffix: &str) -> Result<Url, Failure> {
    provider
        .base
        .join(&format!("domains/{}/{suffix}", target.zone_id))
        .map_err(|_| Error::ProviderUnavailable.into())
}
async fn request<T: serde::de::DeserializeOwned>(
    provider: &Provider<'_>,
    method: Method,
    url: Url,
    body: Option<serde_json::Value>,
) -> Result<T, Failure> {
    let mut request = provider.client.request(method, url).header(
        reqwest::header::AUTHORIZATION,
        format!("Token {}", provider.token),
    );
    if let Some(body) = body {
        request = request.json(&body);
    }
    let bytes = http::send_unpaginated(request, provider.deadline).await?;
    serde_json::from_slice(&bytes).map_err(|_| Error::InvalidProviderResponse.into())
}
fn convert(rrset: Rrset, target: &Target) -> Result<Vec<Record>, Failure> {
    if rrset.domain != target.zone_id
        || rrset.subname != subname(target)?
        || rrset.name != format!("{}.", target.name)
        || rrset.kind.is_empty()
        || rrset.kind.len() > 16
        || !rrset
            .kind
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        || !(1..=86400).contains(&rrset.ttl)
        || rrset.records.is_empty()
        || rrset.records.len() > 4091
        || rrset.created.len() > 40
        || OffsetDateTime::parse(&rrset.created, &Rfc3339).is_err()
    {
        return Err(Error::InvalidProviderResponse.into());
    }
    // The immutable creation timestamp distinguishes delete/recreate at the same
    // owner and type. It carries no ownership claim for pre-existing RRsets.
    let mut hash = Context::new(&SHA256);
    for value in [&rrset.domain, &rrset.subname, &rrset.kind, &rrset.created] {
        hash.update(value.as_bytes());
        hash.update(&[0]);
    }
    let id: String = hash.finish().as_ref()[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    rrset
        .records
        .into_iter()
        .map(|content| {
            let content = if matches!(rrset.kind.as_str(), "A" | "AAAA") {
                let address: IpAddr = content
                    .parse()
                    .map_err(|_| Error::InvalidProviderResponse)?;
                if (rrset.kind == "A") != address.is_ipv4() {
                    return Err(Error::InvalidProviderResponse.into());
                }
                address.to_string()
            } else {
                content
            };
            Ok(Record {
                id: id.clone(),
                name: target.name.clone(),
                kind: rrset.kind.clone(),
                content,
                proxied: Some(false),
                comment: None,
                ttl: Some(rrset.ttl),
            })
        })
        .collect()
}
pub(super) async fn records(
    provider: &Provider<'_>,
    target: &Target,
) -> Result<Vec<Record>, Failure> {
    let mut endpoint = url(provider, target, "rrsets/")?;
    endpoint
        .query_pairs_mut()
        .append_pair("subname", subname(target)?)
        .append_pair("cursor", "");
    let rrsets: Vec<Rrset> = request(provider, Method::GET, endpoint, None).await?;
    // Exact-owner results should fit one page. Reject oversized/partial results
    // rather than ever select an address from an incomplete owner snapshot.
    if rrsets.len() > 500 {
        return Err(Error::InvalidProviderResponse.into());
    }
    let mut kinds = BTreeSet::new();
    let mut records = Vec::new();
    for rrset in rrsets {
        if !kinds.insert(rrset.kind.clone()) {
            return Err(Error::InvalidProviderResponse.into());
        }
        records.extend(convert(rrset, target)?);
    }
    Ok(records)
}
pub(super) async fn write(
    provider: &Provider<'_>,
    target: &Target,
    address: IpAddr,
    existing: Option<&Record>,
) -> Result<Record, Failure> {
    if existing.is_some() {
        return Err(Error::UpdatePreconditionUnsupported.into());
    }
    let subname = subname(target)?;
    let domain: Domain = request(provider, Method::GET, url(provider, target, "")?, None).await?;
    if domain.name != target.zone_id || !(1..=86400).contains(&domain.minimum_ttl) {
        return Err(Error::InvalidProviderResponse.into());
    }
    let body = serde_json::json!({"subname":subname,"type":target.record_type.as_str(),"ttl":domain.minimum_ttl,"records":[address.to_string()]});
    let acknowledgement: Result<Rrset, Failure> = request(
        provider,
        Method::POST,
        url(provider, target, "rrsets/")?,
        Some(body),
    )
    .await;
    let written = acknowledgement.and_then(|rrset| {
        let mut records = convert(rrset, target)?;
        if records.len() != 1 {
            return Err(Error::WriteUnconfirmed.into());
        }
        let written = records.remove(0);
        if written.kind != target.record_type.as_str()
            || written.address(target.record_type).ok() != Some(address)
            || written.ttl != Some(domain.minimum_ttl)
        {
            return Err(Error::WriteUnconfirmed.into());
        }
        Ok(written)
    });
    written.map_err(|failure| {
        if matches!(
            failure.code,
            Error::ProviderUnauthorized | Error::ProviderRateLimited | Error::TimeBudgetExceeded
        ) {
            failure
        } else {
            Failure {
                code: Error::WriteUnconfirmed,
                ..failure
            }
        }
    })
}

#[cfg(test)]
#[path = "../../../tests/private/ddns/desec.rs"]
mod tests;
