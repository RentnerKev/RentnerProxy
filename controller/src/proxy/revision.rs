use crate::models::{ProxyHost, ProxyHttpSettings, TrustedCa};
use serde::Serialize;
use sha2::{Digest, Sha256};

pub(crate) fn revision_for_hosts(hosts: &[ProxyHost]) -> String {
    hash_snapshot(&CanonicalSnapshot {
        version: 1,
        proxy_hosts: canonical_hosts(hosts),
    })
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn revision_for_configuration(
    hosts: &[ProxyHost],
    http_settings: &ProxyHttpSettings,
) -> String {
    revision_for_configuration_with_trusted_cas(hosts, http_settings, &[])
}

pub(crate) fn revision_for_configuration_with_trusted_cas(
    hosts: &[ProxyHost],
    http_settings: &ProxyHttpSettings,
    trusted_cas: &[TrustedCa],
) -> String {
    let hosts = canonical_hosts(hosts);
    let trusted_cas = canonical_trusted_cas(trusted_cas);
    if hosts.iter().any(|host| host.upstream_tls.is_some()) || !trusted_cas.is_empty() {
        return hash_snapshot(&CanonicalUpstreamTlsConfigurationSnapshot {
            version: 5,
            proxy_hosts: hosts,
            http_settings,
            trusted_cas: &trusted_cas,
        });
    }
    if hosts.iter().any(|host| host.certificate_id.is_some()) {
        return hash_snapshot(&CanonicalTlsConfigurationSnapshot {
            version: 4,
            proxy_hosts: hosts,
            http_settings,
        });
    }
    if hosts
        .iter()
        .any(|host| !host.http_settings.is_empty() || !host.advanced_config.is_empty())
    {
        return hash_snapshot(&CanonicalHostConfigurationSnapshot {
            version: 3,
            proxy_hosts: hosts,
            http_settings,
        });
    }
    if http_settings.is_empty() {
        return revision_for_hosts(&hosts);
    }
    hash_snapshot(&CanonicalConfigurationSnapshot {
        version: 2,
        proxy_hosts: hosts,
        http_settings,
    })
}

fn hash_snapshot(snapshot: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(snapshot)
        .expect("canonical proxy snapshot only contains serializable strings and numbers");
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(crate) fn revision_from_config(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        line.strip_prefix("# rentnerproxy-revision: ")
            .filter(|revision| is_revision(revision))
            .map(ToOwned::to_owned)
    })
}

pub(super) fn canonical_hosts(hosts: &[ProxyHost]) -> Vec<ProxyHost> {
    let mut hosts = hosts.to_vec();
    for host in &mut hosts {
        host.domains.sort_unstable();
        host.advanced_config = super::normalize_advanced_config(&host.advanced_config);
    }
    hosts.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hosts
}

pub(super) fn canonical_trusted_cas(trusted_cas: &[TrustedCa]) -> Vec<TrustedCa> {
    let mut trusted_cas = trusted_cas.to_vec();
    trusted_cas.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    trusted_cas
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalConfigurationSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    http_settings: &'a ProxyHttpSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalHostConfigurationSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    http_settings: &'a ProxyHttpSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalTlsConfigurationSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    http_settings: &'a ProxyHttpSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalUpstreamTlsConfigurationSnapshot<'a> {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
    http_settings: &'a ProxyHttpSettings,
    trusted_cas: &'a [TrustedCa],
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
