use std::process::ExitCode;

use rentnerproxy_controller::run;

#[tokio::main]
async fn main() -> ExitCode {
    run().await
}
