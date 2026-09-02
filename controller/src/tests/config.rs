use std::{
    fs,
    net::SocketAddr,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use crate::config::{
    CONTROLLER_TOKEN_ENV, CONTROLLER_TOKEN_FILE_ENV, Config, ConfigError,
    read_controller_token_sources,
};

static NEXT_SECRET_FILE: AtomicU64 = AtomicU64::new(0);

fn valid_token() -> &'static str {
    "0123456789abcdef0123456789abcdef"
}

fn secret_file(contents: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-controller-secret-{}-{}",
        std::process::id(),
        NEXT_SECRET_FILE.fetch_add(1, Ordering::Relaxed),
    ));
    fs::write(&path, contents)
        .unwrap_or_else(|error| panic!("secret fixture should be writable: {error}"));
    path
}

#[test]
fn defaults_to_loopback_controller_port_and_temporary_development_state() {
    let config = Config::from_values(None, None, None, None, None, false)
        .unwrap_or_else(|error| panic!("default configuration should parse: {error}"));
    assert_eq!(config.listen_addr, SocketAddr::from(([127, 0, 0, 1], 8081)));
    assert!(config.proxy_state_dir.is_absolute());
    assert_eq!(config.proxy_http_port, 8_080);
}

#[test]
fn non_loopback_requires_a_safe_token() {
    let missing = Config::from_values(Some("0.0.0.0:8081"), None, None, None, None, false);
    assert!(matches!(
        missing,
        Err(ConfigError::MissingControllerToken { .. })
    ));

    let config = Config::from_values(
        Some("0.0.0.0:8081"),
        Some(valid_token()),
        None,
        None,
        None,
        false,
    );
    assert!(config.is_ok());
}

#[test]
fn rejects_unsafe_tokens_without_echoing_them() {
    let error = Config::from_values(
        None,
        Some("token with whitespace that is intentionally much longer than thirty two bytes"),
        None,
        None,
        None,
        false,
    )
    .err()
    .map(|error| error.to_string())
    .unwrap_or_default();
    assert!(error.contains(CONTROLLER_TOKEN_ENV));
    assert!(!error.contains("token with whitespace"));
}

#[test]
fn reads_a_trimmed_controller_token_from_a_file() {
    let path = secret_file(&format!("{}\n", valid_token()));
    let result = read_controller_token_sources(None, Some(path.to_string_lossy().into_owned()));
    let _ = fs::remove_file(path);

    assert_eq!(
        result.unwrap_or_else(|error| panic!("token file should parse: {error}")),
        Some(valid_token().to_owned())
    );
}

#[test]
fn rejects_conflicting_or_unsafe_controller_token_files() {
    assert!(matches!(
        read_controller_token_sources(
            Some(valid_token().to_owned()),
            Some("/run/secrets/controller-token".to_owned()),
        ),
        Err(ConfigError::ConflictingControllerTokenSources { .. })
    ));
    let error = read_controller_token_sources(None, Some("relative-secret".to_owned()))
        .err()
        .map(|error| error.to_string())
        .unwrap_or_default();
    assert!(error.contains(CONTROLLER_TOKEN_FILE_ENV));
    assert!(!error.contains("relative-secret"));
}

#[test]
fn requires_an_explicit_absolute_state_directory_for_release() {
    assert!(matches!(
        Config::from_values(None, None, None, None, None, true),
        Err(ConfigError::MissingProxyStateDir { .. })
    ));
    assert!(matches!(
        Config::from_values(
            None,
            None,
            None,
            Some(PathBuf::from("relative")),
            None,
            true
        ),
        Err(ConfigError::InvalidProxyStateDir { .. })
    ));
}

#[test]
fn validates_the_proxy_http_port() {
    for port in ["0", "70000", "not-a-port"] {
        assert!(matches!(
            Config::from_values(None, None, None, None, Some(port), false),
            Err(ConfigError::InvalidProxyHttpPort { .. })
        ));
    }
}
