use std::{
    io,
    sync::{Arc, Mutex},
};

use super::report_join_failure;

#[derive(Clone)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn diagnostic(error: &tokio::task::JoinError) -> serde_json::Value {
    let output = Captured(Arc::new(Mutex::new(Vec::new())));
    let writer = output.clone();
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::with_default(subscriber, || {
        report_join_failure("test_operation", error);
    });
    let bytes = output.0.lock().unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("private-panic-payload"));
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn join_diagnostics_classify_panics_without_exposing_the_payload() {
    let error = tokio::spawn(async { panic!("private-panic-payload") })
        .await
        .unwrap_err();
    let fields = diagnostic(&error);
    assert_eq!(fields["fields"]["operation"], "test_operation");
    assert_eq!(fields["fields"]["panicked"], true);
    assert_eq!(fields["fields"]["cancelled"], false);
    assert!(fields["fields"]["task_id"].is_string());
}

#[tokio::test]
async fn join_diagnostics_classify_cancelled_tasks() {
    let task = tokio::spawn(std::future::pending::<()>());
    task.abort();
    let error = task.await.unwrap_err();
    let fields = diagnostic(&error);
    assert_eq!(fields["fields"]["panicked"], false);
    assert_eq!(fields["fields"]["cancelled"], true);
}
