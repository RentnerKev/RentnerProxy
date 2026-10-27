use super::{
    api::{CloudflareResponse, map_provider_error},
    capabilities::ProviderId,
    is_canonical_dns_name,
    provider::DnsProvider,
};
use crate::runtime::certificates::CertificateError;
use reqwest::Method;
use serde::Deserialize;
use std::collections::BTreeSet;

#[derive(Deserialize)]
struct CloudflareZone {
    id: String,
    name: String,
    #[serde(default)]
    name_servers: Vec<String>,
}
#[derive(Deserialize)]
struct DesecNs {
    domain: String,
    name: String,
    subname: String,
    #[serde(rename = "type")]
    kind: String,
    records: Vec<String>,
}
#[derive(Deserialize)]
struct HetznerResult {
    zone: HetznerZone,
}
#[derive(Deserialize)]
struct HetznerZone {
    id: u64,
    name: String,
    mode: String,
    authoritative_nameservers: AssignedNs,
}
#[derive(Deserialize)]
struct AssignedNs {
    assigned: Vec<String>,
}

impl DnsProvider {
    /// Provider metadata GETs only; never permission probes, DNS writes or SOA guesses.
    pub(in crate::runtime) async fn setup_nameservers(
        &self,
        expected_zone: &str,
    ) -> Result<Vec<String>, CertificateError> {
        let (path, provider) = match self.config.provider_id() {
            ProviderId::Cloudflare => (
                format!("zones/{}", self.config.zone_id()),
                ProviderId::Cloudflare,
            ),
            ProviderId::Desec => (
                format!("domains/{}/rrsets/@/NS/", self.config.zone_id()),
                ProviderId::Desec,
            ),
            ProviderId::Hetzner => (
                format!("zones/{}", self.config.zone_id()),
                ProviderId::Hetzner,
            ),
        };
        let url = self.api_path(&path)?;
        let (status, body) = self
            .send(Method::GET, url, None)
            .await
            .map_err(map_provider_error)?;
        if !status.is_success() {
            return Err(CertificateError::DnsProviderUnavailable);
        }
        let names = match provider {
            ProviderId::Cloudflare => {
                let result: CloudflareResponse<CloudflareZone> = serde_json::from_slice(&body)
                    .map_err(|_| CertificateError::DnsProviderUnavailable)?;
                if !result.success {
                    return Err(CertificateError::DnsProviderUnavailable);
                }
                let zone = result
                    .result
                    .ok_or(CertificateError::DnsProviderUnavailable)?;
                if zone.id != self.config.zone_id() || zone.name != expected_zone {
                    return Err(CertificateError::DnsProviderInvalid);
                }
                zone.name_servers
            }
            ProviderId::Desec => {
                let ns: DesecNs = serde_json::from_slice(&body)
                    .map_err(|_| CertificateError::DnsProviderUnavailable)?;
                if ns.domain != expected_zone
                    || ns.name != format!("{expected_zone}.")
                    || !ns.subname.is_empty()
                    || ns.kind != "NS"
                    || ns.records.iter().any(|record| !record.ends_with('.'))
                {
                    return Err(CertificateError::DnsProviderInvalid);
                }
                ns.records
            }
            ProviderId::Hetzner => {
                let result: HetznerResult = serde_json::from_slice(&body)
                    .map_err(|_| CertificateError::DnsProviderUnavailable)?;
                if result.zone.id.to_string() != self.config.zone_id()
                    || result.zone.name != expected_zone
                    || result.zone.mode != "primary"
                {
                    return Err(CertificateError::DnsProviderInvalid);
                }
                result.zone.authoritative_nameservers.assigned
            }
        };
        normalized_nameservers(names)
    }
}
fn normalized_nameservers(values: Vec<String>) -> Result<Vec<String>, CertificateError> {
    if values.is_empty() || values.len() > 16 {
        return Err(CertificateError::DnsProviderUnavailable);
    }
    let mut names = BTreeSet::new();
    for value in values {
        let value = value
            .strip_suffix('.')
            .unwrap_or(&value)
            .to_ascii_lowercase();
        if !is_canonical_dns_name(&value)
            || value.contains('_')
            || !value.contains('.')
            || !names.insert(value)
        {
            return Err(CertificateError::DnsProviderUnavailable);
        }
    }
    Ok(names.into_iter().collect())
}
