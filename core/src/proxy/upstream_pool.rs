use std::collections::HashSet;

use crate::models::ProxyHost;

use super::is_valid_forward_host;

pub(crate) const MAX_UPSTREAM_MEMBERS: usize = 16;

pub(super) fn has_valid_upstream_pool(host: &ProxyHost) -> bool {
    let Some(pool) = &host.upstream_pool else {
        return true;
    };
    if pool.members.is_empty() || pool.members.len() > MAX_UPSTREAM_MEMBERS {
        return false;
    }
    let first = &pool.members[0];
    if first.host != host.forward_host || first.port != host.forward_port {
        return false;
    }
    let mut targets = HashSet::with_capacity(pool.members.len());
    pool.members.iter().all(|member| {
        member.port != 0
            && is_valid_forward_host(&member.host)
            && targets.insert((
                member
                    .host
                    .parse::<std::net::IpAddr>()
                    .map_or_else(|_| member.host.clone(), |address| address.to_string()),
                member.port,
            ))
    })
}

pub(crate) fn configuration_version(hosts: &[ProxyHost]) -> u8 {
    if hosts.iter().any(|host| host.upstream_pool.is_some()) {
        8
    } else {
        7
    }
}
