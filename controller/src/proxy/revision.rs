use crate::models::{ProxyHost, ProxyHttpSettings, RedirectHost, TrustedCa};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Hashes the single, stable snapshot shape used by the controller protocol.
/// Struct declaration order is intentional: it is the canonical JSON order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    redirect_hosts: Vec<RedirectHost>,
    http_settings: &'a ProxyHttpSettings,
    trusted_cas: Vec<TrustedCa>,
}

#[cfg(test)]
pub(crate) fn revision_for_hosts(hosts: &[ProxyHost]) -> String {
    revision_for_configuration_with_redirects(hosts, &[], &ProxyHttpSettings::default(), &[])
}

#[cfg(test)]
pub(crate) fn revision_for_configuration(
    hosts: &[ProxyHost],
    http_settings: &ProxyHttpSettings,
) -> String {
    revision_for_configuration_with_redirects(hosts, &[], http_settings, &[])
}

#[cfg(test)]
pub(crate) fn revision_for_configuration_with_trusted_cas(
    hosts: &[ProxyHost],
    http_settings: &ProxyHttpSettings,
    trusted_cas: &[TrustedCa],
) -> String {
    revision_for_configuration_with_redirects(hosts, &[], http_settings, trusted_cas)
}

pub(crate) fn revision_for_configuration_with_redirects(
    hosts: &[ProxyHost],
    redirect_hosts: &[RedirectHost],
    http_settings: &ProxyHttpSettings,
    trusted_cas: &[TrustedCa],
) -> String {
    hash_snapshot(&CanonicalSnapshot {
        version: 7,
        proxy_hosts: canonical_hosts(hosts),
        redirect_hosts: canonical_redirect_hosts(redirect_hosts),
        http_settings,
        trusted_cas: canonical_trusted_cas(trusted_cas),
    })
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hash_snapshot(snapshot: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(snapshot)
        .expect("canonical proxy snapshot only contains serializable strings and numbers");
    let digest = Sha256::digest(bytes);
    format!("sha256:{}", hex_digest(digest.as_ref()))
}

/// Extracts the revision from the typed Caddy probe route emitted by the
/// renderer. The probe is deliberately a static response, so this also works
/// with a persisted Admin API config without relying on comments.
pub(crate) fn revision_from_config(contents: &str) -> Option<String> {
    let config = serde_json::from_str::<ProbeConfig>(contents).ok()?;
    config
        .apps?
        .http?
        .servers
        .values()
        .find_map(|server| find_revision(&server.routes))
}

fn find_revision(routes: &[ProbeRoute]) -> Option<String> {
    for route in routes {
        for handler in &route.handle {
            if handler.handler == "static_response"
                && handler.status_code == Some(200)
                && handler
                    .body
                    .as_deref()
                    .is_some_and(|body| body.strip_suffix('\n').is_some_and(is_revision))
            {
                return handler
                    .body
                    .as_deref()
                    .and_then(|body| body.strip_suffix('\n'))
                    .map(ToOwned::to_owned);
            }
        }
        if let Some(revision) = find_revision(&route.routes) {
            return Some(revision);
        }
    }
    None
}

pub(super) fn canonical_hosts(hosts: &[ProxyHost]) -> Vec<ProxyHost> {
    let mut hosts = hosts.to_vec();
    for host in &mut hosts {
        host.domains.sort_unstable();
    }
    hosts.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hosts
}

pub(super) fn canonical_redirect_hosts(hosts: &[RedirectHost]) -> Vec<RedirectHost> {
    let mut hosts = hosts.to_vec();
    for host in &mut hosts {
        host.domains.sort_unstable();
    }
    hosts.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hosts
}

pub(super) fn canonical_trusted_cas(trusted_cas: &[TrustedCa]) -> Vec<TrustedCa> {
    let mut trusted_cas = trusted_cas.to_vec();
    trusted_cas.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    trusted_cas
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeConfig {
    apps: Option<ProbeApps>,
}

#[derive(Deserialize)]
struct ProbeApps {
    http: Option<ProbeHttp>,
}

#[derive(Deserialize)]
struct ProbeHttp {
    #[serde(default)]
    servers: BTreeMap<String, ProbeServer>,
}

#[derive(Deserialize)]
struct ProbeServer {
    #[serde(default)]
    routes: Vec<ProbeRoute>,
}

#[derive(Deserialize)]
struct ProbeRoute {
    #[serde(default)]
    handle: Vec<ProbeHandler>,
    #[serde(default)]
    routes: Vec<ProbeRoute>,
}

#[derive(Deserialize)]
struct ProbeHandler {
    handler: String,
    body: Option<String>,
    status_code: Option<u16>,
}

pub(super) fn is_revision(value: &str) -> bool {
    let Some(hash) = value.strip_prefix("sha256:") else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}
