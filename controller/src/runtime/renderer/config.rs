use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use crate::models::{ProxyHttpSettings, ValidatedProxyConfig};

use super::{
    MAX_RENDERED_PROXY_CONFIG_BYTES, RenderError, RenderSettings, TlsMaterial, TlsRenderSettings,
    UpstreamTlsRenderSettings,
    model::{
        Admin, AdminConfig, Apps, AutoHttps, CaddyConfig, CertificateFile, CertificateLoaders,
        CertificateSelection, ErrorConfig, ErrorResponse, ErrorStatus, Handler, Headers, HttpApp,
        HttpServer, MatcherSet, ResponseHeaders, Route, ServerLogs, StaticResponse, Storage,
        TlsApp, TlsConnectionPolicy, TlsMatcher,
    },
    proxy::{admin_listen, certificate_path, path_string, probe_listen, seconds, trusted_proxies},
    routes::{challenge_route, host_routes, http_routes, not_found_route, redirect_route},
};

pub(super) fn render_config_inner(
    config: Option<&ValidatedProxyConfig>,
    settings: &RenderSettings,
    tls: Option<&TlsRenderSettings>,
    materials: Option<&BTreeMap<String, TlsMaterial>>,
    upstream_tls: Option<&UpstreamTlsRenderSettings>,
) -> Result<String, RenderError> {
    let config = config.cloned().unwrap_or_else(empty_config);
    let revision = if config.revision.is_empty() {
        "none"
    } else {
        &config.revision
    };
    let admin_listen = admin_listen(settings.admin_socket.as_deref())?;
    let state_root = path_string(&settings.state_dir, RenderError::InvalidProbeSocket)?;
    let mut servers = BTreeMap::new();
    servers.insert(
        "rentnerproxy-http".to_owned(),
        HttpServer {
            listen: vec![format!(":{}", settings.http_port)],
            routes: http_routes(
                &config,
                settings,
                tls.map_or(443, |v| v.public_https_port),
                upstream_tls,
            )?,
            automatic_https: AutoHttps { disable: true },
            protocols: vec!["h1".to_owned(), "h2".to_owned()],
            allow_0rtt: None,
            errors: None,
            read_header_timeout: "15s".to_owned(),
            write_timeout: seconds(config.http_settings.send_timeout_seconds),
            idle_timeout: seconds(config.http_settings.keepalive_timeout_seconds),
            strict_sni_host: None,
            trusted_proxies: trusted_proxies(&settings.trusted_proxy_cidrs),
            trusted_proxies_strict: (!settings.trusted_proxy_cidrs.is_empty()).then_some(1),
            tls_connection_policies: None,
            logs: Some(ServerLogs {}),
        },
    );
    {
        let listen = settings
            .probe_socket
            .as_deref()
            .map(probe_listen)
            .transpose()?
            .unwrap_or_else(|| "127.0.0.1:2020".to_owned());
        servers.insert(
            "rentnerproxy-probe".to_owned(),
            HttpServer {
                listen: vec![listen],
                routes: vec![
                    Route {
                        matchers: vec![MatcherSet::path(vec![
                            "/__rentnerproxy_runtime_probe".to_owned(),
                        ])],
                        handle: vec![Handler::StaticResponse(StaticResponse {
                            body: Some(format!("{revision}\n")),
                            status_code: Some(200),
                            headers: None,
                        })],
                        terminal: true,
                    },
                    not_found_route(),
                ],
                automatic_https: AutoHttps { disable: true },
                protocols: vec!["h1".to_owned()],
                allow_0rtt: None,
                errors: None,
                read_header_timeout: "15s".to_owned(),
                write_timeout: None,
                idle_timeout: None,
                strict_sni_host: None,
                trusted_proxies: None,
                trusted_proxies_strict: None,
                tls_connection_policies: None,
                logs: None,
            },
        );
    }

    let mut tls_app = None;
    if let (Some(tls), Some(materials), Some(upstream_tls)) = (tls, materials, upstream_tls) {
        let mut certs = Vec::new();
        let mut loaded_certificate_ids = BTreeSet::new();
        let mut policies = Vec::new();
        let mut https_routes = vec![
            alt_svc_route(tls.public_https_port),
            challenge_route(settings.controller_port, "https"),
        ];
        for host in &config.proxy_hosts {
            let Some(certificate_id) = host.certificate_id.as_ref() else {
                continue;
            };
            let material = materials
                .get(certificate_id)
                .ok_or(RenderError::MissingCertificate)?;
            if loaded_certificate_ids.insert(certificate_id.clone()) {
                certs.push(CertificateFile {
                    certificate: certificate_path(&material.fullchain_path)?,
                    key: certificate_path(&material.private_key_path)?,
                    tags: vec![certificate_id.clone()],
                });
            }
            policies.push(TlsConnectionPolicy {
                matcher: TlsMatcher {
                    sni: host.domains.clone(),
                },
                certificate_selection: CertificateSelection {
                    any_tag: vec![certificate_id.clone()],
                },
                protocol_min: "tls1.2".to_owned(),
                alpn: vec!["h2".to_owned(), "http/1.1".to_owned()],
            });
            https_routes.extend(host_routes(
                host,
                tls.public_https_port,
                Some(upstream_tls),
                true,
                &config.http_settings,
                &settings.trusted_proxy_cidrs,
            )?);
        }
        for host in &config.redirect_hosts {
            let Some(certificate_id) = host.certificate_id.as_ref() else {
                continue;
            };
            let material = materials
                .get(certificate_id)
                .ok_or(RenderError::MissingCertificate)?;
            if loaded_certificate_ids.insert(certificate_id.clone()) {
                certs.push(CertificateFile {
                    certificate: certificate_path(&material.fullchain_path)?,
                    key: certificate_path(&material.private_key_path)?,
                    tags: vec![certificate_id.clone()],
                });
            }
            policies.push(TlsConnectionPolicy {
                matcher: TlsMatcher {
                    sni: host.domains.clone(),
                },
                certificate_selection: CertificateSelection {
                    any_tag: vec![certificate_id.clone()],
                },
                protocol_min: "tls1.2".to_owned(),
                alpn: vec!["h2".to_owned(), "http/1.1".to_owned()],
            });
            https_routes.push(redirect_route(host)?);
        }
        if !certs.is_empty() {
            https_routes.push(not_found_route());
            servers.insert(
                "rentnerproxy-https".to_owned(),
                HttpServer {
                    listen: vec![format!(":{}", tls.https_port)],
                    routes: https_routes,
                    automatic_https: AutoHttps { disable: true },
                    protocols: vec!["h1".to_owned(), "h2".to_owned(), "h3".to_owned()],
                    allow_0rtt: Some(false),
                    errors: Some(error_config(tls.public_https_port)),
                    read_header_timeout: "15s".to_owned(),
                    write_timeout: seconds(config.http_settings.send_timeout_seconds),
                    idle_timeout: seconds(config.http_settings.keepalive_timeout_seconds),
                    strict_sni_host: Some(true),
                    trusted_proxies: trusted_proxies(&settings.trusted_proxy_cidrs),
                    trusted_proxies_strict: (!settings.trusted_proxy_cidrs.is_empty()).then_some(1),
                    tls_connection_policies: Some(policies),
                    logs: Some(ServerLogs {}),
                },
            );
            tls_app = Some(TlsApp {
                certificates: CertificateLoaders { load_files: certs },
            });
        }
    }

    let output = serde_json::to_string(&CaddyConfig {
        admin: Admin {
            listen: admin_listen,
            config: AdminConfig { persist: true },
        },
        storage: Storage {
            module: "file_system".to_owned(),
            root: format!("{state_root}/caddy/data"),
        },
        logging: logging_config(&state_root),
        apps: Apps {
            http: HttpApp { servers },
            tls: tls_app,
        },
    })
    .map_err(|_| RenderError::ConfigTooLarge)?;
    if output.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
        return Err(RenderError::ConfigTooLarge);
    }
    Ok(output)
}

fn empty_config() -> ValidatedProxyConfig {
    ValidatedProxyConfig {
        revision: String::new(),
        proxy_hosts: Vec::new(),
        redirect_hosts: Vec::new(),
        http_settings: ProxyHttpSettings::default(),
        trusted_cas: Vec::new(),
    }
}

fn logging_config(state_root: &str) -> Value {
    let filters = json!({
        "format": "filter",
        "wrap": { "format": "json" },
        "fields": {
            "request>headers": { "filter": "delete" },
            "resp_headers": { "filter": "delete" },
            "user_id": { "filter": "delete" },
            "request>uri": { "filter": "regexp", "regexp": "\\?.*$", "value": "" }
        }
    });
    let file = json!({
        "output": "file",
        "filename": format!("{state_root}/logs/access.log"),
        "mode": "0600",
        "dir_mode": "0700",
        "roll_size_mb": 4,
        "roll_keep": 4,
        "roll_keep_days": 7,
        "roll_compression": "none"
    });
    json!({
        "logs": {
            "default": {
                "writer": { "output": "stderr" },
                "encoder": filters.clone(),
                "exclude": ["http.log.access"]
            },
            "access": {
                "writer": file,
                "encoder": filters,
                "include": ["http.log.access"]
            }
        }
    })
}

fn alt_svc_route(public_https_port: u16) -> Route {
    Route {
        matchers: Vec::new(),
        handle: vec![
            alt_svc_handler(public_https_port, true),
            alt_svc_handler(public_https_port, false),
        ],
        terminal: false,
    }
}

fn alt_svc_handler(public_https_port: u16, deferred: bool) -> Handler {
    Handler::Headers(Headers {
        response: ResponseHeaders {
            set: BTreeMap::from([(
                "Alt-Svc".to_owned(),
                vec![format!("h3=\":{public_https_port}\"; ma=2592000")],
            )]),
            deferred,
        },
    })
}

fn error_config(public_https_port: u16) -> ErrorConfig {
    ErrorConfig {
        routes: vec![Route {
            matchers: Vec::new(),
            handle: vec![
                alt_svc_handler(public_https_port, false),
                Handler::ErrorResponse(ErrorResponse {
                    status_code: ErrorStatus::Original,
                }),
            ],
            terminal: true,
        }],
    }
}
