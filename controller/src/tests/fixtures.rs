use crate::{
    models::{ProxyConfigRequest, ProxyHost, ProxyHttpSettings},
    proxy::revision_for_configuration,
};

pub(super) fn host(
    id: &str,
    domains: &[&str],
    scheme: &str,
    forward_host: &str,
    port: u16,
) -> ProxyHost {
    ProxyHost {
        id: id.to_owned(),
        domains: domains.iter().map(|domain| (*domain).to_owned()).collect(),
        forward_scheme: scheme.to_owned(),
        forward_host: forward_host.to_owned(),
        forward_port: port,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
    }
}

pub(super) fn request(hosts: Vec<ProxyHost>) -> ProxyConfigRequest {
    request_with_settings(hosts, ProxyHttpSettings::default())
}

pub(super) fn request_with_settings(
    hosts: Vec<ProxyHost>,
    http_settings: ProxyHttpSettings,
) -> ProxyConfigRequest {
    let version = if hosts
        .iter()
        .any(|host| !host.http_settings.is_empty() || !host.advanced_config.is_empty())
    {
        3
    } else if http_settings.is_empty() {
        1
    } else {
        2
    };
    ProxyConfigRequest {
        version,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        http_settings,
    }
}
