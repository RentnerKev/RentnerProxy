use super::AutomationError;
use crate::runtime::{ProxyRuntime, task::report_join_failure};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};

impl ProxyRuntime {
    pub(crate) async fn start_ddns_scheduler(self: &Arc<Self>) {
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
