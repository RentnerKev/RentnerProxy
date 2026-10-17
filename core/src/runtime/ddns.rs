mod automation;
mod discovery;
#[cfg(test)]
#[path = "../../tests/private/ddns/fixture.rs"]
mod fixture;
mod http;
mod models;
mod provider;
#[cfg(test)]
#[path = "../../tests/private/ddns.rs"]
mod tests;
mod validation;
mod worker;

pub(crate) use automation::{Action, Automation, AutomationError, SaveConfiguration};

use super::dns_connections::{self, Store};
use models::{
    BatchResult, CurrentRecord, Failure, RecordType, Selection, Status, Target, TargetResult,
};
pub(crate) use models::{Error, Request};
use provider::{Provider, Record};
use std::{net::IpAddr, time::Duration};
use tokio::{
    sync::Mutex,
    time::{Instant, timeout_at},
};

#[derive(Clone, Copy)]
struct Cooldown {
    until: Instant,
    error: Error,
}
pub(crate) struct Engine {
    run: Mutex<Option<Cooldown>>,
    #[cfg(test)]
    discovery_urls: Option<[String; 2]>,
    #[cfg(test)]
    budget: Option<Duration>,
}
impl Engine {
    pub(crate) fn new() -> Self {
        Self {
            run: Mutex::new(None),
            #[cfg(test)]
            discovery_urls: None,
            #[cfg(test)]
            budget: None,
        }
    }
    fn discovery_url(&self, family: RecordType) -> &str {
        #[cfg(test)]
        if let Some(urls) = &self.discovery_urls {
            return &urls[usize::from(family == RecordType::Aaaa)];
        }
        match family {
            RecordType::A => discovery::IPV4_URL,
            RecordType::Aaaa => discovery::IPV6_URL,
        }
    }
    fn budget(&self) -> Duration {
        #[cfg(test)]
        if let Some(budget) = self.budget {
            return budget;
        }
        Duration::from_secs(25)
    }
    async fn cooldown(&self, duration: Option<(Duration, Error)>) -> Result<(), Error> {
        let mut run = self.run.try_lock().map_err(|_| Error::Busy)?;
        *run = duration.map(|(duration, error)| Cooldown {
            until: Instant::now() + duration,
            error,
        });
        Ok(())
    }
    pub(crate) async fn execute(
        &self,
        store: &Store,
        request: Request,
        preview: bool,
    ) -> Result<BatchResult, Error> {
        validation::request(&request)?;
        let mut run = self.run.try_lock().map_err(|_| Error::Busy)?;
        let active_cooldown = (*run).filter(|cooldown| cooldown.until > Instant::now());
        let mut cooldown_error =
            active_cooldown.map_or(Error::ProviderRateLimited, |cooldown| cooldown.error);
        let mut cooldown = active_cooldown.map(|cooldown| {
            cooldown
                .until
                .saturating_duration_since(Instant::now())
                .as_secs()
                .saturating_add(1)
                .min(86_400) as u32
        });
        let deadline = Instant::now() + self.budget();
        let requested_targets = &request.targets;
        let discover = |family: RecordType, enabled: bool| async move {
            if !enabled
                || !requested_targets
                    .iter()
                    .any(|target| target.record_type == family)
            {
                return Err(Error::FamilyDisabled);
            }
            if cooldown.is_some() {
                return Err(cooldown_error);
            }
            discovery::discover(self.discovery_url(family), family, deadline).await
        };
        let (ipv4, ipv6) = tokio::join!(
            discover(RecordType::A, request.ipv4),
            discover(RecordType::Aaaa, request.ipv6)
        );
        let client = http::client()?;
        let mut targets = Vec::with_capacity(request.targets.len());
        for target in &request.targets {
            let address = match target.record_type {
                RecordType::A => ipv4,
                RecordType::Aaaa => ipv6,
            };
            let mut result = match address {
                Err(Error::FamilyDisabled) => {
                    let mut result = TargetResult::new(target, Status::Skipped);
                    result.error = Some(Error::FamilyDisabled);
                    result
                }
                _ if cooldown.is_some() => {
                    let mut result = TargetResult::new(target, Status::Skipped);
                    result.error = Some(cooldown_error);
                    result.retry_after_seconds = cooldown;
                    result
                }
                Err(error) => TargetResult::failed(target, error),
                Ok(address) => {
                    if Instant::now() >= deadline {
                        let mut result = TargetResult::new(target, Status::Skipped);
                        result.error = Some(Error::TimeBudgetExceeded);
                        result
                    } else {
                        self.target(store, target, address, preview, deadline, &client)
                            .await
                    }
                }
            };
            if result.status == Status::Failed
                && (result.error == Some(Error::ProviderRateLimited)
                    || (result.error == Some(Error::ProviderUnavailable)
                        && result.retry_after_seconds.is_some()))
            {
                let seconds = result.retry_after_seconds.unwrap_or(1);
                cooldown_error = result.error.unwrap_or(Error::ProviderRateLimited);
                *run = Some(Cooldown {
                    until: Instant::now() + Duration::from_secs(u64::from(seconds)),
                    error: cooldown_error,
                });
                cooldown = Some(seconds);
            }
            result.desired_address = address.ok();
            targets.push(result);
        }
        tracing::info!(
            actor_user_id = request.actor_user_id,
            preview,
            targets = targets.len(),
            updated = targets
                .iter()
                .filter(|target| target.status == Status::Updated)
                .count(),
            "DDNS record comparison completed"
        );
        Ok(BatchResult {
            preview,
            ipv4: ipv4.ok(),
            ipv6: ipv6.ok(),
            targets,
        })
    }

    async fn target(
        &self,
        store: &Store,
        target: &Target,
        address: IpAddr,
        preview: bool,
        deadline: Instant,
        client: &reqwest::Client,
    ) -> TargetResult {
        let access = match timeout_at(
            deadline,
            store.record_access(&target.connection_id, &target.zone_id),
        )
        .await
        {
            Ok(Ok(access)) => access,
            Ok(Err(dns_connections::Error::ZoneNotPermitted)) => {
                return TargetResult::failed(target, Error::ZoneNotPermitted);
            }
            Ok(Err(_)) => return TargetResult::failed(target, Error::ConnectionUnavailable),
            Err(_) => return TargetResult::failed(target, Error::TimeBudgetExceeded),
        };
        if !validation::in_zone(&target.name, &access.zone_name) {
            return TargetResult::failed(target, Error::NameOutsideZone);
        }
        let provider = match Provider::new(client.clone(), access.endpoint, &access.token, deadline)
        {
            Ok(provider) => provider,
            Err(failure) => return failure_result(target, failure),
        };
        match self.compare(&provider, target, address, preview).await {
            Ok(result) => result,
            Err(failure) => failure_result(target, failure),
        }
    }

    async fn compare(
        &self,
        provider: &Provider<'_>,
        target: &Target,
        address: IpAddr,
        preview: bool,
    ) -> Result<TargetResult, Failure> {
        let records = provider.records(target).await?;
        if records.iter().any(|record| record.kind == "CNAME") {
            return Err(Error::RecordConflict.into());
        }
        let mut matching = records
            .iter()
            .filter(|record| record.kind == target.record_type.as_str());
        let existing = matching.next();
        if matching.next().is_some() {
            return Err(Error::RecordConflict.into());
        }
        let mut result = TargetResult::new(target, Status::Unchanged);
        if let Some(record) = existing {
            result.current = Some(current(record, target.record_type)?);
            if record.comment.as_deref().is_some_and(|comment| {
                comment.starts_with("rentnerproxy-ddns:") && comment != provider::marker(target)
            }) {
                return Err(Error::RecordConflict.into());
            }
        }
        match (&target.selection, existing) {
            (Selection::Inspect, _) => {
                result.status = if preview {
                    if existing.is_some() {
                        Status::AdoptionRequired
                    } else {
                        Status::CreationRequired
                    }
                } else {
                    Status::Skipped
                };
                result.error = Some(if existing.is_some() {
                    Error::AdoptionRequired
                } else {
                    Error::CreationRequired
                });
                return Ok(result);
            }
            (Selection::Create, Some(record))
                if record.comment.as_deref() != Some(provider::marker(target).as_str()) =>
            {
                return Err(Error::RecordConflict.into());
            }
            (Selection::Adopt { record_id }, Some(record)) if record_id != &record.id => {
                return Err(Error::RecordChanged.into());
            }
            (Selection::Adopt { .. }, None) => return Err(Error::RecordChanged.into()),
            _ => {}
        }
        if let Some(record) = &result.current
            && record.address == address
            && record.proxied == target.proxied
        {
            return Ok(result);
        }
        if preview {
            result.status = if existing.is_some() {
                Status::WouldUpdate
            } else {
                Status::WouldCreate
            };
            return Ok(result);
        }
        // Re-read immediately before writing. External changes can still race
        // separate provider requests; never adopt a replacement record.
        let latest = provider.records(target).await?;
        if !same_records(&records, &latest) {
            return Err(Error::RecordChanged.into());
        }
        let written = provider.write(target, address, existing).await?;
        result.current = Some(current(&written, target.record_type)?);
        result.status = Status::Updated;
        Ok(result)
    }
}

fn current(record: &Record, family: RecordType) -> Result<CurrentRecord, Failure> {
    Ok(CurrentRecord {
        id: record.id.clone(),
        address: record.address(family)?,
        proxied: record.proxied.ok_or(Error::InvalidProviderResponse)?,
    })
}
fn same_records(before: &[Record], after: &[Record]) -> bool {
    // Other record types are never written, but changes at this owner invalidate
    // the pre-write check rather than hiding a newly introduced conflict.
    before.len() == after.len()
        && before.iter().all(|a| {
            after.iter().any(|b| {
                a.id == b.id
                    && a.name == b.name
                    && a.kind == b.kind
                    && a.content == b.content
                    && a.proxied == b.proxied
                    && a.comment == b.comment
            })
        })
}
fn failure_result(target: &Target, failure: Failure) -> TargetResult {
    TargetResult {
        retry_after_seconds: failure.retry_after,
        ..TargetResult::failed(target, failure.code)
    }
}
