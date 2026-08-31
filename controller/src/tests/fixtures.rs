use crate::{
    models::{ProxyConfigRequest, ProxyHost},
    proxy::revision_for_hosts,
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
    }
}

pub(super) fn request(hosts: Vec<ProxyHost>) -> ProxyConfigRequest {
    ProxyConfigRequest {
        version: 1,
        revision: revision_for_hosts(&hosts),
        proxy_hosts: hosts,
    }
}
