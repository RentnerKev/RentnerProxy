use std::{collections::BTreeMap, net::IpAddr, path::Path};

use ipnet::{IpNet, Ipv6Net};

use crate::models::{ProxyHost, ProxyHttpSettings, RedirectHost};

use super::{
    RenderError, UpstreamTlsRenderSettings,
    model::{
        CaSource, HeaderOps, HttpTransport, RequestHeaders, ReverseProxy, TrustedProxies, Upstream,
        UpstreamTls,
    },
};

pub(super) fn rendered_ranges(ranges: &[String]) -> Vec<String> {
    let mut rendered = Vec::with_capacity(ranges.len() * 2);
    for range in ranges {
        rendered.push(range.clone());
        if let Ok(IpNet::V4(net)) = range.parse::<IpNet>() {
            let mapped = Ipv6Net::new(net.network().to_ipv6_mapped(), 96 + net.prefix_len())
                .expect("mapped IPv4 CIDR is always valid");
            rendered.push(IpNet::V6(mapped).to_string());
        }
    }
    rendered
}
pub(super) fn reverse_proxy(
    upstream: &str,
    host: Option<&ProxyHost>,
    defaults: Option<&ProxyHttpSettings>,
    ca_settings: Option<&UpstreamTlsRenderSettings>,
    forwarded_proto: &str,
) -> Result<ReverseProxy, RenderError> {
    let mut set = BTreeMap::new();
    set.insert("Host".to_owned(), vec!["{http.request.host}".to_owned()]);
    set.insert(
        "X-Real-IP".to_owned(),
        vec!["{http.request.remote.host}".to_owned()],
    );
    set.insert(
        "X-Forwarded-Proto".to_owned(),
        vec![forwarded_proto.to_owned()],
    );
    let mut transport = HttpTransport {
        protocol: "http".to_owned(),
        dial_timeout: None,
        read_timeout: None,
        response_header_timeout: None,
        write_timeout: None,
        tls: None,
    };
    if let Some(host) = host {
        let settings = &host.http_settings;
        transport.dial_timeout = seconds(
            settings
                .proxy_connect_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_connect_timeout_seconds)),
        );
        transport.read_timeout = seconds(
            settings
                .proxy_read_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_read_timeout_seconds)),
        );
        transport.response_header_timeout = seconds(
            settings
                .proxy_read_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_read_timeout_seconds)),
        );
        transport.write_timeout = seconds(
            settings
                .proxy_send_timeout_seconds
                .or_else(|| defaults.and_then(|v| v.proxy_send_timeout_seconds)),
        );
        if host.forward_scheme == "https" {
            let policy = Some(
                host.upstream_tls
                    .as_ref()
                    .ok_or(RenderError::MissingUpstreamTlsPolicy)?,
            );
            let server_name = policy.and_then(|p| p.server_name.clone()).or_else(|| {
                host.forward_host
                    .parse::<IpAddr>()
                    .ok()
                    .is_none()
                    .then(|| host.forward_host.clone())
            });
            let (ca, insecure) = match (policy, ca_settings) {
                (Some(policy), Some(settings)) if policy.verify => {
                    let path = match policy.trusted_ca_id.as_ref() {
                        Some(id) => settings
                            .trusted_ca_paths
                            .get(id)
                            .ok_or(RenderError::MissingTrustedCa)?,
                        None => &settings.system_ca_bundle,
                    };
                    (
                        Some(CaSource {
                            provider: "file".to_owned(),
                            pem_files: vec![certificate_path(path)?],
                        }),
                        None,
                    )
                }
                (Some(policy), None) if policy.verify => return Err(RenderError::MissingTrustedCa),
                (Some(_), _) => (None, Some(true)),
                _ => (None, None),
            };
            transport.tls = Some(UpstreamTls {
                ca,
                insecure_skip_verify: insecure,
                server_name,
            });
        }
    }
    Ok(ReverseProxy {
        upstreams: vec![Upstream {
            dial: upstream.to_owned(),
        }],
        headers: RequestHeaders {
            request: HeaderOps {
                set,

                delete: [
                    "Forwarded",
                    "X-Forwarded-Port",
                    "X-Forwarded-Prefix",
                    "Proxy",
                ]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            },
        },
        transport,
        stream_close_delay: "5m".to_owned(),
    })
}

pub(super) fn location_headers(value: String) -> BTreeMap<String, Vec<String>> {
    BTreeMap::from([
        (
            String::from("Cache-Control"),
            vec![String::from("no-store")],
        ),
        (String::from("Location"), vec![value]),
    ])
}

pub(super) fn force_https_headers(value: String) -> BTreeMap<String, Vec<String>> {
    location_headers(value)
}

pub(super) fn trusted_proxies(cidrs: &[String]) -> Option<TrustedProxies> {
    (!cidrs.is_empty()).then(|| TrustedProxies {
        source: "static".to_owned(),
        ranges: rendered_ranges(cidrs),
    })
}

pub(super) fn upstream_dial(host: &str, port: u16) -> String {
    if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

pub(super) fn force_https_location(port: u16) -> String {
    if port == 443 {
        "https://{http.request.host}{http.request.uri}".to_owned()
    } else {
        format!("https://{{http.request.host}}:{port}{{http.request.uri}}")
    }
}

pub(super) fn redirect_location(host: &RedirectHost) -> String {
    if host.preserve_request_uri {
        format!("{}{{http.request.uri}}", host.destination)
    } else {
        host.destination.clone()
    }
}

pub(super) fn seconds(value: Option<u32>) -> Option<String> {
    value.map(|value| format!("{value}s"))
}

pub(super) fn path_string(path: &Path, error: RenderError) -> Result<String, RenderError> {
    let value = path.to_str().ok_or(error)?.replace('\\', "/");
    if !path.is_absolute()
        || value.is_empty()
        || value
            .bytes()
            .any(|b| b.is_ascii_control() || matches!(b, b'|' | b'{' | b'}'))
    {
        return Err(error);
    }
    Ok(value)
}

pub(super) fn admin_listen(path: Option<&Path>) -> Result<String, RenderError> {
    path.map(|path| {
        path_string(path, RenderError::InvalidProbeSocket).map(|value| format!("unix/{value}|0600"))
    })
    .transpose()?
    .map_or_else(|| Ok("127.0.0.1:2019".to_owned()), Ok)
}

pub(super) fn probe_listen(path: &Path) -> Result<String, RenderError> {
    path_string(path, RenderError::InvalidProbeSocket).map(|value| format!("unix/{value}|0600"))
}

pub(super) fn certificate_path(path: &Path) -> Result<String, RenderError> {
    path_string(path, RenderError::InvalidCertificatePath)
}
