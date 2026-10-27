use super::{Code, Stage, Status};
use crate::models::{ProxyHost, TrustedCa};
use reqwest::{Certificate, Client, redirect::Policy};
use std::{
    io::Read,
    net::{IpAddr, SocketAddr},
    path::Path,
};
use tokio::time::{Instant, timeout_at};

pub(super) fn allowed(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_link_local()
                && a != 0
                && a < 224
                && ip.octets() != [100, 100, 100, 200]
                && ip.octets() != [168, 63, 129, 16]
                && !(a == 192 && b == 0)
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return allowed(IpAddr::V4(v4));
            }
            let segments = ip.segments();
            !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unicast_link_local()
                && ip
                    != "fd00:ec2::254"
                        .parse::<std::net::Ipv6Addr>()
                        .expect("constant IPv6")
                && segments[0] != 0x2002
                && !(segments[0] == 0x2001 && segments[1] == 0)
                && !(segments[0] == 0x64 && (segments[1] == 0xff9b))
        }
    }
}
// WHATWG URL parsing accepts numeric/hex/short IPv4 spellings that Rust's DNS
// validation treats as labels. They must not bypass the pinned DNS override.
fn transport_name(name: &str) -> bool {
    let authority = if name.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{name}]")
    } else {
        name.to_owned()
    };
    let Ok(url) = reqwest::Url::parse(&format!("http://{authority}/")) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    match name.parse::<IpAddr>() {
        Ok(expected) => host
            .parse::<IpAddr>()
            .is_ok_and(|actual| actual == expected),
        Err(_) => host == name && host.parse::<IpAddr>().is_err(),
    }
}
fn trust(
    host: &ProxyHost,
    cas: &[TrustedCa],
    system_ca: &Path,
) -> std::result::Result<Option<Vec<Certificate>>, ()> {
    let Some(policy) = &host.upstream_tls else {
        return Ok(None);
    };
    if !policy.verify {
        return Ok(None);
    }
    let roots = if let Some(id) = &policy.trusted_ca_id {
        let ca = cas.iter().find(|ca| &ca.id == id).ok_or(())?;
        Certificate::from_pem_bundle(ca.pem.as_bytes()).map_err(|_| ())?
    } else {
        let file = crate::runtime::state::open_absolute_regular_file(system_ca).map_err(|_| ())?;
        let mut bytes = Vec::new();
        file.take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(());
        }
        Certificate::from_pem_bundle(&bytes).map_err(|_| ())?
    };
    if roots.is_empty() || roots.len() > 2048 {
        return Err(());
    }
    Ok(Some(roots))
}
fn tls_failure(error: &reqwest::Error) -> bool {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    for _ in 0..16 {
        let Some(error) = source else { break };
        if error.downcast_ref::<rustls::Error>().is_some() {
            return true;
        }
        // hyper-rustls wraps tokio-rustls' io::Error in io::Error::other.
        // io::Error::source may skip the inner boxed error itself: inspect
        // get_ref before following source so typed rustls evidence survives.
        if let Some(inner) = error
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::get_ref)
        {
            source = Some(inner);
        } else {
            source = error.source();
        }
    }
    false
}
fn classify(status: u16) -> (Status, Code) {
    match status {
        200..=299 => (Status::Passed, Code::UpstreamResponded),
        300..=399 => (Status::Unknown, Code::RedirectNotFollowed),
        401 | 403 => (Status::Failed, Code::AccessDenied),
        500..=599 => (Status::Failed, Code::UpstreamError),
        _ => (Status::Unknown, Code::UnexpectedStatus),
    }
}

pub(super) async fn probe(
    host: &ProxyHost,
    domain: &str,
    addresses: &[IpAddr],
    cas: &[TrustedCa],
    system_ca: &Path,
    deadline: Instant,
) -> (Stage, Stage) {
    let start = Instant::now();
    let https = host.forward_scheme == "https";
    let verified = host
        .upstream_tls
        .as_ref()
        .is_some_and(|policy| policy.verify);
    let initial_tls = if https {
        Stage::new(
            Status::Unknown,
            if verified {
                Code::TlsUnconfirmed
            } else {
                Code::TlsVerificationDisabled
            },
        )
    } else {
        Stage::new(Status::NotApplicable, Code::HttpUpstream)
    };
    if addresses.is_empty() || addresses.iter().any(|ip| !allowed(*ip)) {
        return (
            Stage::new(Status::Failed, Code::UpstreamUnreachable).elapsed(start),
            initial_tls,
        );
    }
    let roots = match trust(host, cas, system_ca) {
        Ok(roots) => roots,
        Err(()) => {
            return (
                Stage::skipped(),
                Stage::new(Status::Failed, Code::TlsFailed).elapsed(start),
            );
        }
    };
    crate::runtime::tls::ensure_crypto_provider();
    let server = host
        .upstream_tls
        .as_ref()
        .and_then(|policy| policy.server_name.as_deref())
        .unwrap_or(&host.forward_host);
    if !transport_name(&host.forward_host) || !transport_name(server) {
        return (
            Stage::new(Status::Failed, Code::UpstreamUnreachable).elapsed(start),
            initial_tls,
        );
    }
    if server
        .parse::<IpAddr>()
        .is_ok_and(|literal| addresses.iter().any(|address| *address != literal))
    {
        return (
            Stage::new(Status::Failed, Code::UpstreamUnreachable).elapsed(start),
            initial_tls,
        );
    }
    let authority = if server.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{server}]")
    } else {
        server.to_owned()
    };
    let url = match reqwest::Url::parse(&format!(
        "{}://{}:{}/",
        host.forward_scheme, authority, host.forward_port
    )) {
        Ok(url) => url,
        Err(_) => {
            return (
                Stage::new(Status::Failed, Code::UpstreamUnreachable).elapsed(start),
                initial_tls,
            );
        }
    };
    let mut last = Stage::new(Status::Failed, Code::UpstreamUnreachable);
    let mut tls = initial_tls;
    for ip in addresses.iter().take(8) {
        if Instant::now() >= deadline {
            last = Stage::new(Status::Failed, Code::UpstreamTimeout);
            break;
        }
        let mut builder = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .http1_only()
            .http1_max_headers(64)
            .pool_max_idle_per_host(0)
            .timeout(deadline.saturating_duration_since(Instant::now()))
            .resolve_to_addrs(server, &[SocketAddr::new(*ip, host.forward_port)]);
        if let Some(roots) = &roots {
            builder = builder.tls_certs_only(roots.clone());
        }
        if https && !verified {
            builder = builder.tls_danger_accept_invalid_certs(true);
        }
        let client = match builder.build() {
            Ok(client) => client,
            Err(_) => {
                return (
                    Stage::new(Status::Failed, Code::UpstreamUnreachable).elapsed(start),
                    tls,
                );
            }
        };
        let response = timeout_at(
            deadline,
            client
                .head(url.clone())
                .header(reqwest::header::HOST, domain)
                .send(),
        )
        .await;
        match response {
            Ok(Ok(response)) => {
                let status = response.status().as_u16();
                let (state, code) = classify(status);
                let mut upstream = Stage::new(state, code).elapsed(start);
                upstream.http_status = Some(status);
                if https && verified {
                    tls = Stage::new(Status::Passed, Code::TlsVerified).elapsed(start)
                }
                return (upstream, tls);
            }
            Ok(Err(error)) => {
                last = Stage::new(
                    Status::Failed,
                    if error.is_timeout() {
                        Code::UpstreamTimeout
                    } else {
                        Code::UpstreamUnreachable
                    },
                );
                if https && verified && tls_failure(&error) {
                    tls = Stage::new(Status::Failed, Code::TlsFailed).elapsed(start);
                }
            }
            Err(_) => {
                last = Stage::new(Status::Failed, Code::UpstreamTimeout);
                break;
            }
        }
    }
    (last.elapsed(start), tls)
}
