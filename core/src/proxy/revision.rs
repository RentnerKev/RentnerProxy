use crate::models::{DefaultSite, ProxyHost, ProxyHttpSettings, RedirectHost, TrustedCa};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    redirect_hosts: Vec<RedirectHost>,
    http_settings: &'a ProxyHttpSettings,
    trusted_cas: Vec<TrustedCa>,
    #[serde(skip_serializing_if = "DefaultSite::is_default")]
    default_site: &'a DefaultSite,
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

#[cfg(test)]
pub(crate) fn revision_for_configuration_with_redirects(
    hosts: &[ProxyHost],
    redirect_hosts: &[RedirectHost],
    http_settings: &ProxyHttpSettings,
    trusted_cas: &[TrustedCa],
) -> String {
    revision_for_full_configuration(
        hosts,
        redirect_hosts,
        http_settings,
        trusted_cas,
        &DefaultSite::default(),
    )
}

pub(crate) fn revision_for_full_configuration(
    hosts: &[ProxyHost],
    redirect_hosts: &[RedirectHost],
    http_settings: &ProxyHttpSettings,
    trusted_cas: &[TrustedCa],
    default_site: &DefaultSite,
) -> String {
    hash_snapshot(&CanonicalSnapshot {
        version: 7,
        proxy_hosts: canonical_hosts(hosts),
        redirect_hosts: canonical_redirect_hosts(redirect_hosts),
        http_settings,
        trusted_cas: canonical_trusted_cas(trusted_cas),
        default_site,
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

pub(crate) fn revision_from_config(contents: &str) -> Option<String> {
    let config = serde_json::from_str::<ProbeConfig>(contents).ok()?;
    config
        .apps?
        .http?
        .servers
        .get("rentnerproxy-probe")
        .and_then(|server| find_revision(&server.routes))
}

fn find_revision(routes: &[ProbeRoute]) -> Option<String> {
    for route in routes {
        if !route.terminal
            || route.matchers.len() != 1
            || route.matchers[0].path != ["/__rentnerproxy_runtime_probe"]
        {
            continue;
        }
        for handler in &route.handle {
            if handler.handler != "static_response" || handler.status_code != Some(200) {
                continue;
            }
            if let Some(revision) = handler
                .body
                .as_deref()
                .and_then(|body| body.strip_suffix('\n'))
                .filter(|revision| is_revision(revision))
            {
                return Some(revision.to_owned());
            }
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
    #[serde(default, rename = "match")]
    matchers: Vec<ProbeMatcher>,
    #[serde(default)]
    terminal: bool,
    #[serde(default)]
    handle: Vec<ProbeHandler>,
}

#[derive(Deserialize)]
struct ProbeMatcher {
    #[serde(default)]
    path: Vec<String>,
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
