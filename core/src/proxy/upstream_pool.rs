use std::collections::HashSet;

use crate::models::{ProxyHost, UpstreamPool, UpstreamSelectionPolicy};

use super::is_valid_forward_host;

pub(crate) const MAX_UPSTREAM_MEMBERS: usize = 16;

pub(super) fn has_valid_upstream_pool(host: &ProxyHost) -> bool {
    let Some(pool) = &host.upstream_pool else {
        return true;
    };
    if pool.members.is_empty()
        || pool.members.len() > MAX_UPSTREAM_MEMBERS
        || !has_valid_failover(pool)
    {
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
    if hosts.iter().any(|host| {
        host.upstream_pool
            .as_ref()
            .is_some_and(|pool| pool.failover.is_some())
    }) {
        9
    } else if hosts.iter().any(|host| host.upstream_pool.is_some()) {
        8
    } else {
        7
    }
}

fn has_valid_failover(pool: &UpstreamPool) -> bool {
    let Some(failover) = &pool.failover else {
        return true;
    };
    if failover.active.is_none() && failover.passive.is_none() && failover.retries.is_none() {
        return false;
    }
    if failover.active.as_ref().is_some_and(|active| {
        !valid_health_path(&active.path)
            || !(5..=300).contains(&active.interval_seconds)
            || !(1..=30).contains(&active.timeout_seconds)
            || active.timeout_seconds > active.interval_seconds
            || !(1..=10).contains(&active.fails)
            || !(1..=10).contains(&active.passes)
            || !(200..=399).contains(&active.expected_status)
    }) || failover.passive.as_ref().is_some_and(|passive| {
        !(1..=300).contains(&passive.fail_duration_seconds)
            || !(1..=10).contains(&passive.max_fails)
    }) {
        return false;
    }
    if let Some(retries) = &failover.retries {
        let Some(passive) = &failover.passive else {
            return false;
        };
        if !(1..=15).contains(&retries.max_retries)
            || !(1..=30).contains(&retries.try_duration_seconds)
            || !(100..=5000).contains(&retries.try_interval_milliseconds)
            || u32::from(retries.try_interval_milliseconds)
                > u32::from(retries.try_duration_seconds) * 1000
            || (pool.policy == UpstreamSelectionPolicy::First
                && retries.max_retries < passive.max_fails)
        {
            return false;
        }
    }
    true
}

fn valid_health_path(path: &str) -> bool {
    if path.is_empty()
        || path.len() > 2048
        || !path.starts_with('/')
        || path.starts_with("//")
        || path
            .bytes()
            .any(|byte| !byte.is_ascii_graphic() || matches!(byte, b'#' | b'\\' | b'{' | b'}'))
    {
        return false;
    }
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%'
            && !(bytes.next().is_some_and(|byte| byte.is_ascii_hexdigit())
                && bytes.next().is_some_and(|byte| byte.is_ascii_hexdigit()))
        {
            return false;
        }
    }
    true
}
