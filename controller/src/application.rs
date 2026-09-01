use std::{error::Error, process::ExitCode, sync::Arc};

use crate::{
    config::Config,
    runtime::{ProcessEngine, ProxyEngine, ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state},
    shutdown::wait_for_shutdown,
};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

const CONTROLLER_LISTEN_ADDR_ENV: &str = "RENTNERPROXY_CONTROLLER_LISTEN_ADDR";

/// Performs a bounded in-container HTTP probe without adding a runtime HTTP client dependency.
pub async fn healthcheck(endpoint: &str) -> ExitCode {
    let path = match endpoint {
        "health" => "/health",
        "ready" => "/ready",
        _ => return ExitCode::FAILURE,
    };
    let configured_addr =
        std::env::var(CONTROLLER_LISTEN_ADDR_ENV).unwrap_or_else(|_| "127.0.0.1:8081".to_owned());
    let Ok(listen_addr) = configured_addr.parse::<std::net::SocketAddr>() else {
        return ExitCode::FAILURE;
    };
    let target_addr = if listen_addr.ip().is_unspecified() {
        match listen_addr {
            std::net::SocketAddr::V4(address) => {
                std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, address.port()))
            }
            std::net::SocketAddr::V6(address) => {
                std::net::SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, address.port()))
            }
        }
    } else {
        listen_addr
    };

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::{Duration, timeout},
    };

    let probe = async {
        let mut stream = TcpStream::connect(target_addr).await?;
        let request =
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await?;
        let mut response = Vec::with_capacity(512);
        stream.take(4_096).read_to_end(&mut response).await?;
        Ok::<_, std::io::Error>(response)
    };

    match timeout(Duration::from_secs(3), probe).await {
        Ok(Ok(response))
            if response.starts_with(b"HTTP/1.1 200 ") || response.starts_with(b"HTTP/1.0 200 ") =>
        {
            ExitCode::SUCCESS
        }
        Ok(Ok(_)) | Ok(Err(_)) | Err(_) => ExitCode::FAILURE,
    }
}

/// Initializes logging, runs the controller, and returns its process exit code.
pub async fn run() -> ExitCode {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize controller logging: {error}");
        return ExitCode::FAILURE;
    }

    info!(target: "rentnerproxy_controller", version = env!("CARGO_PKG_VERSION"), "controller starting");
    match serve().await {
        Ok(()) => {
            info!(target: "rentnerproxy_controller", "controller stopped");
            ExitCode::SUCCESS
        }
        Err(run_error) => {
            error!(target: "rentnerproxy_controller", error = %run_error, "controller failed");
            ExitCode::FAILURE
        }
    }
}

async fn serve() -> Result<(), Box<dyn Error + Send + Sync>> {
    let config = Config::from_env()?;
    let listener = TcpListener::bind(config.listen_addr).await?;
    let local_addr = listener.local_addr()?;
    let mut settings = RuntimeSettings::new(config.proxy_state_dir.clone(), config.proxy_http_port);
    settings.https_port = config.proxy_https_port;
    settings.public_https_port = config.proxy_public_https_port;
    settings.system_ca_bundle = config.system_ca_bundle;
    settings.controller_port = local_addr.port();
    let engine = config.proxy_engine_bin.map(|binary| {
        Arc::new(ProcessEngine::new(
            binary,
            config.proxy_state_dir.clone(),
            settings.probe_socket(),
        )) as Arc<dyn ProxyEngine>
    });
    let runtime = ProxyRuntime::new(settings, engine);
    info!(target: "rentnerproxy_controller", %local_addr, "controller listening");
    runtime.initialize().await;
    let state = AppState::new(runtime.clone(), config.controller_token);
    runtime
        .start_renewal_scheduler(state.challenges.clone())
        .await;
    let result = axum::serve(listener, app_with_state(state))
        .with_graceful_shutdown(wait_for_shutdown())
        .await;
    runtime.shutdown().await;
    result?;
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
