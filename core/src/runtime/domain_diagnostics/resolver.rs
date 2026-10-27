use super::dns::{self, DnsError};
use hickory_resolver::{
    Hosts, TokioResolver,
    proto::{
        op::Query,
        rr::{Name, RData, RecordType},
    },
};
use std::{collections::BTreeSet, io::Read, net::IpAddr, path::PathBuf};
use tokio::time::Instant;

/// Trusted resolver policy is read once per request. Hosts/search affect only
/// the configured upstream, never the selected domain's DNS observation.
pub(super) struct Resolver {
    pub(super) dns: TokioResolver,
    hosts: std::result::Result<Hosts, DnsError>,
    search: Vec<Name>,
    ndots: usize,
}
impl Resolver {
    pub(super) fn system() -> std::result::Result<Self, DnsError> {
        let (config, options) =
            hickory_resolver::system_conf::read_system_conf().map_err(|_| DnsError::Failed)?;
        let ndots = options.ndots;
        let mut search = config.search.clone();
        if search.is_empty()
            && let Some(domain) = config.domain.clone()
        {
            search.push(domain);
        }
        search.truncate(6);
        Ok(Self {
            dns: dns::resolver(config, options)?,
            hosts: system_hosts(),
            search,
            ndots,
        })
    }
    pub(super) fn provided(dns: TokioResolver) -> Self {
        Self {
            dns,
            hosts: Ok(Hosts::default()),
            search: Vec::new(),
            ndots: 1,
        }
    }
    #[cfg(test)]
    pub(super) fn with_policy(
        dns: TokioResolver,
        hosts: &[u8],
        search: Vec<Name>,
        ndots: usize,
    ) -> Self {
        let mut parsed = Hosts::default();
        parsed.read_hosts_conf(hosts).unwrap();
        Self {
            dns,
            hosts: Ok(parsed),
            search,
            ndots,
        }
    }
    pub(super) async fn upstream_addresses(
        &self,
        host: &str,
        deadline: Instant,
    ) -> std::result::Result<Vec<IpAddr>, DnsError> {
        if let Ok(ip) = host.parse() {
            return Ok(vec![ip]);
        }
        let hosts = self.hosts.as_ref().map_err(|error| *error)?;
        let raw = Name::from_ascii(format!("{host}."))
            .map_err(|_| DnsError::Failed)?
            .to_lowercase();
        let mut ips = BTreeSet::new();
        for kind in [RecordType::A, RecordType::AAAA] {
            if let Some(answer) = hosts.lookup_static_host(&Query::query(raw.clone(), kind)) {
                for record in answer.answers() {
                    if record.name.to_lowercase() != raw {
                        continue;
                    }
                    match &record.data {
                        RData::A(ip) => {
                            ips.insert(IpAddr::V4(ip.0));
                        }
                        RData::AAAA(ip) => {
                            ips.insert(IpAddr::V6(ip.0));
                        }
                        _ => {}
                    }
                    if ips.len() > 16 {
                        return Err(DnsError::Failed);
                    }
                }
            }
        }
        if !ips.is_empty() {
            return Ok(ips.into_iter().collect());
        }
        let base = Name::from_ascii(host).map_err(|_| DnsError::Failed)?;
        let raw_first =
            host.bytes().filter(|byte| *byte == b'.').count() >= self.ndots || host == "localhost";
        let mut candidates = Vec::new();
        if raw_first {
            candidates.push(raw.clone());
        }
        for suffix in self.search.iter().take(6) {
            if let Ok(mut candidate) = base.clone().append_domain(suffix) {
                candidate.set_fqdn(true);
                let candidate = candidate.to_lowercase();
                if !candidates.contains(&candidate) {
                    candidates.push(candidate);
                }
            }
        }
        if !candidates.contains(&raw) {
            candidates.push(raw);
        }
        for candidate in candidates {
            match dns::addresses(
                &self.dns,
                candidate.to_ascii().trim_end_matches('.'),
                deadline,
            )
            .await
            {
                Ok(ips) => return Ok(ips),
                Err(DnsError::Missing) => {}
                Err(error) => return Err(error),
            }
        }
        Err(DnsError::Missing)
    }
}
fn system_hosts() -> std::result::Result<Hosts, DnsError> {
    #[cfg(unix)]
    let path = PathBuf::from("/etc/hosts");
    #[cfg(windows)]
    let path = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or(DnsError::Failed)?
        .join("System32")
        .join("drivers")
        .join("etc")
        .join("hosts");
    #[cfg(not(any(unix, windows)))]
    return Ok(Hosts::default());
    let file = match crate::runtime::state::open_absolute_regular_file(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Hosts::default()),
        Err(_) => return Err(DnsError::Failed),
    };
    let mut bytes = Vec::new();
    file.take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| DnsError::Failed)?;
    if bytes.len() > 256 * 1024 {
        return Err(DnsError::Failed);
    }
    let mut hosts = Hosts::default();
    hosts
        .read_hosts_conf(bytes.as_slice())
        .map_err(|_| DnsError::Failed)?;
    Ok(hosts)
}
