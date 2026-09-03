use std::{
    collections::BTreeMap,
    net::Ipv6Addr,
    path::{Path, PathBuf},
};

use crate::models::{ProxyHttpSettings, RedirectHost, ValidatedProxyConfig};

pub(crate) const MAX_RENDERED_PROXY_CONFIG_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RENDERED_PROXY_HOST_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RenderSettings {
    pub(crate) http_port: u16,
    pub(crate) probe_socket: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TlsRenderSettings {
    pub(crate) https_port: u16,
    pub(crate) public_https_port: u16,
    pub(crate) controller_port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TlsMaterial {
    pub(crate) fullchain_path: PathBuf,
    pub(crate) private_key_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UpstreamTlsRenderSettings {
    pub(crate) system_ca_bundle: PathBuf,
    pub(crate) trusted_ca_paths: BTreeMap<String, PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RenderError {
    InvalidProbeSocket,
    InvalidCertificatePath,
    MissingCertificate,
    MissingTrustedCa,
    ConfigTooLarge,
}

pub(crate) fn render_config(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
) -> Result<String, RenderError> {
    render_config_with_ports(config, settings, 8_081, 443, None)
}

fn render_config_with_ports(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
    controller_port: u16,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    let revision = config.map_or("none", |config| config.revision.as_str());
    let probe = settings
        .probe_socket
        .as_ref()
        .map(|path| probe_socket_value(path))
        .transpose()?;

    let mut output = format!(
        "# rentnerproxy-revision: {revision}\nworker_processes 1;\npid engine.pid;\nerror_log stderr warn;\n\nevents {{\n    worker_connections 1024;\n}}\n\nhttp {{\n    server_names_hash_bucket_size 512;\n    server_names_hash_max_size 65536;\n    access_log off;\n\n    map $http_upgrade $connection_upgrade {{\n        default upgrade;\n        '' close;\n    }}\n\n    server {{\n        listen {} default_server;\n        server_name _;\n\n        location ^~ /.well-known/acme-challenge/ {{\n            proxy_pass http://127.0.0.1:{controller_port};\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_pass_request_body off;\n            proxy_set_header Content-Length \"\";\n            proxy_set_header Connection \"\";\n        }}\n\n        location / {{\n            return 404;\n        }}\n    }}\n",
        settings.http_port
    );

    if let Some(config) = config.filter(|config| !config.http_settings.is_empty()) {
        append_http_settings(&mut output, &config.http_settings);
    }

    if let Some(probe) = probe {
        output.push_str(&format!(
            "\n    server {{\n        listen unix:{probe};\n        server_name _;\n\n        location = /__rentnerproxy_runtime_probe {{\n            default_type text/plain;\n            return 200 \"{revision}\\n\";\n        }}\n\n        location / {{\n            return 404;\n        }}\n    }}\n"
        ));
    }

    if let Some(config) = config {
        for host in &config.proxy_hosts {
            output.push('\n');
            output.push_str(&render_active_host_config(
                host,
                settings.http_port,
                controller_port,
                public_https_port,
                upstream_tls,
            )?);
        }
        for host in &config.redirect_hosts {
            output.push('\n');
            output.push_str(&render_active_redirect_host_config(
                host,
                settings.http_port,
                controller_port,
            ));
        }
    }
    output.push_str("}\n");
    if output.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
        return Err(RenderError::ConfigTooLarge);
    }
    Ok(output)
}

pub(crate) fn render_config_with_tls(
    config: &ValidatedProxyConfig,
    settings: &RenderSettings,
    tls: &TlsRenderSettings,
    materials: &BTreeMap<String, TlsMaterial>,
    upstream_tls: &UpstreamTlsRenderSettings,
) -> Result<String, RenderError> {
    let mut output = render_config_with_ports(
        Some(config),
        settings,
        tls.controller_port,
        tls.public_https_port,
        Some(upstream_tls),
    )?;
    if !output.ends_with("}\n") {
        return Err(RenderError::ConfigTooLarge);
    }
    output.truncate(output.len() - 2);
    output.push_str(&format!(
        "\n    server {{\n        listen {} default_server ssl;\n        server_name _;\n        ssl_reject_handshake on;\n    }}\n",
        tls.https_port
    ));
    for host in &config.proxy_hosts {
        let Some(certificate_id) = host.certificate_id.as_ref() else {
            continue;
        };
        let material = materials
            .get(certificate_id)
            .ok_or(RenderError::MissingCertificate)?;
        output.push('\n');
        output.push_str(&render_tls_server(host, tls, material, upstream_tls)?);
    }
    for host in &config.redirect_hosts {
        let Some(certificate_id) = host.certificate_id.as_ref() else {
            continue;
        };
        let material = materials
            .get(certificate_id)
            .ok_or(RenderError::MissingCertificate)?;
        output.push('\n');
        output.push_str(&render_tls_redirect_server(host, tls, material)?);
    }

    output.push_str("}\n");
    if output.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
        return Err(RenderError::ConfigTooLarge);
    }
    Ok(output)
}

fn render_tls_server(
    host: &crate::models::ProxyHost,
    tls: &TlsRenderSettings,
    material: &TlsMaterial,
    upstream_tls: &UpstreamTlsRenderSettings,
) -> Result<String, RenderError> {
    let certificate = certificate_path(&material.fullchain_path)?;
    let private_key = certificate_path(&material.private_key_path)?;
    let upstream_host = if host.forward_host.parse::<Ipv6Addr>().is_ok() {
        format!("[{}]", host.forward_host)
    } else {
        host.forward_host.clone()
    };
    let upstream = format!(
        "{}://{upstream_host}:{}",
        host.forward_scheme, host.forward_port
    );
    let mut output = format!(
        "    server {{\n        listen {} ssl;\n        server_name {};\n        ssl_certificate {certificate};\n        ssl_certificate_key {private_key};\n        ssl_protocols TLSv1.2 TLSv1.3;\n        ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;\n        ssl_prefer_server_ciphers on;\n\n        location / {{\n            proxy_pass {upstream};\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_set_header X-Real-IP $remote_addr;\n            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n            proxy_set_header X-Forwarded-Proto $scheme;\n            proxy_set_header Upgrade $http_upgrade;\n            proxy_set_header Connection $connection_upgrade;\n",
        tls.https_port,
        host.domains.join(" ")
    );
    if !host.http_settings.is_empty() {
        let location_offset = output
            .find("\n        location / {")
            .ok_or(RenderError::ConfigTooLarge)?;
        let mut settings = String::new();
        append_host_http_settings(&mut settings, &host.http_settings, "        ");
        output.insert_str(location_offset, &settings);
    }
    append_upstream_tls(&mut output, host, Some(upstream_tls), "            ")?;
    output.push_str("        }\n");
    if !host.advanced_config.is_empty() {
        output.push_str(
            "\n        # rentnerproxy: advanced proxy host configuration (server context)\n",
        );
        output.push_str(&host.advanced_config);
        if !host.advanced_config.ends_with('\n') {
            output.push('\n');
        }
    }
    output.push_str("    }\n");
    Ok(output)
}

fn redirect_target(host: &RedirectHost) -> String {
    if host.preserve_request_uri {
        format!("{}$request_uri", host.destination)
    } else {
        host.destination.clone()
    }
}

fn render_active_redirect_host_config(
    host: &RedirectHost,
    http_port: u16,
    controller_port: u16,
) -> String {
    let target = redirect_target(host);
    format!(
        "    server {{\n        listen {http_port};\n        server_name {};\n\n        location ^~ /.well-known/acme-challenge/ {{\n            proxy_pass http://127.0.0.1:{controller_port};\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_pass_request_body off;\n            proxy_set_header Content-Length \"\";\n            proxy_set_header Connection \"\";\n        }}\n\n        location / {{\n            return {} \"{target}\";\n        }}\n    }}\n",
        host.domains.join(" "),
        host.status_code,
    )
}

fn render_tls_redirect_server(
    host: &RedirectHost,
    tls: &TlsRenderSettings,
    material: &TlsMaterial,
) -> Result<String, RenderError> {
    let certificate = certificate_path(&material.fullchain_path)?;
    let private_key = certificate_path(&material.private_key_path)?;
    let target = redirect_target(host);
    Ok(format!(
        "    server {{\n        listen {} ssl;\n        server_name {};\n        ssl_certificate {certificate};\n        ssl_certificate_key {private_key};\n        ssl_protocols TLSv1.2 TLSv1.3;\n        ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;\n        ssl_prefer_server_ciphers on;\n\n        location / {{\n            return {} \"{target}\";\n        }}\n    }}\n",
        tls.https_port,
        host.domains.join(" "),
        host.status_code,
    ))
}

fn append_upstream_tls(
    output: &mut String,
    host: &crate::models::ProxyHost,
    settings: Option<&UpstreamTlsRenderSettings>,
    indent: &str,
) -> Result<(), RenderError> {
    if host.forward_scheme != "https" {
        return Ok(());
    }
    let Some(upstream_tls) = host.upstream_tls.as_ref() else {
        output.push_str(&format!(
            "{indent}proxy_ssl_server_name on;\n{indent}proxy_ssl_verify off;\n"
        ));
        return Ok(());
    };
    let settings = settings.ok_or(RenderError::MissingTrustedCa)?;
    let server_name = upstream_tls.server_name.as_deref().or_else(|| {
        (host.forward_host.parse::<std::net::IpAddr>().is_err())
            .then_some(host.forward_host.as_str())
    });
    if let Some(server_name) = server_name {
        output.push_str(&format!(
            "{indent}proxy_ssl_server_name on;\n{indent}proxy_ssl_name {server_name};\n"
        ));
    } else {
        output.push_str(&format!("{indent}proxy_ssl_server_name off;\n"));
    }
    if upstream_tls.verify {
        let trusted_certificate = match upstream_tls.trusted_ca_id.as_deref() {
            Some(id) => settings
                .trusted_ca_paths
                .get(id)
                .ok_or(RenderError::MissingTrustedCa)?,
            None => &settings.system_ca_bundle,
        };
        let trusted_certificate = certificate_path(trusted_certificate)?;
        output.push_str(&format!(
            "{indent}proxy_ssl_verify on;\n{indent}proxy_ssl_verify_depth 5;\n{indent}proxy_ssl_trusted_certificate {trusted_certificate};\n"
        ));
    } else {
        output.push_str(&format!("{indent}proxy_ssl_verify off;\n"));
    }
    Ok(())
}
fn certificate_path(path: &Path) -> Result<String, RenderError> {
    let value = path
        .to_str()
        .ok_or(RenderError::InvalidCertificatePath)?
        .replace('\\', "/");
    if !path.is_absolute()
        || value.is_empty()
        || value.bytes().any(|byte| {
            byte.is_ascii_whitespace()
                || matches!(byte, b';' | b'{' | b'}' | b'#' | b'$' | b'"' | b'\'')
        })
    {
        return Err(RenderError::InvalidCertificatePath);
    }
    Ok(value)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn render_host_config(host: &crate::models::ProxyHost, http_port: u16) -> String {
    render_host_config_for_runtime(host, http_port, 8_081, 443, None)
        .expect("legacy host rendering requires no upstream TLS material")
}

pub(crate) fn render_host_config_for_runtime(
    host: &crate::models::ProxyHost,
    http_port: u16,
    controller_port: u16,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    render_host_config_with_indentation(
        host,
        http_port,
        controller_port,
        public_https_port,
        upstream_tls,
        "",
        "    ",
        true,
    )
}

fn render_active_host_config(
    host: &crate::models::ProxyHost,
    http_port: u16,
    controller_port: u16,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    render_host_config_with_indentation(
        host,
        http_port,
        controller_port,
        public_https_port,
        upstream_tls,
        "    ",
        "        ",
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn render_host_config_with_indentation(
    host: &crate::models::ProxyHost,
    http_port: u16,
    controller_port: u16,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
    server_indent: &str,
    directive_indent: &str,
    include_setting_markers: bool,
) -> Result<String, RenderError> {
    let nested_indent = format!("{directive_indent}    ");
    let upstream_host = if host.forward_host.parse::<Ipv6Addr>().is_ok() {
        format!("[{}]", host.forward_host)
    } else {
        host.forward_host.clone()
    };
    let upstream = format!(
        "{}://{upstream_host}:{}",
        host.forward_scheme, host.forward_port
    );
    let mut output = format!(
        "{server_indent}server {{\n{directive_indent}listen {http_port};\n{directive_indent}server_name {};\n",
        host.domains.join(" ")
    );

    output.push('\n');
    if include_setting_markers {
        output.push_str(&format!(
            "{directive_indent}# rentnerproxy: host HTTP settings begin\n"
        ));
        append_host_http_settings(&mut output, &host.http_settings, directive_indent);
        output.push_str(&format!(
            "{directive_indent}# rentnerproxy: host HTTP settings end\n"
        ));
        output.push('\n');
    } else if !host.http_settings.is_empty() {
        append_host_http_settings(&mut output, &host.http_settings, directive_indent);
        output.push('\n');
    }

    output.push_str(&format!(
        "{directive_indent}location ^~ /.well-known/acme-challenge/ {{\n{nested_indent}proxy_pass http://127.0.0.1:{controller_port};\n{nested_indent}proxy_http_version 1.1;\n{nested_indent}proxy_set_header Host $host;\n{nested_indent}proxy_pass_request_body off;\n{nested_indent}proxy_set_header Content-Length \"\";\n{nested_indent}proxy_set_header Connection \"\";\n{directive_indent}}}\n\n"
    ));
    if host.force_https {
        let redirect = if public_https_port == 443 {
            "https://$host$request_uri".to_owned()
        } else {
            format!("https://$host:{public_https_port}$request_uri")
        };
        output.push_str(&format!(
            "{directive_indent}location / {{\n{nested_indent}return 308 {redirect};\n{directive_indent}}}\n"
        ));
    } else {
        output.push_str(&format!(
            "{directive_indent}location / {{\n{nested_indent}proxy_pass "
        ));
        output.push_str(&upstream);
        output.push_str(&format!(
        ";\n{nested_indent}proxy_http_version 1.1;\n{nested_indent}proxy_set_header Host $host;\n{nested_indent}proxy_set_header X-Real-IP $remote_addr;\n{nested_indent}proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n{nested_indent}proxy_set_header X-Forwarded-Proto $scheme;\n{nested_indent}proxy_set_header Upgrade $http_upgrade;\n{nested_indent}proxy_set_header Connection $connection_upgrade;\n",
    ));
        append_upstream_tls(&mut output, host, upstream_tls, &nested_indent)?;
        output.push_str(&format!("{directive_indent}}}\n"));
    }
    if !host.advanced_config.is_empty() {
        output.push_str(&format!(
            "\n{directive_indent}# rentnerproxy: advanced proxy host configuration (server context)\n"
        ));
        output.push_str(&host.advanced_config);
        if !host.advanced_config.ends_with('\n') {
            output.push('\n');
        }
    }
    output.push_str(&format!("{server_indent}}}\n"));
    Ok(output)
}

#[allow(dead_code)]
pub(crate) fn render_host_sources(
    configuration: &ValidatedProxyConfig,
    http_port: u16,
) -> Result<std::collections::BTreeMap<String, String>, RenderError> {
    render_host_sources_for_runtime(configuration, http_port, 8_081, 443, None)
}

pub(crate) fn render_host_sources_for_runtime(
    configuration: &ValidatedProxyConfig,
    http_port: u16,
    controller_port: u16,
    public_https_port: u16,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<std::collections::BTreeMap<String, String>, RenderError> {
    let mut sources = std::collections::BTreeMap::new();
    for host in &configuration.proxy_hosts {
        let source = render_active_host_config(
            host,
            http_port,
            controller_port,
            public_https_port,
            upstream_tls,
        )?;
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RenderError::ConfigTooLarge);
        }
        sources.insert(host.id.clone(), source);
    }
    for host in &configuration.redirect_hosts {
        let source = render_active_redirect_host_config(host, http_port, controller_port);
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RenderError::ConfigTooLarge);
        }
        if sources.insert(host.id.clone(), source).is_some() {
            return Err(RenderError::ConfigTooLarge);
        }
    }

    Ok(sources)
}
fn append_http_settings(output: &mut String, settings: &ProxyHttpSettings) {
    output.push_str("\n    # rentnerproxy: managed HTTP settings\n");
    if let Some(value) = settings.client_max_body_size_bytes {
        output.push_str(&format!("    client_max_body_size {value};\n"));
    }
    if let Some(value) = settings.proxy_connect_timeout_seconds {
        output.push_str(&format!("    proxy_connect_timeout {value}s;\n"));
    }
    if let Some(value) = settings.proxy_read_timeout_seconds {
        output.push_str(&format!("    proxy_read_timeout {value}s;\n"));
    }
    if let Some(value) = settings.proxy_send_timeout_seconds {
        output.push_str(&format!("    proxy_send_timeout {value}s;\n"));
    }
    if let Some(value) = settings.send_timeout_seconds {
        output.push_str(&format!("    send_timeout {value}s;\n"));
    }
    if let Some(value) = settings.keepalive_timeout_seconds {
        output.push_str(&format!("    keepalive_timeout {value}s;\n"));
    }
}

fn append_host_http_settings(output: &mut String, settings: &ProxyHttpSettings, indent: &str) {
    if let Some(value) = settings.client_max_body_size_bytes {
        output.push_str(&format!("{indent}client_max_body_size {value};\n"));
    }
    if let Some(value) = settings.proxy_connect_timeout_seconds {
        output.push_str(&format!("{indent}proxy_connect_timeout {value}s;\n"));
    }
    if let Some(value) = settings.proxy_read_timeout_seconds {
        output.push_str(&format!("{indent}proxy_read_timeout {value}s;\n"));
    }
    if let Some(value) = settings.proxy_send_timeout_seconds {
        output.push_str(&format!("{indent}proxy_send_timeout {value}s;\n"));
    }
    if let Some(value) = settings.send_timeout_seconds {
        output.push_str(&format!("{indent}send_timeout {value}s;\n"));
    }
    if let Some(value) = settings.keepalive_timeout_seconds {
        output.push_str(&format!("{indent}keepalive_timeout {value}s;\n"));
    }
}

fn probe_socket_value(path: &Path) -> Result<&str, RenderError> {
    let value = path.to_str().ok_or(RenderError::InvalidProbeSocket)?;
    if !path.is_absolute()
        || value.is_empty()
        || value.bytes().any(|byte| {
            byte.is_ascii_whitespace() || matches!(byte, b';' | b'{' | b'}' | b'#' | b'"' | b'\\')
        })
    {
        return Err(RenderError::InvalidProbeSocket);
    }
    Ok(value)
}
