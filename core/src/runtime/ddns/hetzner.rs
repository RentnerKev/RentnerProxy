use super::{
    models::{Error, Failure, Target},
    provider::{self, Provider, Record},
};
use crate::runtime::hetzner::{Api, ErrorKind, Record as ApiRecord, Rrset};
use aws_lc_rs::digest::{Context, SHA256};
use std::net::IpAddr;

fn failure(error: crate::runtime::hetzner::Error) -> Failure {
    Failure {
        code: match error.kind {
            ErrorKind::Unauthorized => Error::ProviderUnauthorized,
            ErrorKind::RateLimited => Error::ProviderRateLimited,
            ErrorKind::Unavailable => Error::ProviderUnavailable,
            ErrorKind::InvalidResponse => Error::InvalidProviderResponse,
            ErrorKind::NotFound => Error::RecordChanged,
            ErrorKind::Conflict => Error::RecordConflict,
            ErrorKind::TimeBudgetExceeded => Error::TimeBudgetExceeded,
            ErrorKind::WriteUnconfirmed => Error::WriteUnconfirmed,
        },
        retry_after: error.retry_after,
    }
}
fn api<'a>(provider: &'a Provider<'a>) -> Api<'a> {
    Api::new(
        &provider.client,
        &provider.base,
        provider.token,
        provider.deadline,
    )
}
async fn owner(api: &Api<'_>, target: &Target) -> Result<String, Failure> {
    let zone = api.zone(&target.zone_id).await.map_err(failure)?;
    if target.name == zone.name {
        return Ok("@".into());
    }
    target
        .name
        .strip_suffix(&zone.name)
        .and_then(|prefix| prefix.strip_suffix('.'))
        .filter(|prefix| !prefix.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| Error::NameOutsideZone.into())
}
fn convert(rrset: &Rrset, target: &Target) -> Result<Vec<Record>, Failure> {
    // Hetzner exposes a logical RRset ID, not an immutable incarnation ID.
    // This fingerprint fences comment changes but cannot detect recreation
    // with identical metadata. Address changes must not invalidate adoption.
    let mut hash = Context::new(&SHA256);
    for value in [
        target.zone_id.as_str(),
        &rrset.id,
        &target.name,
        &rrset.kind,
    ] {
        hash.update(value.as_bytes());
        hash.update(&[0]);
    }
    for record in &rrset.records {
        match &record.comment {
            Some(comment) => {
                hash.update(&[1]);
                hash.update(comment.as_bytes());
            }
            None => hash.update(&[0]),
        }
        hash.update(&[0]);
    }
    let id: String = hash.finish().as_ref()[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    rrset
        .records
        .iter()
        .map(|record| {
            let content = if matches!(rrset.kind.as_str(), "A" | "AAAA") {
                let address: IpAddr = record
                    .value
                    .parse()
                    .map_err(|_| Error::InvalidProviderResponse)?;
                if (rrset.kind == "A") != address.is_ipv4() {
                    return Err(Error::InvalidProviderResponse.into());
                }
                address.to_string()
            } else {
                record.value.clone()
            };
            Ok(Record {
                id: id.clone(),
                name: target.name.clone(),
                kind: rrset.kind.clone(),
                content,
                proxied: Some(false),
                comment: record.comment.clone(),
                ttl: rrset.ttl,
            })
        })
        .collect()
}
pub(super) async fn records(
    provider: &Provider<'_>,
    target: &Target,
) -> Result<Vec<Record>, Failure> {
    let api = api(provider);
    let owner = owner(&api, target).await?;
    let rrsets = api.rrsets(&target.zone_id, &owner).await.map_err(failure)?;
    let mut result = Vec::new();
    for rrset in &rrsets {
        // Even an empty CNAME reserves its owner; never treat it as free.
        if rrset.kind == "CNAME" && rrset.records.is_empty() {
            return Err(Error::RecordConflict.into());
        }
        result.extend(convert(rrset, target)?);
    }
    Ok(result)
}
pub(super) async fn write(
    provider: &Provider<'_>,
    target: &Target,
    address: IpAddr,
    existing: Option<&Record>,
) -> Result<Record, Failure> {
    let api = api(provider);
    let owner = owner(&api, target).await?;
    let before = api.rrsets(&target.zone_id, &owner).await.map_err(failure)?;
    if before.iter().any(|rrset| rrset.kind == "CNAME") {
        return Err(Error::RecordConflict.into());
    }
    let rrset = before
        .iter()
        .find(|rrset| rrset.kind == target.record_type.as_str());
    let current = rrset
        .map(|rrset| convert(rrset, target))
        .transpose()?
        .unwrap_or_default();
    match (existing, current.as_slice()) {
        (Some(previous), [record])
            if super::same_records(std::slice::from_ref(previous), &current) =>
        {
            if record.comment.as_deref().is_some_and(|comment| {
                comment.starts_with("rentnerproxy-ddns:") && comment != provider::marker(target)
            }) {
                return Err(Error::RecordConflict.into());
            }
        }
        (None, []) => {}
        (_, records) if records.len() > 1 => return Err(Error::RecordConflict.into()),
        _ => return Err(Error::RecordChanged.into()),
    }
    let desired = [ApiRecord {
        value: address.to_string(),
        comment: existing.map_or_else(
            || Some(provider::marker(target)),
            |record| record.comment.clone(),
        ),
    }];
    let acknowledgement = if existing.is_some() {
        api.set_records(
            &target.zone_id,
            &owner,
            target.record_type.as_str(),
            &desired,
        )
        .await
    } else if rrset.is_some() {
        api.add_records(
            &target.zone_id,
            &owner,
            target.record_type.as_str(),
            &desired,
        )
        .await
    } else {
        api.create_rrset(
            &target.zone_id,
            &owner,
            target.record_type.as_str(),
            None,
            &desired,
        )
        .await
    };
    let failed = acknowledgement.err().map(failure);
    // A failed action/transport acknowledgement may follow a committed write.
    // Verify once, never replay a mutation. Explicit rejection retains its code.
    if let Some(failure) = failed
        && (failure.retry_after.is_some()
            || matches!(
                failure.code,
                Error::ProviderUnauthorized | Error::ProviderRateLimited | Error::RecordConflict
            ))
    {
        return Err(failure);
    }
    let verified = async {
        let after = api.rrsets(&target.zone_id, &owner).await.map_err(failure)?;
        if after.iter().any(|rrset| rrset.kind == "CNAME") {
            return Err(Error::WriteUnconfirmed.into());
        }
        // Require unrelated RRsets to survive unchanged as well as the selected
        // RRset's TTL and exact comment. No provider response grants adoption.
        for previous in before
            .iter()
            .filter(|rrset| rrset.kind != target.record_type.as_str())
        {
            let Some(latest) = after.iter().find(|rrset| rrset.kind == previous.kind) else {
                return Err(Error::WriteUnconfirmed.into());
            };
            if latest.id != previous.id
                || latest.ttl != previous.ttl
                || latest.records != previous.records
            {
                return Err(Error::WriteUnconfirmed.into());
            }
        }
        let written = after
            .iter()
            .find(|rrset| rrset.kind == target.record_type.as_str())
            .ok_or(Error::WriteUnconfirmed)?;
        if written.records != desired || written.ttl != rrset.and_then(|rrset| rrset.ttl) {
            return Err(Error::WriteUnconfirmed.into());
        }
        let converted = convert(written, target)?;
        let [record] = converted.as_slice() else {
            return Err(Error::WriteUnconfirmed.into());
        };
        if record.address(target.record_type).ok() != Some(address)
            || existing.is_some_and(|previous| previous.id != record.id)
        {
            return Err(Error::WriteUnconfirmed.into());
        }
        Ok(record.clone())
    }
    .await;
    verified.map_err(|verify: Failure| Failure {
        code: Error::WriteUnconfirmed,
        retry_after: failed
            .and_then(|failed| failed.retry_after)
            .or(verify.retry_after),
    })
}

#[cfg(test)]
#[path = "../../../tests/private/ddns/hetzner.rs"]
mod tests;
