use std::{
    collections::{BTreeMap, BTreeSet},
    net::SocketAddr,
    time::Duration,
};

use hickory_resolver::{
    TokioResolver,
    config::{NameServerConfig, ResolverConfig, ResolverOpts},
    net::runtime::TokioRuntimeProvider,
    proto::rr::{RData, RecordType},
};
use tokio::{task::JoinSet, time::timeout};

use super::certificates::{CertificateEnvironment, CertificateError, ManualDnsRecord};

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(3);
const CHECK_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_RECORDS: usize = 100;
const MAX_CONCURRENT_OWNERS: usize = 4;
const MAX_TXT_BYTES: usize = 64 * 1024;
const MAX_TXT_RECORDS: usize = 256;
const DNS_TEST_ADDR: &str = "RENTNERPROXY_ACME_TEST_DNS_ADDR";
const ACME_TEST_DIRECTORY: &str = "RENTNERPROXY_ACME_TEST_DIRECTORY_URL";
const ACME_TEST_ROOT: &str = "RENTNERPROXY_ACME_TEST_ROOT_CERT";

type ExpectedRecords = BTreeMap<String, BTreeSet<Vec<u8>>>;

/// Checks only the owners and values from the controller's live ACME session.
/// A fresh resolver avoids retaining negative answers between user retries.
pub(crate) async fn check_records(
    records: &[ManualDnsRecord],
    environment: CertificateEnvironment,
) -> Result<(), CertificateError> {
    let expected = expected_records(records)?;
    let override_addr = configured_test_address(
        environment,
        read_optional_env(DNS_TEST_ADDR)?,
        read_optional_env(ACME_TEST_DIRECTORY)?,
        read_optional_env(ACME_TEST_ROOT)?,
    )?;
    let resolver = resolver(override_addr)?;
    check_with_deadline(expected, resolver, LOOKUP_TIMEOUT, CHECK_TIMEOUT).await
}

fn expected_records(records: &[ManualDnsRecord]) -> Result<ExpectedRecords, CertificateError> {
    if records.is_empty() || records.len() > MAX_RECORDS {
        return Err(CertificateError::ManualDnsLookupFailed);
    }
    let mut expected = ExpectedRecords::new();
    for record in records {
        let domain = record
            .identifier
            .strip_prefix("*.")
            .unwrap_or(&record.identifier);
        if !crate::proxy::is_canonical_domain(domain)
            || record.owner.len() > 253
            || record.owner != format!("_acme-challenge.{domain}")
            || record.value.len() != 43
            || !record
                .value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(CertificateError::ManualDnsLookupFailed);
        }
        expected
            .entry(format!("{}.", record.owner))
            .or_default()
            .insert(record.value.as_bytes().to_vec());
    }
    Ok(expected)
}

fn resolver(address: Option<SocketAddr>) -> Result<TokioResolver, CertificateError> {
    let mut builder = match address {
        Some(address) => {
            let mut server = NameServerConfig::udp_and_tcp(address.ip());
            for connection in &mut server.connections {
                connection.port = address.port();
            }
            TokioResolver::builder_with_config(
                ResolverConfig::from_name_servers(vec![server]),
                TokioRuntimeProvider::default(),
            )
        }
        None => {
            TokioResolver::builder_tokio().map_err(|_| CertificateError::ManualDnsLookupFailed)?
        }
    };
    configure_options(builder.options_mut());
    builder
        .build()
        .map_err(|_| CertificateError::ManualDnsLookupFailed)
}

fn configure_options(options: &mut ResolverOpts) {
    options.timeout = LOOKUP_TIMEOUT;
    options.attempts = 1;
    options.cache_size = 0;
    options.positive_min_ttl = Some(Duration::ZERO);
    options.positive_max_ttl = Some(Duration::ZERO);
    options.negative_min_ttl = Some(Duration::ZERO);
    options.negative_max_ttl = Some(Duration::ZERO);
    options.num_concurrent_reqs = 1;
    options.max_active_requests = MAX_CONCURRENT_OWNERS;
    options.preserve_intermediates = false;
    options.try_tcp_on_error = true;
}

async fn check_with_deadline(
    expected: ExpectedRecords,
    resolver: TokioResolver,
    lookup_timeout: Duration,
    check_timeout: Duration,
) -> Result<(), CertificateError> {
    timeout(
        check_timeout,
        check_with_resolver(expected, resolver, lookup_timeout),
    )
    .await
    .map_err(|_| CertificateError::ManualDnsLookupFailed)?
}
async fn check_with_resolver(
    expected: ExpectedRecords,
    resolver: TokioResolver,
    lookup_timeout: Duration,
) -> Result<(), CertificateError> {
    let mut pending = expected.into_iter();
    let mut tasks = JoinSet::new();
    loop {
        while tasks.len() < MAX_CONCURRENT_OWNERS {
            let Some((owner, values)) = pending.next() else {
                break;
            };
            let resolver = resolver.clone();
            tasks.spawn(async move {
                let answer = timeout(lookup_timeout, resolver.lookup(owner, RecordType::TXT))
                    .await
                    .map_err(|_| CertificateError::ManualDnsLookupFailed)?
                    .map_err(|error| {
                        if error.is_no_records_found() {
                            CertificateError::ManualDnsNotPropagated
                        } else {
                            CertificateError::ManualDnsLookupFailed
                        }
                    })?;
                match_values(answer.answers().iter().map(|record| &record.data), &values)
            });
        }
        let Some(result) = tasks.join_next().await else {
            return Ok(());
        };
        result.map_err(|_| CertificateError::ManualDnsLookupFailed)??;
    }
}

fn match_values<'a>(
    answers: impl IntoIterator<Item = &'a RData>,
    expected: &BTreeSet<Vec<u8>>,
) -> Result<(), CertificateError> {
    let mut values = BTreeSet::new();
    let mut total_bytes = 0_usize;
    let mut count = 0;
    for answer in answers {
        let RData::TXT(txt) = answer else { continue };
        count += 1;
        if count > MAX_TXT_RECORDS {
            return Err(CertificateError::ManualDnsLookupFailed);
        }
        let mut logical = Vec::new();
        for chunk in &txt.txt_data {
            total_bytes = total_bytes
                .checked_add(chunk.len())
                .ok_or(CertificateError::ManualDnsLookupFailed)?;
            if total_bytes > MAX_TXT_BYTES {
                return Err(CertificateError::ManualDnsLookupFailed);
            }
            logical.extend_from_slice(chunk);
        }
        values.insert(logical);
    }
    if expected.is_subset(&values) {
        Ok(())
    } else {
        Err(CertificateError::ManualDnsNotPropagated)
    }
}

fn configured_test_address(
    environment: CertificateEnvironment,
    address: Option<String>,
    directory: Option<String>,
    root: Option<String>,
) -> Result<Option<SocketAddr>, CertificateError> {
    if environment == CertificateEnvironment::Production
        && (address.is_some() || directory.is_some() || root.is_some())
    {
        return Err(CertificateError::ManualDnsLookupFailed);
    }
    let Some(address) = address else {
        return Ok(None);
    };
    let valid_directory = directory.as_deref().is_some_and(|value| {
        value == value.trim()
            && value.len() <= 2048
            && reqwest::Url::parse(value).is_ok_and(|url| {
                url.scheme() == "https"
                    && url.host_str().is_some()
                    && url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
            })
    });
    let valid_root = root.as_deref().is_some_and(|value| {
        !value.trim().is_empty() && value.len() <= 4096 && std::path::Path::new(value).is_absolute()
    });
    let parsed = address
        .parse::<SocketAddr>()
        .map_err(|_| CertificateError::ManualDnsLookupFailed)?;
    if !valid_directory || !valid_root || !parsed.ip().is_loopback() || parsed.port() == 0 {
        return Err(CertificateError::ManualDnsLookupFailed);
    }
    Ok(Some(parsed))
}

fn read_optional_env(name: &str) -> Result<Option<String>, CertificateError> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(CertificateError::ManualDnsLookupFailed),
    }
}

#[cfg(test)]
#[path = "../../tests/private/manual_dns_propagation.rs"]
mod tests;
