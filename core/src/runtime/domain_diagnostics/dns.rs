use super::{Code, Stage, Status};
use hickory_resolver::{
    TokioResolver,
    config::{ResolveHosts, ResolverConfig, ResolverOpts},
    lookup::Lookup,
    net::{DnsError as NetDnsError, NetError, runtime::TokioRuntimeProvider},
    proto::rr::{DNSClass, Name, RData, RecordType},
};
use std::{collections::BTreeSet, net::IpAddr, time::Duration};
use tokio::time::{Instant, timeout_at};

#[derive(Clone, Copy, Debug)]
pub(super) enum DnsError {
    Missing,
    Failed,
    Timeout,
    Invalid,
}
impl DnsError {
    pub(super) fn stage(self, start: Instant) -> Stage {
        Stage::new(
            Status::Failed,
            match self {
                Self::Missing => Code::DnsNotFound,
                Self::Failed | Self::Invalid => Code::DnsFailed,
                Self::Timeout => Code::DnsTimeout,
            },
        )
        .elapsed(start)
    }
}
pub(super) fn resolver(
    config: ResolverConfig,
    options: ResolverOpts,
) -> std::result::Result<TokioResolver, DnsError> {
    let mut builder = TokioResolver::builder_with_config(config, TokioRuntimeProvider::default())
        .with_options(options);
    let options = builder.options_mut();
    options.timeout = Duration::from_secs(3);
    options.attempts = 1;
    options.cache_size = 0;
    options.num_concurrent_reqs = 1;
    options.max_active_requests = 4;
    // This resolver is diagnostics-only. Preserve each family's own rooted
    // chain instead of issuing optional CNAME questions that Docker may forward.
    // Hickory 0.26.3 also bounds its internal auto-follow depth at eight lookups.
    options.preserve_intermediates = true;
    options.try_tcp_on_error = true;
    options.use_hosts_file = ResolveHosts::Never;
    builder.build().map_err(|_| DnsError::Failed)
}
fn valid_name(name: &Name) -> bool {
    let name = name.to_ascii();
    let name = name.trim_end_matches('.');
    !name.is_empty()
        && name.len() <= 253
        && name.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}
async fn lookup(
    resolver: &TokioResolver,
    name: Name,
    kind: RecordType,
    deadline: Instant,
) -> std::result::Result<Option<Lookup>, DnsError> {
    match timeout_at(deadline, resolver.lookup(name, kind)).await {
        Ok(Ok(answer)) => {
            if answer.answers().len() + answer.authorities().len() + answer.additionals().len()
                > 256
            {
                return Err(DnsError::Invalid);
            }
            Ok(Some(answer))
        }
        Ok(Err(error)) if error.is_no_records_found() => Ok(None),
        Ok(Err(NetError::Timeout)) => Err(DnsError::Timeout),
        Ok(Err(NetError::Io(error))) if error.kind() != std::io::ErrorKind::InvalidData => {
            Err(DnsError::Failed)
        }
        Ok(Err(
            NetError::Busy | NetError::NoConnections | NetError::Dns(NetDnsError::ResponseCode(_)),
        )) => Err(DnsError::Failed),
        // Only a positively identified transport/server failure may be ignored
        // when the peer family has a proof. Unknown semantic errors fail closed.
        Ok(Err(_)) => Err(DnsError::Invalid),
        Err(_) => Err(DnsError::Timeout),
    }
}
/// Validate one family independently. Foreign records cannot introduce chain
/// edges or addresses, and a malformed rooted family remains fatal to the call.
pub(super) fn proven_addresses(
    answer: &Lookup,
    requested: &Name,
    kind: RecordType,
) -> std::result::Result<Vec<IpAddr>, DnsError> {
    let mut current = requested.to_lowercase();
    let mut visited = BTreeSet::from([current.clone()]);
    for hop in 0..=8 {
        if answer
            .answers()
            .iter()
            .chain(answer.authorities())
            .chain(answer.additionals())
            .any(|record| record.name.to_lowercase() == current && record.dns_class != DNSClass::IN)
        {
            return Err(DnsError::Invalid);
        }
        let mut targets = BTreeSet::new();
        for record in answer.answers() {
            if record.name.to_lowercase() == current
                && let RData::CNAME(target) = &record.data
            {
                let target = target.0.to_lowercase();
                if !valid_name(&target) {
                    return Err(DnsError::Invalid);
                }
                targets.insert(target);
            }
        }
        if targets.is_empty() {
            let mut ips = BTreeSet::new();
            for record in answer.answers() {
                if record.name.to_lowercase() != current {
                    continue;
                }
                let ip = match &record.data {
                    RData::A(ip) if kind == RecordType::A => IpAddr::V4(ip.0),
                    RData::AAAA(ip) if kind == RecordType::AAAA => IpAddr::V6(ip.0),
                    _ => continue,
                };
                ips.insert(ip);
                if ips.len() > 16 {
                    return Err(DnsError::Invalid);
                }
            }
            return if ips.is_empty() {
                Err(DnsError::Missing)
            } else {
                Ok(ips.into_iter().collect())
            };
        }
        if targets.len() != 1 || hop == 8 {
            return Err(DnsError::Invalid);
        }
        for record in answer
            .answers()
            .iter()
            .chain(answer.authorities())
            .chain(answer.additionals())
        {
            if record.name.to_lowercase() != current {
                continue;
            }
            match &record.data {
                RData::CNAME(target) if targets.contains(&target.0.to_lowercase()) => {}
                _ if matches!(
                    record.record_type(),
                    RecordType::RRSIG | RecordType::NSEC | RecordType::SIG
                ) => {}
                _ => return Err(DnsError::Invalid),
            }
        }
        current = targets.into_iter().next().ok_or(DnsError::Invalid)?;
        if !visited.insert(current.clone()) {
            return Err(DnsError::Invalid);
        }
    }
    Err(DnsError::Invalid)
}
async fn family(
    resolver: &TokioResolver,
    name: Name,
    kind: RecordType,
    deadline: Instant,
) -> std::result::Result<Vec<IpAddr>, DnsError> {
    match lookup(resolver, name.clone(), kind, deadline).await? {
        Some(answer) => proven_addresses(&answer, &name, kind),
        None => Err(DnsError::Missing),
    }
}
/// A and AAAA are independent observations under one DNS deadline. A valid
/// family survives a missing/timed-out peer without constructing a synthetic
/// cross-family chain; every returned address has its own rooted proof.
pub(super) async fn addresses(
    resolver: &TokioResolver,
    host: &str,
    deadline: Instant,
) -> std::result::Result<Vec<IpAddr>, DnsError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![ip]);
    }
    let name = Name::from_ascii(format!("{host}."))
        .map_err(|_| DnsError::Invalid)?
        .to_lowercase();
    let (a, aaaa) = tokio::join!(
        family(resolver, name.clone(), RecordType::A, deadline),
        family(resolver, name, RecordType::AAAA, deadline)
    );
    let mut ips = BTreeSet::new();
    let mut timeout = false;
    let mut failed = false;
    for result in [a, aaaa] {
        match result {
            Ok(family) => ips.extend(family),
            Err(DnsError::Invalid) => return Err(DnsError::Invalid),
            Err(DnsError::Timeout) => timeout = true,
            Err(DnsError::Failed) => failed = true,
            Err(DnsError::Missing) => {}
        }
    }
    if ips.len() > 16 {
        return Err(DnsError::Invalid);
    }
    if !ips.is_empty() {
        Ok(ips.into_iter().collect())
    } else if timeout {
        Err(DnsError::Timeout)
    } else if failed {
        Err(DnsError::Failed)
    } else {
        Err(DnsError::Missing)
    }
}
