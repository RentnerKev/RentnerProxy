use super::{
    BASELINE_PROBE_REVISION, EngineError, ProxyRuntime, RenderPurpose, RuntimeError,
    StagedCertificate,
    clock::{elapsed_millis, utc_now},
    state::{LAST_APPLY_FILE, atomic_write},
};
use crate::models::{ApplyOutcome, ValidatedProxyConfig};
use std::{
    sync::{Arc, atomic::Ordering},
    time::SystemTime,
};
use tokio::time::timeout;
use tracing::{info, warn};

impl ProxyRuntime {
    pub(crate) async fn apply(
        self: &Arc<Self>,
        configuration: ValidatedProxyConfig,
    ) -> Result<ApplyOutcome, RuntimeError> {
        let sequence = self.apply_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let runtime = Arc::clone(self);
        // Client disconnects cannot cancel a partially accepted activation.
        tokio::spawn(async move {
            let _guard = timeout(runtime.settings.lock_wait, runtime.apply_lock.lock())
                .await
                .map_err(|_| RuntimeError::Busy)?;
            if sequence != runtime.apply_sequence.load(Ordering::SeqCst) {
                return Err(RuntimeError::Busy);
            }
            runtime
                .apply_locked(configuration, None, Some(sequence))
                .await
        })
        .await
        .unwrap_or(Err(RuntimeError::ApplyFailed))
    }

    pub(crate) async fn apply_staged_for_active(
        self: &Arc<Self>,
        staged: StagedCertificate,
    ) -> Result<ApplyOutcome, RuntimeError> {
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let _guard = timeout(runtime.settings.lock_wait, runtime.apply_lock.lock())
                .await
                .map_err(|_| RuntimeError::Busy)?;
            if runtime.stopping.load(Ordering::SeqCst) {
                return Err(RuntimeError::Unavailable);
            }
            let configuration = runtime.active_configuration.lock().await.clone();
            if let Some(configuration) = configuration.filter(|config| {
                config
                    .proxy_hosts
                    .iter()
                    .any(|host| host.certificate_id.as_deref() == Some(staged.id()))
                    || config
                        .redirect_hosts
                        .iter()
                        .any(|host| host.certificate_id.as_deref() == Some(staged.id()))
            }) {
                return runtime
                    .apply_locked(configuration, Some(&staged), None)
                    .await;
            }
            runtime
                .certificate_store
                .commit_staged(&staged)
                .await
                .map_err(|_| RuntimeError::ApplyFailed)?;
            if let Err(error) = runtime.certificate_store.collect_garbage().await {
                warn!(
                    ?error,
                    stage = "certificate_gc",
                    "Certificate cleanup will retry later"
                );
            }
            Ok(ApplyOutcome::Unchanged)
        })
        .await
        .unwrap_or(Err(RuntimeError::ApplyFailed))
    }

    async fn apply_locked(
        &self,
        configuration: ValidatedProxyConfig,
        staged: Option<&StagedCertificate>,
        sequence: Option<u64>,
    ) -> Result<ApplyOutcome, RuntimeError> {
        let started_at = SystemTime::now();
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        if !self.state.lock().await.initialized {
            self.initialize_locked().await?;
        }
        self.ensure_running_locked().await?;
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        let json = self
            .render_proxy_config_for_apply(&configuration, staged, RenderPurpose::Activation)
            .await?;
        let host_sources = self.render_active_host_sources(&configuration)?;
        if sequence.is_some_and(|value| value != self.apply_sequence.load(Ordering::SeqCst)) {
            return Err(RuntimeError::Busy);
        }
        let (previous, previous_revision) = {
            let state = self.state.lock().await;
            (
                state.active_json.clone(),
                state
                    .active_revision
                    .clone()
                    .unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned()),
            )
        };
        let unchanged = previous == json && previous_revision == configuration.revision;
        if !unchanged {
            // Caddy validates/provisions the entire document transactionally. Rejection keeps old traffic.
            if let Err(error) = self.run_stage(engine.load(&json)).await {
                if error != EngineError::Rejected {
                    // A timeout/invalid response cannot establish whether /load completed.
                    // A new process eliminates any late completion from the uncertain request.
                    self.restore_verified_locked(&previous, &previous_revision, true)
                        .await;
                }
                warn!(revision = %configuration.revision, stage = "caddy_load", ?error, "Caddy apply failed");
                return Err(if error == EngineError::Unavailable {
                    RuntimeError::Unavailable
                } else {
                    RuntimeError::ApplyFailed
                });
            }
        }
        if let Err(error) = self.run_stage(engine.probe(&configuration.revision)).await {
            self.restore_verified_locked(&previous, &previous_revision, false)
                .await;
            warn!(revision = %configuration.revision, stage = "runtime_probe", ?error, "Caddy did not confirm activation");
            return Err(RuntimeError::ApplyFailed);
        }
        // Certificate metadata remains unchanged until the new material is actually served.
        if let Some(staged) = staged
            && self.certificate_store.commit_staged(staged).await.is_err()
        {
            self.restore_verified_locked(&previous, &previous_revision, false)
                .await;
            return Err(RuntimeError::ApplyFailed);
        }
        if self.persist_active_configuration(&configuration).is_err() {
            // This is only a recovery cache. PostgreSQL remains authoritative and startup reconciliation
            // repairs a stale cache; never claim failed proxy traffic after a verified successful load.
            warn!(revision = %configuration.revision, stage = "snapshot_cache", "Caddy recovery snapshot was not persisted");
        }
        let applied_at = if unchanged {
            self.state.lock().await.last_apply_at.clone()
        } else {
            Some(utc_now())
        };
        if let Some(applied_at) = &applied_at
            && atomic_write(
                &self.settings.state_dir.join(LAST_APPLY_FILE),
                applied_at.as_bytes(),
            )
            .is_err()
        {
            warn!(
                stage = "timestamp",
                "Caddy apply timestamp was not persisted"
            );
        }
        let mut state = self.state.lock().await;
        state.active_revision = Some(configuration.revision.clone());
        state.last_apply_at = applied_at;
        state.active_json = json;
        state.host_sources = host_sources;
        state.engine_available = true;
        drop(state);
        *self.active_configuration.lock().await = Some(configuration.clone());
        // Only collect old versions once both the served configuration and
        // the durable active pointer agree, while apply_lock still excludes
        // another activation or deletion. The store also protects candidates
        // and every certificate with an outstanding material lease.
        if staged.is_some()
            && let Err(error) = self.certificate_store.collect_garbage().await
        {
            warn!(
                ?error,
                stage = "certificate_gc",
                "Certificate cleanup will retry later"
            );
        }
        info!(revision = %configuration.revision, unchanged, duration_ms = elapsed_millis(started_at),
              hosts = configuration.proxy_hosts.len() + configuration.redirect_hosts.len(), "Caddy configuration verified");
        Ok(if unchanged {
            ApplyOutcome::Unchanged
        } else {
            ApplyOutcome::Applied
        })
    }

    async fn restore_verified_locked(&self, json: &str, revision: &str, force_restart: bool) {
        let Some(engine) = &self.engine else {
            return;
        };
        let recovered = if force_restart {
            false
        } else {
            self.run_stage(engine.load(json)).await.is_ok()
                && self.run_stage(engine.probe(revision)).await.is_ok()
        };
        if recovered {
            return;
        }
        self.mark_unavailable().await;
        let _ = engine.shutdown().await;
        if self.start_engine(engine, json, revision).await.is_ok() {
            self.state.lock().await.engine_available = true;
            info!(
                stage = "recovery",
                "Caddy restored the verified configuration"
            );
        } else {
            // The owned recovery worker will retry with bounded backoff.
            warn!(
                stage = "recovery",
                "Caddy remains unavailable; automatic recovery pending"
            );
        }
    }
}
