use std::{collections::BTreeMap, path::PathBuf};

use crate::{
    models::ProxyHttpSettings,
    proxy::validate_proxy_config,
    runtime::renderer::{
        RenderSettings, TlsMaterial, TlsRenderSettings, render_config, render_config_with_tls,
        render_host_config,
    },
    tests::fixtures::{host, request, request_with_settings},
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
    assert!(
        rendered.contains("server_name _;\n\n        location ^~ /.well-known/acme-challenge/")
    );
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
fn renderer_emits_only_the_allowlisted_typed_http_settings() {
    let configuration = validate_proxy_config(request_with_settings(
        vec![host(
            "00000000-0000-0000-0000-000000000000",
            &["demo.test"],
            "http",
            "backend",
            4_000,
        )],
        ProxyHttpSettings {
            client_max_body_size_bytes: Some(10_485_760),
            proxy_connect_timeout_seconds: Some(15),
            proxy_read_timeout_seconds: Some(300),
            proxy_send_timeout_seconds: Some(300),
            send_timeout_seconds: Some(30),
            keepalive_timeout_seconds: Some(75),
        },
    ))
    .unwrap_or_else(|error| panic!("configuration should validate: {error:?}"));
    let rendered = render_config(
        Some(&configuration),
        &RenderSettings {
            http_port: 8_080,
            probe_socket: None,
        },
    )
    .unwrap_or_else(|error| panic!("renderer should succeed: {error:?}"));

    assert!(rendered.contains("# rentnerproxy: managed HTTP settings"));
    assert!(rendered.contains("client_max_body_size 10485760;"));
    assert!(rendered.contains("proxy_connect_timeout 15s;"));
    assert!(rendered.contains("proxy_read_timeout 300s;"));
    assert!(rendered.contains("proxy_send_timeout 300s;"));
    assert!(rendered.contains("send_timeout 30s;"));
    assert!(rendered.contains("keepalive_timeout 75s;"));
    assert!(!rendered.contains("load_module"));
    assert!(!rendered.contains("include "));
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
    assert!(rendered.contains("proxy_pass http://127.0.0.1:8081;"));
    assert!(!rendered.contains("proxy_pass http://backend"));
    assert!(!rendered.contains("rentnerproxy: managed HTTP settings"));
}

#[test]
fn host_preview_marks_structured_settings_and_preserves_advanced_text() {
    let mut configured_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    configured_host.http_settings = ProxyHttpSettings {
        proxy_read_timeout_seconds: Some(300),
        send_timeout_seconds: Some(30),
        ..ProxyHttpSettings::default()
    };
    configured_host.advanced_config = "# expert config\nadd_header X-Test \"hello\" always;\nlocation = /advanced-test {\n    return 200 \"advanced-ok\";\n}\n".to_owned();

    let preview = render_host_config(&configured_host, 8_080);
    assert!(preview.starts_with("server {\n    listen 8080;\n"));
    assert!(preview.contains(
        "    # rentnerproxy: host HTTP settings begin\n    proxy_read_timeout 300s;\n    send_timeout 30s;\n    # rentnerproxy: host HTTP settings end\n"
    ));
    let location_end = preview.find("    }\n\n").unwrap();
    let raw_start = preview.find("# expert config\n").unwrap();
    assert!(raw_start > location_end);
    assert!(preview.contains(configured_host.advanced_config.as_str()));
    assert!(preview.ends_with("}\n"));

    let empty_preview = render_host_config(
        &host(
            "10000000-0000-0000-0000-000000000000",
            &["empty.test"],
            "http",
            "backend",
            4_000,
        ),
        8_080,
    );
    assert!(empty_preview.contains(
        "    # rentnerproxy: host HTTP settings begin\n    # rentnerproxy: host HTTP settings end\n"
    ));
}

#[test]
fn legacy_hosts_keep_their_active_renderer_shape() {
    let configuration = validate_proxy_config(request(vec![host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    )]))
    .unwrap();
    let settings = RenderSettings {
        http_port: 8_080,
        probe_socket: None,
    };
    let rendered = render_config(Some(&configuration), &settings).unwrap();
    let baseline = render_config(None, &settings).unwrap().replace(
        "# rentnerproxy-revision: none",
        &format!("# rentnerproxy-revision: {}", configuration.revision),
    );
    let (prefix, _) = baseline.rsplit_once("}\n").unwrap();
    let expected_host = "    server {\n        listen 8080;\n        server_name demo.test;\n\n        location ^~ /.well-known/acme-challenge/ {\n            proxy_pass http://127.0.0.1:8081;\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_pass_request_body off;\n            proxy_set_header Content-Length \"\";\n            proxy_set_header Connection \"\";\n        }\n\n        location / {\n            proxy_pass http://backend:4000;\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_set_header X-Real-IP $remote_addr;\n            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n            proxy_set_header X-Forwarded-Proto $scheme;\n            proxy_set_header Upgrade $http_upgrade;\n            proxy_set_header Connection $connection_upgrade;\n        }\n    }\n";
    assert_eq!(rendered, format!("{prefix}\n{expected_host}}}\n"));
    assert!(!rendered.contains("host HTTP settings"));
    assert!(!rendered.contains("advanced proxy host configuration"));
}

#[test]
fn host_http_settings_override_the_global_http_default_at_server_scope() {
    let mut configured_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    configured_host.http_settings = ProxyHttpSettings {
        proxy_read_timeout_seconds: Some(300),
        ..ProxyHttpSettings::default()
    };
    let configuration = validate_proxy_config(request_with_settings(
        vec![configured_host],
        ProxyHttpSettings {
            proxy_read_timeout_seconds: Some(120),
            ..ProxyHttpSettings::default()
        },
    ))
    .unwrap();
    let rendered = render_config(
        Some(&configuration),
        &RenderSettings {
            http_port: 8_080,
            probe_socket: None,
        },
    )
    .unwrap();

    let global = rendered.find("    proxy_read_timeout 120s;").unwrap();
    let host_override = rendered.find("        proxy_read_timeout 300s;").unwrap();
    assert!(global < host_override);
    assert!(!rendered.contains("host HTTP settings begin"));
}

#[test]
fn tls_renderer_keeps_per_host_settings_and_advanced_text_byte_exact() {
    let certificate_id = "0198d98a-0000-7000-8000-000000000001";
    let mut configured_host = host(
        "00000000-0000-0000-0000-000000000000",
        &["demo.test"],
        "http",
        "backend",
        4_000,
    );
    configured_host.certificate_id = Some(certificate_id.to_owned());
    configured_host.force_https = true;
    configured_host.http_settings = ProxyHttpSettings {
        client_max_body_size_bytes: Some(10_485_760),
        proxy_read_timeout_seconds: Some(300),
        ..ProxyHttpSettings::default()
    };
    configured_host.advanced_config = concat!(
        "# Preserve literal generated-looking text\n",
        "set $expert_upstream http://127.0.0.1:8081;\n",
        "return 308 https://$host$request_uri;\n"
    )
    .to_owned();
    let configuration = validate_proxy_config(request(vec![configured_host.clone()]))
        .unwrap_or_else(|error| panic!("configuration should validate: {error:?}"));
    let root = std::env::temp_dir().join("rentnerproxy-renderer-tls-material");
    let materials = BTreeMap::from([(
        certificate_id.to_owned(),
        TlsMaterial {
            fullchain_path: root.join("fullchain.pem"),
            private_key_path: root.join("privatekey.pem"),
        },
    )]);

    let rendered = render_config_with_tls(
        &configuration,
        &RenderSettings {
            http_port: 8_080,
            probe_socket: None,
        },
        &TlsRenderSettings {
            https_port: 8_443,
            public_https_port: 18_443,
            controller_port: 9_999,
        },
        &materials,
    )
    .unwrap_or_else(|error| panic!("TLS renderer should succeed: {error:?}"));

    assert!(rendered.contains("proxy_pass http://127.0.0.1:9999;"));
    assert!(rendered.contains("return 308 https://$host:18443$request_uri;"));
    assert!(rendered.contains("        client_max_body_size 10485760;"));
    assert!(rendered.contains("        proxy_read_timeout 300s;"));
    assert!(rendered.contains(configured_host.advanced_config.as_str()));
    assert!(rendered.contains("set $expert_upstream http://127.0.0.1:8081;"));
    assert!(rendered.contains("return 308 https://$host$request_uri;"));
}
