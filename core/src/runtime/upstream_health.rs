use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::models::UpstreamPool;

use super::{ProxyRuntime, RuntimeError, clock::utc_now, renderer::upstream_dial};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MemberState {
    Available,
    Unavailable,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PoolState {
    Available,
    AllUnavailable,
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PoolHealth {
    host_id: String,
    revision: Option<String>,
    observed_at: Option<String>,
    state: PoolState,
    members: Vec<MemberHealth>,
}

#[derive(Debug, Serialize)]
struct MemberHealth {
    index: usize,
    host: String,
    port: u16,
    state: MemberState,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Observations {
    revision: String,
    host_id: String,
    observations: Vec<Instance>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Instance {
    instance: String,
    members: Vec<Member>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Member {
    index: usize,
    address: String,
    healthy: bool,
    available: bool,
}

impl PoolHealth {
    /// Retains configured target identities without inventing observations for missing runtime data.
    fn unknown(host_id: &str, revision: &str, pool: &UpstreamPool) -> Self {
        Self {
            host_id: host_id.to_owned(),
            revision: Some(revision.to_owned()),
            observed_at: None,
            state: PoolState::Unknown,
            members: pool
                .members
                .iter()
                .enumerate()
                .map(|(index, member)| MemberHealth {
                    index,
                    host: member.host.clone(),
                    port: member.port,
                    state: MemberState::Unknown,
                })
                .collect(),
        }
    }

    /// Accepts only complete, bounded observations for this exact revision and membership.
    /// Conflicting handler instances yield unknown; all-down requires unanimous unavailability.
    fn observe(&mut self, bytes: &[u8]) {
        let Ok(raw) = serde_json::from_slice::<Observations>(bytes) else {
            return;
        };
        if raw.host_id != self.host_id
            || Some(&raw.revision) != self.revision.as_ref()
            || raw.observations.is_empty()
            || raw.observations.len() > 64
        {
            return;
        }
        let mut tokens = HashSet::new();
        for observation in &raw.observations {
            if observation.instance.is_empty()
                || observation.instance.len() > 128
                || !observation
                    .instance
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                || !tokens.insert(&observation.instance)
                || observation.members.len() != self.members.len()
            {
                return;
            }
            for (expected, actual) in self.members.iter().zip(&observation.members) {
                if actual.index != expected.index
                    || actual.address != upstream_dial(&expected.host, expected.port)
                    || (actual.available && !actual.healthy)
                {
                    return;
                }
            }
        }
        for member in &mut self.members {
            let available = raw
                .observations
                .iter()
                .all(|instance| instance.members[member.index].available);
            let unavailable = raw
                .observations
                .iter()
                .all(|instance| !instance.members[member.index].available);
            member.state = if available {
                MemberState::Available
            } else if unavailable {
                MemberState::Unavailable
            } else {
                MemberState::Unknown
            };
        }
        self.state = if self
            .members
            .iter()
            .any(|member| member.state == MemberState::Available)
        {
            PoolState::Available
        } else if self
            .members
            .iter()
            .all(|member| member.state == MemberState::Unavailable)
        {
            PoolState::AllUnavailable
        } else {
            PoolState::Unknown
        };
        self.observed_at = Some(utc_now());
    }
}

impl ProxyRuntime {
    /// Samples Caddy's actual routing state without probes, reloads or persistent monitoring history.
    /// Concurrent configuration changes and stopped engines invalidate the entire observation.
    pub(crate) async fn upstream_health(&self, host_id: &str) -> Result<PoolHealth, RuntimeError> {
        let _permit = self
            .upstream_health_admission
            .try_acquire()
            .map_err(|_| RuntimeError::Busy)?;
        let apply_sequence = self
            .apply_sequence
            .load(std::sync::atomic::Ordering::SeqCst);
        let (revision, pool) = {
            let active = self.active_configuration.lock().await;
            let active = active.as_ref().ok_or(RuntimeError::Unavailable)?;
            let pool = active
                .proxy_hosts
                .iter()
                .find(|host| host.id == host_id)
                .and_then(|host| host.upstream_pool.clone())
                .ok_or(RuntimeError::HostConfigNotFound)?;
            (active.revision.clone(), pool)
        };
        let mut health = PoolHealth::unknown(host_id, &revision, &pool);
        let Some(engine) = &self.engine else {
            return Ok(health);
        };
        if !self.health_revision_is_active(&revision).await || !engine.is_running().await {
            return Ok(health);
        }
        // No independent probes, persistent history or inferred successes: sample
        // the handler instances serving this exact verified configuration.
        if let Ok(bytes) = engine.upstream_observations(host_id, &revision).await {
            health.observe(&bytes);
        }
        if apply_sequence
            != self
                .apply_sequence
                .load(std::sync::atomic::Ordering::SeqCst)
            || !self.health_revision_is_active(&revision).await
            || !engine.is_running().await
        {
            return Ok(PoolHealth::unknown(host_id, &revision, &pool));
        }
        Ok(health)
    }

    /// Requires both the verified configuration and runtime status to still identify this revision.
    async fn health_revision_is_active(&self, revision: &str) -> bool {
        let same_configuration = self
            .active_configuration
            .lock()
            .await
            .as_ref()
            .is_some_and(|configuration| configuration.revision == revision);
        let state = self.state.lock().await;
        same_configuration
            && state.engine_available
            && state.active_revision.as_deref() == Some(revision)
            && !self.stopping.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
#[path = "../../tests/private/upstream_health.rs"]
mod tests;
