use super::AutomationError;
use crate::runtime::{ProxyRuntime, task::report_join_failure};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

impl ProxyRuntime {
    pub(crate) async fn start_ddns_scheduler(self: &Arc<Self>) {
        self.start_ddns_scheduler_inner(
            #[cfg(test)]
            None,
        )
        .await;
    }

    #[cfg(test)]
    pub(crate) async fn start_ddns_scheduler_with_gate(
        self: &Arc<Self>,
        gate: Arc<tokio::sync::RwLock<()>>,
    ) {
        self.start_ddns_scheduler_inner(Some(gate)).await;
    }

    async fn start_ddns_scheduler_inner(
        self: &Arc<Self>,
        #[cfg(test)] gate: Option<Arc<tokio::sync::RwLock<()>>>,
    ) {
        let mut task = self.ddns_task.lock().await;
        if task.is_some() || self.stopping.load(Ordering::SeqCst) {
            return;
        }
        let runtime = Arc::clone(self);
        *task = Some(tokio::spawn(async move {
            let mut failures = 0_u32;
            loop {
                if runtime.stopping.load(Ordering::SeqCst) {
                    break;
                }
                #[cfg(test)]
                let tick_lease = if let Some(gate) = &gate {
                    loop {
                        let wake = runtime.ddns_automation.wake.notified();
                        tokio::pin!(wake);
                        wake.as_mut().enable();
                        if runtime.stopping.load(Ordering::SeqCst) {
                            return;
                        }
                        tokio::select! {
                            lease = Arc::clone(gate).read_owned() => break Some(lease),
                            _ = wake => {},
                        }
                    }
                } else {
                    None
                };
                #[cfg(test)]
                if runtime.stopping.load(Ordering::SeqCst) {
                    break;
                }
                match runtime
                    .ddns_automation
                    .tick(&runtime.dns_connections, &runtime.ddns)
                    .await
                {
                    Ok(()) | Err(AutomationError::Busy) => failures = 0,
                    Err(AutomationError::Stopping) => break,
                    Err(error) => {
                        if failures == 0 {
                            tracing::warn!(
                                ?error,
                                "DDNS scheduler unavailable; retrying with backoff"
                            );
                        }
                        failures = failures.saturating_add(1).min(6);
                    }
                }
                #[cfg(test)]
                drop(tick_lease);
                let delay = Duration::from_secs(if failures == 0 {
                    5
                } else {
                    (5_u64 << failures).min(60)
                });
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {},
                    _ = runtime.ddns_automation.wake.notified() => {},
                }
            }
        }));
    }

    pub(in crate::runtime) async fn stop_ddns_scheduler_until(
        &self,
        deadline: tokio::time::Instant,
    ) {
        self.ddns_automation.stop_accepting();
        let Ok(mut slot) = tokio::time::timeout_at(deadline, self.ddns_task.lock()).await else {
            tracing::warn!(
                stage = "ddns_shutdown",
                "DDNS task slot exceeded shutdown deadline"
            );
            return;
        };
        if let Some(mut task) = slot.take() {
            drop(slot);
            // Finish an already admitted bounded batch. Forced termination
            // leaves the persisted in-flight marker for restart recovery.
            match tokio::time::timeout_at(deadline, &mut task).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => report_join_failure("ddns_scheduler", &error),
                Err(_) => {
                    task.abort();
                    let _ = tokio::time::timeout_at(deadline, task).await;
                    tracing::warn!(
                        "DDNS shutdown deadline exceeded; restart will reconcile the interrupted batch"
                    );
                }
            }
        }
    }
}
