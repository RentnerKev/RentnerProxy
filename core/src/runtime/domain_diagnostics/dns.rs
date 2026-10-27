use super::{Code, Stage, Status};
use hickory_resolver::{
    TokioResolver,
    config::{ResolveHosts, ResolverConfig, ResolverOpts},
    net::runtime::TokioRuntimeProvider,
    proto::rr::{Name, RData, RecordType},
};
use std::{collections::BTreeSet, net::IpAddr, time::Duration};
use tokio::time::{Instant, timeout_at};

#[derive(Clone, Copy, Debug)]
pub(super) enum DnsError {
    Missing,
    Failed,
    Timeout,
}
impl DnsError {
    pub(super) fn stage(self, start: Instant) -> Stage {
        Stage::new(
            Status::Failed,
            match self {
                Self::Missing => Code::DnsNotFound,
                Self::Failed => Code::DnsFailed,
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
    options.preserve_intermediates = false;
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
) -> std::result::Result<Option<hickory_resolver::lookup::Lookup>, DnsError> {
    match timeout_at(deadline, resolver.lookup(name, kind)).await {
        Ok(Ok(answer)) => {
            if answer.answers().len() + answer.authorities().len() + answer.additionals().len()
                > 256
            {
                return Err(DnsError::Failed);
            }
            Ok(Some(answer))
        }
        Ok(Err(error)) if error.is_no_records_found() => Ok(None),
        Ok(Err(_)) => Err(DnsError::Failed),
        Err(_) => Err(DnsError::Timeout),
    }
}
/// Resolve one configured name through bounded exact CNAME questions. Only the
/// terminal owner's A/AAAA records authorize a socket; other answers are ignored.
pub(super) async fn addresses(
    resolver: &TokioResolver,
    host: &str,
    deadline: Instant,
) -> std::result::Result<Vec<IpAddr>, DnsError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![ip]);
    }
    let mut name = Name::from_ascii(format!("{host}."))
        .map_err(|_| DnsError::Failed)?
        .to_lowercase();
    let mut visited = BTreeSet::from([name.clone()]);
    for hop in 0..=8 {
        let mut targets = BTreeSet::new();
        if let Some(answer) = lookup(resolver, name.clone(), RecordType::CNAME, deadline).await? {
            for record in answer.answers() {
                if record.name.to_lowercase() == name
                    && let RData::CNAME(target) = &record.data
                {
                    let target = target.0.to_lowercase();
                    if !valid_name(&target) {
                        return Err(DnsError::Failed);
                    }
                    targets.insert(target);
                }
            }
            if !targets.is_empty() {
                for record in answer
                    .answers()
                    .iter()
                    .chain(answer.authorities())
                    .chain(answer.additionals())
                {
                    if record.name.to_lowercase() != name {
                        continue;
                    }
                    match &record.data {
                        RData::CNAME(target) if targets.contains(&target.0.to_lowercase()) => {}
                        _ if matches!(
                            record.record_type(),
                            RecordType::RRSIG | RecordType::NSEC | RecordType::SIG
                        ) => {}
                        _ => return Err(DnsError::Failed),
                    }
                }
            }
        }
        if targets.is_empty() {
            let mut ips = BTreeSet::new();
            for kind in [RecordType::A, RecordType::AAAA] {
                if let Some(answer) = lookup(resolver, name.clone(), kind, deadline).await? {
                    for record in answer.answers() {
                        if record.name.to_lowercase() != name {
                            continue;
                        }
                        let ip = match &record.data {
                            RData::A(ip) if kind == RecordType::A => IpAddr::V4(ip.0),
                            RData::AAAA(ip) if kind == RecordType::AAAA => IpAddr::V6(ip.0),
                            _ => continue,
                        };
                        ips.insert(ip);
                        if ips.len() > 16 {
                            return Err(DnsError::Failed);
                        }
                    }
                }
            }
            return if ips.is_empty() {
                Err(DnsError::Missing)
            } else {
                Ok(ips.into_iter().collect())
            };
        }
        if targets.len() != 1 || hop == 8 {
            return Err(DnsError::Failed);
        }
        name = targets.into_iter().next().ok_or(DnsError::Failed)?;
        if !visited.insert(name.clone()) {
            return Err(DnsError::Failed);
        }
    }
    Err(DnsError::Failed)
}
