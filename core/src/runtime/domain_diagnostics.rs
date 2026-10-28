mod dns;
mod models;
mod resolver;
mod upstream;
use super::ProxyRuntime;
use crate::models::{ProxyHost, TrustedCa};
use models::{Code, HostType, Stage, Stages, Status};
pub(crate) use models::{Request, Result};
use std::{sync::atomic::Ordering, time::Duration};
use tokio::time::{Instant, timeout_at};

// Admission caps this registry at two entries. The key deliberately excludes
// revision and domain so a host edit cannot bypass an executing check.
#[derive(Default)]
pub(super) struct ActiveChecks(std::sync::Mutex<std::collections::HashSet<(HostType, String)>>);
struct ActiveCheck<'a> {
    checks: &'a ActiveChecks,
    key: (HostType, String),
}
impl ActiveChecks {
    fn acquire(&self, request: &Request) -> std::result::Result<ActiveCheck<'_>, Error> {
        let key = (request.host_type, request.host_id.clone());
        let registry_key = key.clone();
        let mut checks = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if !checks.insert(registry_key) {
            return Err(Error::Busy);
        }
        Ok(ActiveCheck { checks: self, key })
    }
}
impl Drop for ActiveCheck<'_> {
    fn drop(&mut self) {
        self.checks
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.key);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    InvalidInput,
    Busy,
    Unavailable,
}
#[derive(Clone, PartialEq, Eq)]
struct Snapshot {
    revision: Option<String>,
    sequence: u64,
    ready: bool,
    member: bool,
    proxy: Option<ProxyHost>,
    cas: Vec<TrustedCa>,
}
impl ProxyRuntime {
    // Clone under apply_lock, release state/config guards before the read-only
    // engine liveness call. Never control the engine or materialize files here.
    async fn diagnostic_snapshot(&self, request: &Request) -> Snapshot {
        let state = self.state.lock().await;
        let revision = state.active_revision.clone();
        let cached_ready = state.initialized
            && state.engine_available
            && self.engine.is_some()
            && !self.stopping.load(Ordering::SeqCst);
        drop(state);
        let configuration = self.active_configuration.lock().await;
        let mut proxy = None;
        let mut member = false;
        let mut cas = Vec::new();
        if let Some(configuration) = configuration.as_ref()
            && configuration.revision == revision.as_deref().unwrap_or("")
        {
            match request.host_type {
                HostType::Proxy => {
                    proxy = configuration
                        .proxy_hosts
                        .iter()
                        .find(|host| {
                            host.id == request.host_id && host.domains.contains(&request.domain)
                        })
                        .cloned();
                    member = proxy.is_some();
                }
                HostType::Redirect => {
                    member = configuration.redirect_hosts.iter().any(|host| {
                        host.id == request.host_id && host.domains.contains(&request.domain)
                    });
                }
            }
            if let Some(id) = proxy
                .as_ref()
                .and_then(|host| host.upstream_tls.as_ref())
                .and_then(|tls| tls.trusted_ca_id.as_ref())
            {
                cas.extend(
                    configuration
                        .trusted_cas
                        .iter()
                        .filter(|ca| &ca.id == id)
                        .cloned(),
                );
            }
        }
        drop(configuration);
        let ready = cached_ready
            && match &self.engine {
                Some(engine) => engine.is_running().await,
                None => false,
            };
        Snapshot {
            revision,
            sequence: self.apply_sequence.load(Ordering::SeqCst),
            ready,
            member,
            proxy,
            cas,
        }
    }
    pub(crate) async fn diagnose_domain(
        &self,
        request: Request,
    ) -> std::result::Result<Result, Error> {
        self.diagnose_domain_inner(request, None).await
    }
    async fn diagnose_domain_inner(
        &self,
        request: Request,
        fixture_resolver: Option<hickory_resolver::TokioResolver>,
    ) -> std::result::Result<Result, Error> {
        self.diagnose_domain_budget(
            request,
            fixture_resolver.map(resolver::Resolver::provided),
            Duration::from_secs(12),
        )
        .await
    }
    async fn diagnose_domain_budget(
        &self,
        request: Request,
        fixture_resolver: Option<resolver::Resolver>,
        budget: Duration,
    ) -> std::result::Result<Result, Error> {
        request.validate()?;
        let _permit = self
            .diagnostics_admission
            .try_acquire()
            .map_err(|_| Error::Busy)?;
        let _active = self.diagnostics_active.acquire(&request)?;
        let start = Instant::now();
        let deadline = start + budget;
        let network_deadline = deadline - budget.div_f64(12.0).min(Duration::from_secs(1));
        let snapshot = timeout_at(network_deadline, async {
            let _guard = self.apply_lock.try_lock().map_err(|_| Error::Busy)?;
            Ok(self.diagnostic_snapshot(&request).await)
        })
        .await
        .map_err(|_| Error::Unavailable)??;
        let config = if !snapshot.ready {
            Stage::new(Status::Unknown, Code::RuntimeUnavailable)
        } else if !snapshot.member {
            Stage::new(Status::Unknown, Code::HostNotActive)
        } else if snapshot.revision.as_deref() != Some(request.expected_revision.as_str()) {
            Stage::new(Status::Unknown, Code::ConfigurationStale)
        } else {
            Stage::new(Status::Passed, Code::ConfigurationActive)
        };
        let mut result = Result {
            host_type: request.host_type,
            host_id: request.host_id.clone(),
            domain: request.domain.clone(),
            expected_revision: request.expected_revision.clone(),
            active_revision: snapshot.revision.clone(),
            checked_at: super::clock::utc_now(),
            observation_point: "appliance",
            public_reachability: "not_checked",
            stages: Stages {
                configuration: config.elapsed(start),
                dns: Stage::skipped(),
                upstream: Stage::skipped(),
                tls: Stage::skipped(),
            },
        };
        if result.stages.configuration.status != Status::Passed {
            return Ok(result);
        }
        let wildcard = request.domain.starts_with("*.");
        let resolver = fixture_resolver
            .map(Ok)
            .unwrap_or_else(resolver::Resolver::system);
        if request.upstream_only {
            // Scheduled checks observe only the active upstream, never public DNS.
        } else if wildcard {
            result.stages.dns = Stage::new(Status::NotApplicable, Code::WildcardDomain);
        } else {
            let dns_start = Instant::now();
            let stage_deadline = network_deadline.min(dns_start + Duration::from_secs(3));
            result.stages.dns = match &resolver {
                Ok(resolver) => {
                    match dns::addresses(&resolver.dns, &request.domain, stage_deadline).await {
                        Ok(addresses) => {
                            let mut stage =
                                Stage::new(Status::Passed, Code::DnsResolved).elapsed(dns_start);
                            stage.addresses =
                                addresses.into_iter().map(|ip| ip.to_string()).collect();
                            stage
                        }
                        Err(error) => error.stage(dns_start),
                    }
                }
                Err(error) => error.stage(dns_start),
            };
        }
        if wildcard {
            result.stages.upstream = Stage::new(Status::NotApplicable, Code::WildcardDomain);
            result.stages.tls = Stage::new(Status::NotApplicable, Code::WildcardDomain);
        } else if request.host_type == HostType::Redirect {
            result.stages.upstream = Stage::new(Status::NotApplicable, Code::RedirectHost);
            result.stages.tls = Stage::new(Status::NotApplicable, Code::RedirectHost);
        } else if let Some(host) = &snapshot.proxy {
            let upstream_start = Instant::now();
            let shared_deadline = request.timeout_ms.map(|timeout| {
                network_deadline.min(upstream_start + Duration::from_millis(u64::from(timeout)))
            });
            let stage_deadline = shared_deadline
                .unwrap_or_else(|| network_deadline.min(upstream_start + Duration::from_secs(3)));
            let resolved = if let Ok(ip) = host.forward_host.parse() {
                Ok(vec![ip])
            } else {
                match &resolver {
                    Ok(resolver) => {
                        resolver
                            .upstream_addresses(&host.forward_host, stage_deadline)
                            .await
                    }
                    Err(error) => Err(*error),
                }
            };
            match resolved {
                Ok(addresses) => {
                    (result.stages.upstream, result.stages.tls) = upstream::probe(
                        host,
                        &request.domain,
                        &addresses,
                        &snapshot.cas,
                        &self.settings.system_ca_bundle,
                        shared_deadline.unwrap_or_else(|| {
                            network_deadline.min(Instant::now() + Duration::from_secs(3))
                        }),
                    )
                    .await;
                    result.stages.upstream.duration_ms =
                        upstream_start.elapsed().as_millis().min(12_000) as u32;
                }
                Err(error) => {
                    result.stages.upstream = Stage::new(
                        Status::Failed,
                        if matches!(error, dns::DnsError::Timeout) {
                            Code::UpstreamTimeout
                        } else {
                            Code::UpstreamDnsFailed
                        },
                    )
                    .elapsed(upstream_start);
                    result.stages.tls = if host.forward_scheme == "http" {
                        Stage::new(Status::NotApplicable, Code::HttpUpstream)
                    } else {
                        Stage::new(
                            Status::Unknown,
                            if host.upstream_tls.as_ref().is_some_and(|tls| !tls.verify) {
                                Code::TlsVerificationDisabled
                            } else {
                                Code::TlsUnconfirmed
                            },
                        )
                    };
                }
            }
        }
        let after = timeout_at(deadline, async {
            let _guard = self.apply_lock.lock().await;
            self.diagnostic_snapshot(&request).await
        })
        .await
        .ok();
        if after.as_ref() != Some(&snapshot) {
            result.active_revision = after.and_then(|snapshot| snapshot.revision);
            result.stages.configuration =
                Stage::new(Status::Unknown, Code::ConfigurationChanged).elapsed(start);
            result.stages.dns = Stage::skipped();
            result.stages.upstream = Stage::skipped();
            result.stages.tls = Stage::skipped();
        }
        result.checked_at = super::clock::utc_now();
        Ok(result)
    }
}

#[cfg(test)]
#[path = "../../tests/private/domain_diagnostics.rs"]
mod tests;
