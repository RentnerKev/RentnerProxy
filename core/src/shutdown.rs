use tokio::signal;

pub(crate) mod http;

// Bash's integer SECONDS can shorten the supervisor's 23-second consumer
// phase by almost a second. Leave a further margin before its forced stop.
pub(crate) const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

pub(crate) async fn wait_for_shutdown() {
    #[cfg(unix)]
    {
        let mut terminate = match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(error) => {
                tracing::error!(%error, "failed to install SIGTERM handler; waiting for Ctrl+C");
                if let Err(error) = signal::ctrl_c().await {
                    tracing::error!(%error, "failed while waiting for Ctrl+C");
                }
                return;
            }
        };

        tokio::select! {
            result = signal::ctrl_c() => {
                if let Err(error) = result {
                    tracing::error!(%error, "failed while waiting for Ctrl+C");
                }
            }
            _ = terminate.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        if let Err(error) = signal::ctrl_c().await {
            tracing::error!(%error, "failed while waiting for Ctrl+C");
        }
    }
}
