use std::{
    net::Ipv6Addr,
    path::{Path, PathBuf},
};

use crate::models::{ProxyHttpSettings, ValidatedProxyConfig};

pub(crate) const MAX_RENDERED_PROXY_CONFIG_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RENDERED_PROXY_HOST_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RenderSettings {
    pub(crate) http_port: u16,
    pub(crate) probe_socket: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RenderError {
    InvalidProbeSocket,
    ConfigTooLarge,
}

pub(crate) fn render_config(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
) -> Result<String, RenderError> {
    let revision = config.map_or("none", |config| config.revision.as_str());
    let probe = settings
        .probe_socket
        .as_ref()
        .map(|path| probe_socket_value(path))
        .transpose()?;

    let mut output = format!(
        "# rentnerproxy-revision: {revision}\nworker_processes 1;\npid engine.pid;\nerror_log stderr warn;\n\nevents {{\n    worker_connections 1024;\n}}\n\nhttp {{\n    server_names_hash_bucket_size 512;\n    server_names_hash_max_size 65536;\n    access_log off;\n\n    map $http_upgrade $connection_upgrade {{\n        default upgrade;\n        '' close;\n    }}\n\n    server {{\n        listen {} default_server;\n        server_name _;\n        return 404;\n    }}\n",
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
            output.push_str(&render_active_host_config(host, settings.http_port));
        }
    }

    output.push_str("}\n");
    if output.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
        return Err(RenderError::ConfigTooLarge);
    }
    Ok(output)
}

pub(crate) fn render_host_config(host: &crate::models::ProxyHost, http_port: u16) -> String {
    render_host_config_with_indentation(host, http_port, "", "    ", true)
}

fn render_active_host_config(host: &crate::models::ProxyHost, http_port: u16) -> String {
    render_host_config_with_indentation(host, http_port, "    ", "        ", false)
}

fn render_host_config_with_indentation(
    host: &crate::models::ProxyHost,
    http_port: u16,
    server_indent: &str,
    directive_indent: &str,
    include_setting_markers: bool,
) -> String {
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
        "{directive_indent}location / {{\n{nested_indent}proxy_pass "
    ));
    output.push_str(&upstream);
    output.push_str(&format!(
        ";\n{nested_indent}proxy_http_version 1.1;\n{nested_indent}proxy_set_header Host $host;\n{nested_indent}proxy_set_header X-Real-IP $remote_addr;\n{nested_indent}proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n{nested_indent}proxy_set_header X-Forwarded-Proto $scheme;\n{nested_indent}proxy_set_header Upgrade $http_upgrade;\n{nested_indent}proxy_set_header Connection $connection_upgrade;\n",
    ));
    if host.forward_scheme == "https" {
        output.push_str(&format!(
            "{nested_indent}proxy_ssl_server_name on;\n{nested_indent}proxy_ssl_verify off;\n"
        ));
    }
    output.push_str(&format!("{directive_indent}}}\n"));
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
    output
}

pub(crate) fn render_host_sources(
    configuration: &ValidatedProxyConfig,
    http_port: u16,
) -> Result<std::collections::BTreeMap<String, String>, RenderError> {
    let mut sources = std::collections::BTreeMap::new();
    for host in &configuration.proxy_hosts {
        let source = render_active_host_config(host, http_port);
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RenderError::ConfigTooLarge);
        }
        sources.insert(host.id.clone(), source);
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
