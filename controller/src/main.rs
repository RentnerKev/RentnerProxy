use std::{error::Error, process::ExitCode};

use rentnerproxy_controller::{config::Config, server::app, shutdown::wait_for_shutdown};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize controller logging: {error}");
        return ExitCode::FAILURE;
    }

    info!(version = env!("CARGO_PKG_VERSION"), "controller starting");

    match run().await {
        Ok(()) => {
            info!("controller stopped");
            ExitCode::SUCCESS
        }
        Err(run_error) => {
            error!(error = %run_error, "controller failed");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn Error + Send + Sync>> {
    let config = Config::from_env()?;
    let listener = TcpListener::bind(config.listen_addr).await?;
    let local_addr = listener.local_addr()?;
    info!(%local_addr, "controller listening");

    axum::serve(listener, app())
        .with_graceful_shutdown(wait_for_shutdown())
        .await?;

    Ok(())
}

fn init_tracing() -> Result<(), Box<dyn Error + Send + Sync>> {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .with_regex(false)
        .from_env_lossy();

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .try_init()?;

    Ok(())
}
