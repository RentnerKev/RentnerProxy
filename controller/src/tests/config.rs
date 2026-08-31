use std::{net::SocketAddr, path::PathBuf};

use crate::config::{CONTROLLER_TOKEN_ENV, Config, ConfigError};

fn valid_token() -> &'static str {
    "0123456789abcdef0123456789abcdef"
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
