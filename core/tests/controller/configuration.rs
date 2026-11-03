use super::{TEST_TOKEN, isolated_command};

#[test]
fn controller_rejects_invalid_environment_without_starting_runtime() {
    for (variable, value, diagnostic) in [
        (
            "RENTNERPROXY_CONTROLLER_LISTEN_ADDR",
            "invalid",
            "invalid RENTNERPROXY_CONTROLLER_LISTEN_ADDR",
        ),
        (
            "RENTNERPROXY_CONTROLLER_TOKEN",
            "short",
            "invalid RENTNERPROXY_CONTROLLER_TOKEN",
        ),
        (
            "RENTNERPROXY_CONTROLLER_TOKEN_FILE",
            "relative",
            "configure exactly one",
        ),
        (
            "RENTNERPROXY_PROXY_HTTP_PORT",
            "0",
            "invalid RENTNERPROXY_PROXY_HTTP_PORT",
        ),
        (
            "RENTNERPROXY_PROXY_HTTPS_PORT",
            "65536",
            "invalid RENTNERPROXY_PROXY_HTTPS_PORT",
        ),
        (
            "RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT",
            "nonsense",
            "invalid RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT",
        ),
        (
            "RENTNERPROXY_PROXY_STATE_DIR",
            "relative",
            "invalid RENTNERPROXY_PROXY_STATE_DIR",
        ),
        (
            "RENTNERPROXY_SYSTEM_CA_BUNDLE",
            "relative",
            "invalid RENTNERPROXY_SYSTEM_CA_BUNDLE",
        ),
        (
            "PROXY_TRUSTED_PROXY_CIDRS",
            "0.0.0.0/0",
            "invalid PROXY_TRUSTED_PROXY_CIDRS",
        ),
    ] {
        let output = isolated_command()
            .env("RENTNERPROXY_CONTROLLER_TOKEN", TEST_TOKEN)
            .env(variable, value)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{variable}");
        let diagnostic_output = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);
        assert!(
            diagnostic_output.contains(diagnostic),
            "{variable}: {diagnostic_output}"
        );
        assert!(!diagnostic_output.contains(TEST_TOKEN));
    }
}

#[cfg(unix)]
#[test]
fn controller_rejects_non_unicode_environment_with_safe_diagnostics() {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    for (variable, diagnostic) in [
        (
            "RENTNERPROXY_CONTROLLER_LISTEN_ADDR",
            "invalid non-Unicode value",
        ),
        (
            "RENTNERPROXY_CONTROLLER_TOKEN_FILE",
            "invalid RENTNERPROXY_CONTROLLER_TOKEN_FILE",
        ),
        (
            "RENTNERPROXY_CONTROLLER_TOKEN",
            "invalid RENTNERPROXY_CONTROLLER_TOKEN",
        ),
    ] {
        let output = isolated_command()
            .env("RENTNERPROXY_CONTROLLER_TOKEN", TEST_TOKEN)
            .env(variable, OsString::from_vec(vec![255]))
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        let text = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);
        assert!(text.contains(diagnostic), "{text}");
        assert!(!text.contains(TEST_TOKEN));
    }
}
