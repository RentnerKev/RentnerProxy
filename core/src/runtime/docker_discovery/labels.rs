use super::models::*;
use crate::proxy::{is_canonical_domain, is_canonical_uuid_v7};
use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
};

pub(super) const ENABLE: &str = "rentnerproxy.enable";
const LABELS: [&str; 9] = [
    ENABLE,
    "rentnerproxy.domains",
    "rentnerproxy.port",
    "rentnerproxy.protocol",
    "rentnerproxy.network",
    "rentnerproxy.certificate",
    "rentnerproxy.access-policy",
    "rentnerproxy.id",
    "rentnerproxy.upstream-tls-server-name",
];

pub(super) fn container_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
}
fn network_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}
pub(super) fn candidate(container: Container) -> Option<Candidate> {
    let labels = &container.config.labels;
    if labels.get(ENABLE).map(String::as_str) != Some("true") {
        return None;
    }
    let mut issues = Vec::new();
    let source_id = source(&container);
    if source_id.is_none() {
        issues.push(Issue::InvalidSource);
    }
    if labels.iter().any(|(key, value)| {
        key.starts_with("rentnerproxy.")
            && (!LABELS.contains(&key.as_str()) || value.len() > 25_400)
    }) {
        issues.push(Issue::UnsupportedLabel);
    }
    if labels
        .keys()
        .any(|key| key.starts_with("com.docker.swarm.") || key.starts_with("io.kubernetes."))
    {
        issues.push(Issue::UnsupportedOrchestrator);
    }
    let raw_domains = labels
        .get("rentnerproxy.domains")
        .map(String::as_str)
        .unwrap_or_default();
    let mut domains = BTreeSet::new();
    if raw_domains.len() > 25_400
        || raw_domains.split(',').count() > 100
        || raw_domains.split(',').any(|raw| {
            let domain = raw.trim().to_ascii_lowercase();
            !is_canonical_domain(&domain)
                || !reqwest::Url::parse(&format!("http://{domain}"))
                    .is_ok_and(|url| url.host_str() == Some(domain.as_str()))
                || !domains.insert(domain)
        })
    {
        issues.push(Issue::InvalidDomains);
        domains.clear();
    }
    let scheme = labels
        .get("rentnerproxy.protocol")
        .map(String::as_str)
        .unwrap_or("http");
    if !matches!(scheme, "http" | "https") {
        issues.push(Issue::InvalidProtocol);
    }
    let port = port(&container, &mut issues);
    let network = network(&container, &mut issues);
    if !container.state.running || container.state.paused || container.state.restarting {
        issues.push(Issue::ContainerNotRunning);
    }
    let reference = |key: &str, issue, issues: &mut Vec<Issue>| {
        labels.get(key).and_then(|value| {
            if is_canonical_uuid_v7(value) {
                Some(value.clone())
            } else {
                issues.push(issue);
                None
            }
        })
    };
    let certificate_id = reference(
        "rentnerproxy.certificate",
        Issue::InvalidCertificateReference,
        &mut issues,
    );
    let access_policy_id = reference(
        "rentnerproxy.access-policy",
        Issue::InvalidAccessPolicyReference,
        &mut issues,
    );
    // HTTPS targets use container IPs. Keep verification enabled and require a DNS identity.
    let upstream_tls_server_name = labels
        .get("rentnerproxy.upstream-tls-server-name")
        .filter(|value| is_canonical_domain(value))
        .cloned();
    if (scheme == "https" && upstream_tls_server_name.is_none())
        || (labels.contains_key("rentnerproxy.upstream-tls-server-name")
            && (scheme != "https" || upstream_tls_server_name.is_none()))
    {
        issues.push(Issue::InvalidUpstreamTlsName);
    }
    let target = port
        .zip(network)
        .filter(|_| matches!(scheme, "http" | "https"))
        .map(|(port, (network, address))| Target {
            scheme: scheme.into(),
            address,
            port,
            network,
        });
    Some(Candidate {
        container_id: container.id,
        source_id,
        domains: domains.into_iter().collect(),
        target,
        certificate_id,
        access_policy_id,
        upstream_tls_server_name,
        issues,
    })
}

fn source(container: &Container) -> Option<String> {
    let labels = &container.config.labels;
    if let Some(id) = labels.get("rentnerproxy.id") {
        return network_name(id).then(|| format!("label:{id}"));
    }
    match (
        labels.get("com.docker.compose.project"),
        labels.get("com.docker.compose.service"),
    ) {
        (Some(project), Some(service)) if network_name(project) && network_name(service) => {
            Some(format!("compose:{project}/{service}"))
        }
        (None, None) => {
            let name = container.name.strip_prefix('/').unwrap_or(&container.name);
            network_name(name).then(|| format!("name:{name}"))
        }
        _ => None,
    }
}

fn port(container: &Container, issues: &mut Vec<Issue>) -> Option<u16> {
    let parse = |value: &str| {
        value
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0 && value == port.to_string())
    };
    if let Some(value) = container.config.labels.get("rentnerproxy.port") {
        let port = parse(value);
        if port.is_none() {
            issues.push(Issue::InvalidPort);
        }
        return port;
    }
    let ports: BTreeSet<_> = container
        .config
        .exposed_ports
        .as_ref()
        .into_iter()
        .flat_map(|p| p.keys())
        .filter_map(|value| value.strip_suffix("/tcp"))
        .collect();
    match ports.len() {
        0 => {
            issues.push(Issue::MissingPort);
            None
        }
        1 => {
            let port = ports.first().and_then(|p| parse(p));
            if port.is_none() {
                issues.push(Issue::InvalidPort);
            }
            port
        }
        _ => {
            issues.push(Issue::AmbiguousPort);
            None
        }
    }
}
fn network(container: &Container, issues: &mut Vec<Issue>) -> Option<(String, String)> {
    let mode = &container.host_config.network_mode;
    if mode == "host"
        || mode == "none"
        || mode.starts_with("container:")
        || mode.starts_with("service:")
    {
        issues.push(Issue::UnsupportedNetworkMode);
        return None;
    }
    let networks = &container.network_settings.networks;
    let selected = if let Some(name) = container.config.labels.get("rentnerproxy.network") {
        if !network_name(name) {
            issues.push(Issue::InvalidNetwork);
            return None;
        }
        networks.get_key_value(name)
    } else {
        match networks.len() {
            0 => None,
            1 => networks.first_key_value(),
            _ => {
                issues.push(Issue::AmbiguousNetwork);
                return None;
            }
        }
    };
    let Some((name, network)) = selected else {
        issues.push(Issue::MissingNetwork);
        return None;
    };
    if !network_name(name) {
        issues.push(Issue::InvalidNetwork);
        return None;
    }
    let address = [&network.ipv4, &network.ipv6].into_iter().find_map(|raw| {
        let ip = raw.parse::<IpAddr>().ok()?;
        (!ip.is_unspecified() && !ip.is_loopback() && !ip.is_multicast()
            && !matches!(ip, IpAddr::V4(v) if v.is_link_local())
            && !matches!(ip, IpAddr::V6(v) if v.is_unicast_link_local() || v.to_ipv4_mapped().is_some())).then(|| ip.to_string())
    });
    if address.is_none() {
        issues.push(Issue::MissingAddress);
    }
    address.map(|address| (name.clone(), address))
}

pub(super) fn conflicts(candidates: &mut [Candidate]) {
    let mut owners = BTreeMap::<String, usize>::new();
    let mut sources = BTreeMap::<String, usize>::new();
    for candidate in candidates.iter() {
        if let Some(source) = &candidate.source_id {
            *sources.entry(source.clone()).or_default() += 1;
        }
        for domain in &candidate.domains {
            *owners.entry(domain.clone()).or_default() += 1;
        }
    }
    for candidate in candidates {
        if candidate
            .source_id
            .as_ref()
            .is_some_and(|source| sources[source] > 1)
        {
            candidate.issues.push(Issue::SourceConflict);
        }
        if candidate.domains.iter().any(|domain| owners[domain] > 1) {
            candidate.issues.push(Issue::DomainConflict);
        }
    }
}
