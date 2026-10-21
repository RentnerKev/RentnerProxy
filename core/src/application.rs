use std::{
    error::Error,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr},
    process::ExitCode,
    sync::Arc,
};

use crate::{
    config::Config,
    runtime::{CaddyProcess, ProxyEngine, ProxyRuntime, RuntimeSettings},
    server::{AppState, app_with_state},
    shutdown::wait_for_shutdown,
};
use tokio::net::TcpListener;
use tracing::{error, info};
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

const CONTROLLER_LISTEN_ADDR_ENV: &str = "RENTNERPROXY_CONTROLLER_LISTEN_ADDR";

#[cfg(test)]
#[path = "../tests/private/application.rs"]
mod tests;

fn controller_connect_addr(listen_addr: SocketAddr) -> SocketAddr {
    if listen_addr.ip().is_unspecified() {
        match listen_addr {
            SocketAddr::V4(address) => SocketAddr::from((Ipv4Addr::LOCALHOST, address.port())),
            SocketAddr::V6(address) => SocketAddr::from((Ipv6Addr::LOCALHOST, address.port())),
        }
    } else {
        listen_addr
    }
}

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
    let target_addr = controller_connect_addr(listen_addr);

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

pub async fn run() -> ExitCode {
    if let Err(error) = init_tracing() {
        eprintln!("failed to initialize controller logging: {error}");
        return ExitCode::FAILURE;
    }

    info!(target: "rentnerproxy_controller", version = crate::version::version(), "controller starting");
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
    settings.trusted_proxy_cidrs = config.proxy_trusted_proxy_cidrs;
    settings.system_ca_bundle = config.system_ca_bundle;
    settings.controller_addr = controller_connect_addr(local_addr);
    settings.crowdsec_control_dir = "/run/rentnerproxy/crowdsec".into();
    settings.crowdsec_state_dir = "/var/lib/rentnerproxy/crowdsec".into();
    let engine = config.caddy_bin.map(|binary| {
        Arc::new(CaddyProcess::new(binary, config.proxy_state_dir.clone())) as Arc<dyn ProxyEngine>
    });
    let runtime = ProxyRuntime::new(settings, engine);
    info!(target: "rentnerproxy_controller", %local_addr, "controller listening");
    runtime.initialize().await;
    runtime.start_recovery_worker().await;
    let state = AppState::new(runtime.clone(), config.controller_token);
    runtime
        .start_renewal_scheduler(state.challenges.clone())
        .await;
    runtime.start_ddns_scheduler().await;
    runtime.docker_discovery.start().await;
    let stopping_runtime = Arc::clone(&runtime);
    let (result, deadline) = crate::shutdown::http::serve_with_drain(
        listener,
        app_with_state(state),
        async move {
            wait_for_shutdown().await;
            let deadline = tokio::time::Instant::now() + crate::shutdown::SHUTDOWN_TIMEOUT;
            stopping_runtime.begin_shutdown();
            deadline
        },
        std::time::Duration::from_secs(2),
    )
    .await;
    runtime.shutdown_until(deadline).await;
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
