use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};

use hickory_resolver::{
    TokioResolver,
    lookup::Lookup,
    proto::rr::{Name, RData, RecordType},
};
use tokio::{task::JoinSet, time::timeout};

use super::{
    certificates::{CertificateEnvironment, CertificateError},
    dns::{DnsDelegationBinding, DnsRecordIntent, is_canonical_dns_name},
};

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(3);
const CHECK_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_HOPS: usize = 8;
const MAX_RECORDS: usize = 256;
const MAX_TXT_BYTES: usize = 64 * 1024;
const MAX_CONCURRENT_OWNERS: usize = 4;

/// DNS answers select names, never socket destinations. Only the configured
/// recursive resolver receives queries; NS targets and glue are not dialed.
pub(crate) async fn resolve(
    original_owner: &str,
    zone_name: &str,
    environment: CertificateEnvironment,
) -> Result<DnsDelegationBinding, CertificateError> {
    let resolver = super::manual_dns_propagation::resolver_for_environment(environment)
        .map_err(|_| CertificateError::DnsDelegationLookupFailed)?;
    timeout(
        CHECK_TIMEOUT,
        resolve_with_resolver(original_owner, zone_name, &resolver),
    )
    .await
    .map_err(|_| CertificateError::DnsDelegationLookupFailed)?
}

fn canonical_name(name: &Name) -> Result<String, CertificateError> {
    let text = name.to_lowercase().to_ascii();
    let text = text.strip_suffix('.').unwrap_or(&text);
    if !is_canonical_dns_name(text) {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    Ok(text.to_owned())
}

async fn lookup(
    resolver: &TokioResolver,
    owner: &str,
    kind: RecordType,
) -> Result<Option<Lookup>, CertificateError> {
    match timeout(LOOKUP_TIMEOUT, resolver.lookup(format!("{owner}."), kind)).await {
        Ok(Ok(answer)) => {
            if answer.answers().len() + answer.authorities().len() + answer.additionals().len()
                > MAX_RECORDS
            {
                return Err(CertificateError::DnsDelegationInvalid);
            }
            Ok(Some(answer))
        }
        Ok(Err(error)) if error.is_no_records_found() => Ok(None),
        _ => Err(CertificateError::DnsDelegationLookupFailed),
    }
}

async fn closest_zone(resolver: &TokioResolver, owner: &str) -> Result<String, CertificateError> {
    let answer = timeout(
        LOOKUP_TIMEOUT,
        resolver.lookup(format!("{owner}."), RecordType::SOA),
    )
    .await
    .map_err(|_| CertificateError::DnsDelegationLookupFailed)?;
    let zone = match answer {
        Ok(answer) => {
            if answer.answers().len() + answer.authorities().len() + answer.additionals().len()
                > MAX_RECORDS
            {
                return Err(CertificateError::DnsDelegationInvalid);
            }
            let records: Vec<_> = answer
                .answers()
                .iter()
                .filter(|record| matches!(record.data, RData::SOA(_)))
                .collect();
            if records.len() != 1 || canonical_name(&records[0].name)? != owner {
                return Err(CertificateError::DnsDelegationInvalid);
            }
            canonical_name(&records[0].name)?
        }
        Err(error) if error.is_no_records_found() => {
            let soa = error
                .into_soa()
                .ok_or(CertificateError::DnsDelegationLookupFailed)?;
            canonical_name(&soa.name)?
        }
        Err(_) => return Err(CertificateError::DnsDelegationLookupFailed),
    };
    if owner != zone
        && !owner
            .strip_suffix(&zone)
            .is_some_and(|prefix| prefix.ends_with('.'))
    {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    Ok(zone)
}

// RFC 4034 permits RRSIG/NSEC at an alias; SIG is the recognized legacy
// signature type. Other DNSSEC types (for example DNSKEY) are ordinary data
// for CNAME coexistence. Hickory has no named NXT RecordType variant.
fn cname_metadata_type(kind: RecordType) -> bool {
    matches!(kind, RecordType::RRSIG | RecordType::NSEC | RecordType::SIG)
}
async fn resolve_with_resolver(
    original_owner: &str,
    zone_name: &str,
    resolver: &TokioResolver,
) -> Result<DnsDelegationBinding, CertificateError> {
    if !is_canonical_dns_name(original_owner)
        || !is_canonical_dns_name(zone_name)
        || !original_owner
            .strip_prefix("_acme-challenge.")
            .is_some_and(crate::proxy::is_canonical_domain)
    {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    let mut chain = vec![original_owner.to_owned()];
    let mut visited = BTreeSet::from([original_owner.to_owned()]);
    loop {
        let owner = chain.last().ok_or(CertificateError::DnsDelegationInvalid)?;
        let Some(answer) = lookup(resolver, owner, RecordType::CNAME).await? else {
            break;
        };
        // Only ANSWER records establish an alias. Other sections may expose
        // incompatible data at that owner, but cannot introduce an alias hop.
        let mut targets = BTreeSet::new();
        for record in answer.answers() {
            if canonical_name(&record.name)? == *owner
                && let RData::CNAME(target) = &record.data
            {
                targets.insert(canonical_name(&target.0)?);
            }
        }
        let records = answer
            .answers()
            .iter()
            .chain(answer.authorities())
            .chain(answer.additionals());
        let mut conflicts = false;
        let mut has_cname = false;
        for record in records {
            if canonical_name(&record.name)? != *owner {
                continue;
            }
            match &record.data {
                RData::CNAME(target) => {
                    has_cname = true;
                    if !targets.contains(&canonical_name(&target.0)?) {
                        conflicts = true;
                    }
                }
                _ if cname_metadata_type(record.record_type()) => {}
                _ => conflicts = true,
            }
        }
        if targets.is_empty() {
            if has_cname {
                return Err(CertificateError::DnsDelegationInvalid);
            }
            break;
        }
        if targets.len() != 1 || conflicts || chain.len() > MAX_HOPS {
            return Err(CertificateError::DnsDelegationInvalid);
        }
        let target = targets
            .into_iter()
            .next()
            .ok_or(CertificateError::DnsDelegationInvalid)?;
        if !visited.insert(target.clone()) {
            return Err(CertificateError::DnsDelegationInvalid);
        }
        chain.push(target);
    }
    let target_owner = chain
        .last()
        .ok_or(CertificateError::DnsDelegationInvalid)?
        .clone();
    if closest_zone(resolver, &target_owner).await? != zone_name {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    // A suffix inside an ordinary zone is not NS delegation of the challenge.
    if chain.len() == 1 && zone_name != original_owner {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    let ns = lookup(resolver, zone_name, RecordType::NS)
        .await?
        .ok_or(CertificateError::DnsDelegationInvalid)?;
    let mut ns_count = 0;
    for record in ns.answers() {
        if canonical_name(&record.name)? != zone_name {
            continue;
        }
        match &record.data {
            RData::NS(target) => {
                canonical_name(&target.0)?;
                ns_count += 1;
            }
            RData::CNAME(_) => return Err(CertificateError::DnsDelegationInvalid),
            _ => {}
        }
    }
    if ns_count == 0 {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    Ok(DnsDelegationBinding {
        original_owner: original_owner.to_owned(),
        target_owner,
        zone_name: zone_name.to_owned(),
        cname_chain: chain,
    })
}

pub(crate) async fn check_records(
    intents: &[DnsRecordIntent],
    environment: CertificateEnvironment,
) -> Result<(), CertificateError> {
    if intents.len() > MAX_RECORDS {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    let mut expected: BTreeMap<String, (DnsDelegationBinding, BTreeSet<Vec<u8>>)> = BTreeMap::new();
    for intent in intents {
        intent.validate()?;
        let Some(binding) = &intent.delegation else {
            continue;
        };
        let group = expected
            .entry(binding.original_owner.clone())
            .or_insert_with(|| (binding.clone(), BTreeSet::new()));
        if group.0 != *binding {
            return Err(CertificateError::DnsDelegationInvalid);
        }
        group.1.insert(intent.value.as_bytes().to_vec());
    }
    if expected.is_empty() {
        return Ok(());
    }
    let resolver = super::manual_dns_propagation::resolver_for_environment(environment)
        .map_err(|_| CertificateError::DnsDelegationLookupFailed)?;
    timeout(CHECK_TIMEOUT, check_with_resolver(expected, resolver))
        .await
        .map_err(|_| CertificateError::DnsDelegationLookupFailed)?
}

type Expected = BTreeMap<String, (DnsDelegationBinding, BTreeSet<Vec<u8>>)>;

async fn check_with_resolver(
    expected: Expected,
    resolver: TokioResolver,
) -> Result<(), CertificateError> {
    let mut pending = expected.into_values();
    let mut tasks = JoinSet::new();
    loop {
        while tasks.len() < MAX_CONCURRENT_OWNERS {
            let Some((binding, values)) = pending.next() else {
                break;
            };
            let resolver = resolver.clone();
            tasks.spawn(async move { check_owner(&binding, &values, &resolver).await });
        }
        let Some(result) = tasks.join_next().await else {
            return Ok(());
        };
        result.map_err(|_| CertificateError::DnsDelegationLookupFailed)??;
    }
}

async fn check_owner(
    binding: &DnsDelegationBinding,
    values: &BTreeSet<Vec<u8>>,
    resolver: &TokioResolver,
) -> Result<(), CertificateError> {
    let current =
        resolve_with_resolver(&binding.original_owner, &binding.zone_name, resolver).await?;
    if current != *binding {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    let answer = lookup(resolver, &binding.original_owner, RecordType::TXT)
        .await?
        .ok_or(CertificateError::DnsDelegationNotPropagated)?;
    let mut observed = BTreeSet::new();
    let mut bytes = 0usize;
    for record in answer.answers() {
        let RData::TXT(txt) = &record.data else {
            continue;
        };
        let mut logical = Vec::new();
        for chunk in &txt.txt_data {
            bytes = bytes
                .checked_add(chunk.len())
                .ok_or(CertificateError::DnsDelegationInvalid)?;
            if bytes > MAX_TXT_BYTES {
                return Err(CertificateError::DnsDelegationInvalid);
            }
            logical.extend_from_slice(chunk);
        }
        if canonical_name(&record.name)? == binding.target_owner {
            observed.insert(logical);
        }
    }
    if !values.is_subset(&observed) {
        return Err(CertificateError::DnsDelegationNotPropagated);
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/private/dns_delegation.rs"]
mod tests;
