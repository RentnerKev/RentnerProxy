use tokio::task::JoinError;

pub(super) fn report_join_failure(operation: &'static str, error: &JoinError) {
    // JoinError's Display/Debug may contain the panic payload, including secrets.
    tracing::error!(
        operation,
        task_id = %error.id(),
        panicked = error.is_panic(),
        cancelled = error.is_cancelled(),
        "Runtime task failed to complete"
    );
}

#[cfg(test)]
#[path = "../../tests/private/runtime_task.rs"]
mod tests;
