use super::{
    ProxyRuntime,
    certificates::{
        CertificateEnvironment, CertificateError, DnsValidationMode, ManualDnsActionRequest,
        ManualDnsRecord,
    },
    dns::{capabilities::ProviderId, is_canonical_dns_name},
    dns_connections::SetupSnapshot,
    dns_delegation::{self, SetupObservation},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};
use tokio::{
    task::JoinSet,
    time::{Instant, timeout_at},
};

const BUDGET: Duration = Duration::from_secs(12);
const MAX_CONCURRENT: usize = 4;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SetupRequest {
    pub(crate) domains: Vec<String>,
    pub(crate) environment: CertificateEnvironment,
    pub(crate) dns_mode: DnsValidationMode,
    pub(crate) connection_id: String,
    pub(crate) expected_revision: u32,
    pub(crate) zone_id: String,
    pub(crate) delegation: Option<Delegation>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Delegation {
    Cname {
        #[serde(rename = "targetOwner")]
        target_owner: String,
    },
    Ns,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SetupStatus {
    Ready,
    Missing,
    Conflicting,
    LookupFailed,
    NameserversUnavailable,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Instruction {
    pub(crate) r#type: &'static str,
    pub(crate) owner: String,
    pub(crate) values: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupRecord {
    pub(crate) identifiers: Vec<String>,
    pub(crate) original_owner: String,
    pub(crate) instruction: Instruction,
    pub(crate) status: SetupStatus,
    pub(crate) observed_target: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupResult {
    pub(crate) connection_id: String,
    pub(crate) connection_revision: u32,
    pub(crate) zone_id: String,
    pub(crate) zone_name: String,
    pub(crate) provider: ProviderId,
    pub(crate) dns_mode: DnsValidationMode,
    pub(crate) checked_at: String,
    pub(crate) results: Vec<SetupRecord>,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CheckStatus {
    Ready,
    Pending,
    Expired,
    LookupFailed,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckedRecord {
    pub(crate) owner: String,
    pub(crate) identifiers: Vec<String>,
    pub(crate) status: CheckStatus,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckResult {
    pub(crate) certificate_id: String,
    pub(crate) operation_id: String,
    pub(crate) challenge_set_id: String,
    pub(crate) checked_at: String,
    pub(crate) expires_at: String,
    pub(crate) status: CheckStatus,
    pub(crate) records: Vec<CheckedRecord>,
}

fn domains(request: &SetupRequest) -> Result<BTreeMap<String, Vec<String>>, CertificateError> {
    if !(1..=100).contains(&request.domains.len())
        || !crate::proxy::is_canonical_uuid_v7(&request.connection_id)
        || request.expected_revision == 0
        || request.zone_id.is_empty()
        || request.zone_id.len() > 253
        || !matches!(
            (&request.dns_mode, &request.delegation),
            (DnsValidationMode::Provider, None) | (DnsValidationMode::Delegated, Some(_))
        )
    {
        return Err(CertificateError::DnsProviderInvalid);
    }
    if let Some(Delegation::Cname { target_owner }) = &request.delegation
        && !is_canonical_dns_name(target_owner)
    {
        return Err(CertificateError::DnsDelegationInvalid);
    }
    let mut seen = BTreeSet::new();
    let mut grouped = BTreeMap::new();
    for domain in &request.domains {
        if !super::certificates::is_dns_setup_domain(domain, request.environment)
            || !seen.insert(domain)
        {
            return Err(CertificateError::AcmeDomainInvalid);
        }
        let bare = domain.strip_prefix("*.").unwrap_or(domain);
        grouped
            .entry(format!("_acme-challenge.{bare}"))
            .or_insert_with(Vec::new)
            .push(domain.clone());
    }
    Ok(grouped)
}
fn in_zone(owner: &str, zone: &str) -> bool {
    owner == zone
        || owner
            .strip_suffix(zone)
            .is_some_and(|prefix| prefix.ends_with('.'))
}
fn instructions(
    request: &SetupRequest,
    snapshot: &SetupSnapshot,
    grouped: BTreeMap<String, Vec<String>>,
) -> Result<Vec<SetupRecord>, CertificateError> {
    grouped
        .into_iter()
        .map(|(owner, identifiers)| {
            let (kind, values) = match &request.delegation {
                None => {
                    if identifiers.iter().any(|identifier| {
                        !in_zone(
                            identifier.strip_prefix("*.").unwrap_or(identifier),
                            &snapshot.zone_name,
                        )
                    }) {
                        return Err(CertificateError::DnsProviderInvalid);
                    }
                    ("TXT", vec![])
                }
                Some(Delegation::Cname { target_owner }) => {
                    if target_owner == &owner || !in_zone(target_owner, &snapshot.zone_name) {
                        return Err(CertificateError::DnsDelegationInvalid);
                    }
                    ("CNAME", vec![format!("{target_owner}.")])
                }
                Some(Delegation::Ns) => {
                    if owner != snapshot.zone_name {
                        return Err(CertificateError::DnsDelegationInvalid);
                    }
                    ("NS", vec![])
                }
            };
            Ok(SetupRecord {
                identifiers,
                original_owner: owner.clone(),
                instruction: Instruction {
                    r#type: kind,
                    owner,
                    values,
                },
                status: if request.delegation.is_none() {
                    SetupStatus::Ready
                } else {
                    SetupStatus::LookupFailed
                },
                observed_target: None,
            })
        })
        .collect()
}

impl ProxyRuntime {
    pub(crate) async fn dns_setup(
        &self,
        request: SetupRequest,
    ) -> Result<SetupResult, CertificateError> {
        timeout_at(Instant::now() + BUDGET, self.dns_setup_inner(request, None))
            .await
            .map_err(|_| CertificateError::DnsDelegationLookupFailed)?
    }

    async fn dns_setup_inner(
        &self,
        request: SetupRequest,
        fixture_resolver: Option<hickory_resolver::TokioResolver>,
    ) -> Result<SetupResult, CertificateError> {
        let grouped = domains(&request)?;
        let _permit = self
            .dns_assistant_admission
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        let deadline = Instant::now() + BUDGET;
        let snapshot = self
            .dns_connections
            .setup_snapshot(
                &request.connection_id,
                &request.zone_id,
                request.expected_revision,
            )
            .await
            .map_err(setup_connection_error)?;
        let mut results = instructions(&request, &snapshot, grouped)?;
        if let Some(delegation) = &request.delegation {
            let nameservers = if matches!(delegation, Delegation::Ns) {
                let get = async {
                    let provider = self
                        .dns_connections
                        .setup_provider(
                            &request.connection_id,
                            &request.zone_id,
                            request.expected_revision,
                        )
                        .await
                        .ok()?;
                    provider.setup_nameservers(&snapshot.zone_name).await.ok()
                };
                timeout_at(deadline.min(Instant::now() + Duration::from_secs(3)), get)
                    .await
                    .ok()
                    .flatten()
            } else {
                Some(Vec::new())
            };
            if let Some(nameservers) = nameservers {
                for record in &mut results {
                    if record.instruction.r#type == "NS" {
                        record.instruction.values =
                            nameservers.iter().map(|name| format!("{name}.")).collect();
                    }
                }
                if let Some(resolver) = fixture_resolver.or_else(|| {
                    super::manual_dns_propagation::resolver_for_environment(request.environment)
                        .ok()
                }) {
                    let mut pending = results.into_iter().enumerate();
                    let mut tasks = JoinSet::new();
                    let mut observed = BTreeMap::new();
                    loop {
                        while tasks.len() < MAX_CONCURRENT {
                            let Some((index, mut record)) = pending.next() else {
                                break;
                            };
                            let resolver = resolver.clone();
                            let zone = snapshot.zone_name.clone();
                            let delegation = delegation.clone();
                            let nameservers = nameservers.clone();
                            tasks.spawn(async move {
                                let desired = match &delegation {
                                    Delegation::Cname { target_owner } => {
                                        Some(target_owner.as_str())
                                    }
                                    Delegation::Ns => None,
                                };
                                let observation = timeout_at(
                                    deadline,
                                    dns_delegation::inspect_setup(
                                        &record.original_owner,
                                        &zone,
                                        desired,
                                        &nameservers,
                                        &resolver,
                                    ),
                                )
                                .await
                                .unwrap_or(SetupObservation::LookupFailed);
                                (record.status, record.observed_target) = match observation {
                                    SetupObservation::Ready(target) => {
                                        (SetupStatus::Ready, Some(target))
                                    }
                                    SetupObservation::Missing => (SetupStatus::Missing, None),
                                    SetupObservation::Conflicting(target) => {
                                        (SetupStatus::Conflicting, target)
                                    }
                                    SetupObservation::LookupFailed => {
                                        (SetupStatus::LookupFailed, None)
                                    }
                                };
                                (index, record)
                            });
                        }
                        let Some(joined) = tasks.join_next().await else {
                            break;
                        };
                        let (index, record) =
                            joined.map_err(|_| CertificateError::DnsDelegationLookupFailed)?;
                        observed.insert(index, record);
                    }
                    results = observed.into_values().collect();
                }
            } else {
                for record in &mut results {
                    record.status = SetupStatus::NameserversUnavailable;
                }
            }
        }
        let after = self
            .dns_connections
            .setup_snapshot(
                &request.connection_id,
                &request.zone_id,
                request.expected_revision,
            )
            .await
            .map_err(setup_connection_error)?;
        if after != snapshot {
            return Err(CertificateError::OperationInProgress);
        }
        Ok(SetupResult {
            connection_id: request.connection_id,
            connection_revision: snapshot.revision,
            zone_id: request.zone_id,
            zone_name: snapshot.zone_name,
            provider: snapshot.provider,
            dns_mode: request.dns_mode,
            checked_at: super::clock::utc_now(),
            results,
        })
    }

    pub(crate) async fn check_manual_dns(
        &self,
        id: &str,
        action: &ManualDnsActionRequest,
    ) -> Result<CheckResult, CertificateError> {
        timeout_at(
            Instant::now() + BUDGET,
            self.check_manual_dns_inner(id, action, None),
        )
        .await
        .map_err(|_| CertificateError::ManualDnsLookupFailed)?
    }

    async fn check_manual_dns_inner(
        &self,
        id: &str,
        action: &ManualDnsActionRequest,
        fixture_resolver: Option<hickory_resolver::TokioResolver>,
    ) -> Result<CheckResult, CertificateError> {
        let _permit = self
            .dns_assistant_admission
            .try_acquire()
            .map_err(|_| CertificateError::OperationInProgress)?;
        let (environment, before) = self
            .certificate_store
            .manual_dns_check_snapshot(id, action)
            .await?;
        let mut grouped: BTreeMap<String, Vec<ManualDnsRecord>> = BTreeMap::new();
        for record in &before.records {
            grouped
                .entry(record.owner.clone())
                .or_default()
                .push(record.clone());
        }
        let expired = manual_expired(&before.expires_at)?;
        let deadline = Instant::now() + BUDGET;
        let resolver = if expired {
            None
        } else {
            fixture_resolver.or_else(|| {
                super::manual_dns_propagation::resolver_for_environment(environment).ok()
            })
        };
        let mut pending = grouped.into_iter();
        let mut tasks = JoinSet::new();
        let mut records = Vec::new();
        loop {
            while tasks.len() < MAX_CONCURRENT {
                let Some((owner, values)) = pending.next() else {
                    break;
                };
                let resolver = resolver.clone();
                tasks.spawn(async move {
                    let identifiers = values
                        .iter()
                        .map(|record| record.identifier.clone())
                        .collect();
                    let status = if expired {
                        CheckStatus::Pending
                    } else if let Some(resolver) = resolver {
                        match timeout_at(
                            deadline,
                            super::manual_dns_propagation::check_records_with_resolver(
                                &values, &resolver,
                            ),
                        )
                        .await
                        {
                            Ok(Ok(())) => CheckStatus::Ready,
                            Ok(Err(CertificateError::ManualDnsNotPropagated)) => {
                                CheckStatus::Pending
                            }
                            _ => CheckStatus::LookupFailed,
                        }
                    } else {
                        CheckStatus::LookupFailed
                    };
                    CheckedRecord {
                        owner,
                        identifiers,
                        status,
                    }
                });
            }
            let Some(joined) = tasks.join_next().await else {
                break;
            };
            records.push(joined.map_err(|_| CertificateError::ManualDnsLookupFailed)?);
        }
        let (_, after) = self
            .certificate_store
            .manual_dns_check_snapshot(id, action)
            .await?;
        if before != after {
            return Err(CertificateError::OperationInProgress);
        }
        records.sort_by(|left, right| left.owner.cmp(&right.owner));
        let status = if manual_expired(&before.expires_at)? {
            CheckStatus::Expired
        } else if records
            .iter()
            .any(|record| record.status == CheckStatus::LookupFailed)
        {
            CheckStatus::LookupFailed
        } else if records
            .iter()
            .all(|record| record.status == CheckStatus::Ready)
        {
            CheckStatus::Ready
        } else {
            CheckStatus::Pending
        };
        Ok(CheckResult {
            certificate_id: id.to_owned(),
            operation_id: before.operation_id,
            challenge_set_id: before.challenge_set_id,
            checked_at: super::clock::utc_now(),
            expires_at: before.expires_at,
            status,
            records,
        })
    }
}
fn manual_expired(value: &str) -> Result<bool, CertificateError> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map(|expires| expires <= time::OffsetDateTime::now_utc())
        .map_err(|_| CertificateError::ManualDnsOrderInvalid)
}

#[cfg(test)]
#[path = "../../tests/private/dns_setup.rs"]
mod tests;

fn setup_connection_error(error: super::dns_connections::Error) -> CertificateError {
    match error {
        super::dns_connections::Error::ConnectionConflict => CertificateError::OperationInProgress,
        other => super::provider_connections::certificate_error(other),
    }
}
