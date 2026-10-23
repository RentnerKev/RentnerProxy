//! Explicitly started by the cross-language Beta 2 integration runner. The
//! injected provider/discovery URLs exist only in this test build.
use super::Engine;
use crate::{
    config::Config,
    runtime::{CaddyProcess, ProxyEngine, ProxyRuntime, RuntimeSettings, dns_connections::Store},
    server::{AppState, app_with_state},
};
use serde::Deserialize;
use std::{path::PathBuf, sync::Arc, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureConfiguration {
    run_id: String,
    directory: PathBuf,
    provider_url: String,
    ipv4_url: String,
    ipv6_url: String,
    http_port: u16,
    https_port: u16,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "started by .github/scripts/ci/beta2/run.ts with isolated PostgreSQL/Valkey and Caddy"]
async fn beta2_integration_controller() {
    let configuration_path = PathBuf::from(
        std::env::var_os("RENTNERPROXY_BETA2_FIXTURE").expect("explicit fixture configuration"),
    );
    let configuration: FixtureConfiguration =
        serde_json::from_slice(&std::fs::read(configuration_path).unwrap()).unwrap();
    assert!(configuration.run_id.len() == 32);
    assert!(
        configuration
            .run_id
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    );
    // The Linux launcher owns /tmp independently of the caller's TMPDIR.
    assert_eq!(
        configuration.directory.parent(),
        Some(std::path::Path::new("/tmp"))
    );
    assert_eq!(
        configuration
            .directory
            .file_name()
            .unwrap()
            .to_str()
            .unwrap(),
        format!("rentnerproxy-beta2-{}", configuration.run_id)
    );
    for endpoint in [
        &configuration.provider_url,
        &configuration.ipv4_url,
        &configuration.ipv6_url,
    ] {
        let endpoint = reqwest::Url::parse(endpoint).unwrap();
        assert_eq!(endpoint.scheme(), "http");
        assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
    }
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("explicit Caddy fixture binary"),
    )
    .canonicalize()
    .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let state = configuration.directory.join("controller");
    let mut settings = RuntimeSettings::new(state.clone(), configuration.http_port);
    settings.https_port = configuration.https_port;
    settings.controller_addr = address;
    let engine: Arc<dyn ProxyEngine> = Arc::new(CaddyProcess::new(binary, state.clone()));
    let mut runtime = ProxyRuntime::new(settings, Some(engine));
    let owner = Arc::get_mut(&mut runtime).unwrap();
    owner.dns_connections = Store::fixture(state, configuration.provider_url);
    owner.ddns = Engine {
        discovery_urls: Some([configuration.ipv4_url, configuration.ipv6_url]),
        ..Engine::new()
    };
    runtime.initialize().await;
    runtime.start_recovery_worker().await;
    runtime.start_ddns_scheduler().await;
    runtime.docker_discovery.start().await;
    let token = Config::from_values(None, Some(&configuration.run_id), None, None, None, false)
        .unwrap()
        .controller_token
        .unwrap();
    let app = app_with_state(AppState::new(runtime.clone(), Some(token)));
    let (stop, stopping) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopping.await;
            })
            .await
            .unwrap();
    });
    std::fs::write(
        configuration.directory.join("ready.json"),
        serde_json::to_vec(&serde_json::json!({"url":format!("http://{address}")})).unwrap(),
    )
    .unwrap();
    let completed = tokio::time::timeout(Duration::from_secs(600), async {
        while !configuration.directory.join("stop").exists() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
    runtime.begin_shutdown();
    let _ = stop.send(());
    runtime.shutdown().await;
    tokio::time::timeout(Duration::from_secs(10), server)
        .await
        .unwrap()
        .unwrap();
    assert!(
        completed.is_ok(),
        "integration runner exceeded its fixture lifetime"
    );
}
