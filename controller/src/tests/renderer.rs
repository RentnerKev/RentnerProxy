use std::path::PathBuf;

use crate::{
    proxy::validate_proxy_config,
    runtime::renderer::{RenderSettings, render_config},
    tests::fixtures::{host, request},
};

#[test]
fn renderer_is_deterministic_and_covers_proxy_defaults() {
    let configuration = validate_proxy_config(request(vec![
        host(
            "10000000-0000-0000-0000-000000000000",
            &["z.test", "a.test"],
            "https",
            "2001:db8::1",
            4_443,
        ),
        host(
            "00000000-0000-0000-0000-000000000000",
            &["ipv4.test"],
            "http",
            "192.168.1.50",
            3_000,
        ),
    ]))
    .unwrap_or_else(|error| panic!("configuration should validate: {error:?}"));
    let settings = RenderSettings {
        http_port: 8_080,
        probe_socket: if cfg!(windows) {
            None
        } else {
            Some(PathBuf::from("/tmp/rentnerproxy-probe.sock"))
        },
    };
    let rendered = render_config(Some(&configuration), &settings)
        .unwrap_or_else(|error| panic!("renderer should succeed: {error:?}"));

    assert!(rendered.contains("listen 8080 default_server;"));
    assert!(rendered.contains("server_name _;\n        return 404;"));
    if cfg!(windows) {
        assert!(!rendered.contains("listen unix:"));
    } else {
        assert!(rendered.contains("listen unix:/tmp/rentnerproxy-probe.sock;"));
    }
    assert!(rendered.contains("server_name a.test z.test;"));
    assert!(rendered.contains("proxy_pass https://[2001:db8::1]:4443;"));
    assert!(rendered.contains("proxy_pass http://192.168.1.50:3000;"));
    assert!(rendered.contains("proxy_ssl_server_name on;"));
    assert!(rendered.contains("proxy_ssl_verify off;"));
    assert!(rendered.contains("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"));
    assert!(rendered.contains("proxy_set_header Connection $connection_upgrade;"));
    assert_eq!(
        rendered,
        render_config(Some(&configuration), &settings).unwrap()
    );
}

#[test]
fn renderer_supports_a_zero_host_baseline_without_a_probe() {
    let rendered = render_config(
        None,
        &RenderSettings {
            http_port: 8_080,
            probe_socket: None,
        },
    )
    .unwrap_or_else(|error| panic!("renderer should succeed: {error:?}"));

    assert!(rendered.contains("# rentnerproxy-revision: none"));
    assert!(rendered.contains("return 404;"));
    assert!(!rendered.contains("proxy_pass"));
}
