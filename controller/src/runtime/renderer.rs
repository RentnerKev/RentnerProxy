use std::{
    net::Ipv6Addr,
    path::{Path, PathBuf},
};

use crate::models::ValidatedProxyConfig;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RenderSettings {
    pub(crate) http_port: u16,
    pub(crate) probe_socket: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RenderError {
    InvalidProbeSocket,
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

    if let Some(probe) = probe {
        output.push_str(&format!(
            "\n    server {{\n        listen unix:{probe};\n        server_name _;\n\n        location = /__rentnerproxy_runtime_probe {{\n            default_type text/plain;\n            return 200 \"{revision}\\n\";\n        }}\n\n        location / {{\n            return 404;\n        }}\n    }}\n"
        ));
    }

    if let Some(config) = config {
        for host in &config.proxy_hosts {
            let upstream_host = if host.forward_host.parse::<Ipv6Addr>().is_ok() {
                format!("[{}]", host.forward_host)
            } else {
                host.forward_host.clone()
            };
            let upstream = format!(
                "{}://{upstream_host}:{}",
                host.forward_scheme, host.forward_port
            );
            output.push_str(&format!(
                "\n    server {{\n        listen {};\n        server_name {};\n\n        location / {{\n            proxy_pass {upstream};\n            proxy_http_version 1.1;\n            proxy_set_header Host $host;\n            proxy_set_header X-Real-IP $remote_addr;\n            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n            proxy_set_header X-Forwarded-Proto $scheme;\n            proxy_set_header Upgrade $http_upgrade;\n            proxy_set_header Connection $connection_upgrade;\n",
                settings.http_port,
                host.domains.join(" ")
            ));
            if host.forward_scheme == "https" {
                output.push_str(
                    "            proxy_ssl_server_name on;\n            proxy_ssl_verify off;\n",
                );
            }
            output.push_str("        }\n    }\n");
        }
    }

    output.push_str("}\n");
    Ok(output)
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
