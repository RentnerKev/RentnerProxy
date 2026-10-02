use std::process::ExitCode;

use rentnerproxy_controller::{healthcheck, run};

#[tokio::main]
async fn main() -> ExitCode {
    let mut arguments = std::env::args();
    let _program = arguments.next();
    let command = arguments.next();
    if command.as_deref() == Some("--healthcheck") {
        let endpoint = arguments.next().unwrap_or_else(|| "ready".to_owned());
        return healthcheck(&endpoint).await;
    }

    run().await
}
