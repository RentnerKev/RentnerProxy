use std::net::{Ipv4Addr, Ipv6Addr};

use crate::models::ForwardAuth;

use super::is_canonical_domain;

pub(crate) struct ForwardAuthEndpoint<'a> {
    pub(crate) dial: String,
    pub(crate) host: &'a str,
    pub(crate) path: &'a str,
    pub(crate) https: bool,
}

pub(crate) fn parse_forward_auth_endpoint(value: &str) -> Option<ForwardAuthEndpoint<'_>> {
    if value.len() > 2_048 {
        return None;
    }
    let (https, remainder) = if let Some(rest) = value.strip_prefix("https://") {
        (true, rest)
    } else {
        (false, value.strip_prefix("http://")?)
    };
    let (authority, _) = remainder.split_once('/')?;
    let path = &remainder[authority.len()..];
    if authority.is_empty()
        || path.bytes().any(|byte| {
            !byte.is_ascii_graphic()
                || matches!(
                    byte,
                    b'%' | b'?' | b'#' | b'{' | b'}' | b'\\' | b'"' | b'\''
                )
        })
        || path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        || authority.bytes().any(|byte| {
            !byte.is_ascii_graphic()
                || matches!(
                    byte,
                    b'@' | b'?' | b'#' | b'{' | b'}' | b'\\' | b'"' | b'\''
                )
        })
    {
        return None;
    }
    let (host, port) = if let Some(after_open) = authority.strip_prefix('[') {
        let (host, suffix) = after_open.split_once(']')?;
        if host.parse::<Ipv6Addr>().is_err() || (!suffix.is_empty() && !suffix.starts_with(':')) {
            return None;
        }
        (host, suffix.strip_prefix(':'))
    } else {
        let (host, port) = authority
            .rsplit_once(':')
            .map_or((authority, None), |(host, port)| (host, Some(port)));
        if !(host.parse::<Ipv4Addr>().is_ok() || is_canonical_domain(host)) {
            return None;
        }
        (host, port)
    };
    let port = match port {
        Some(port) if !port.is_empty() && !port.starts_with('0') => port.parse::<u16>().ok()?,
        Some(_) => return None,
        None if https => 443,
        None => 80,
    };
    if port == 0 {
        return None;
    }
    let dial = if host.parse::<Ipv6Addr>().is_ok() {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    Some(ForwardAuthEndpoint {
        dial,
        host,
        path,
        https,
    })
}

pub(crate) fn has_valid_forward_auth(config: &ForwardAuth) -> bool {
    parse_forward_auth_endpoint(&config.endpoint).is_some()
        && (1..=30).contains(&config.timeout_seconds)
        && config.request_headers.len() <= 2
        && is_sorted_unique(&config.request_headers)
        && config
            .request_headers
            .iter()
            .all(|header| matches!(header.as_str(), "Authorization" | "Cookie"))
        && config.response_headers.len() <= 16
        && is_sorted_unique(&config.response_headers)
        && config.response_headers.iter().all(|header| {
            let bytes = header.as_bytes();
            (1..=64).contains(&bytes.len())
                && bytes[0].is_ascii_alphabetic()
                && bytes[1..]
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
                && header.split('-').all(|part| {
                    !part.is_empty()
                        && part.as_bytes()[0].is_ascii_uppercase()
                        && part.as_bytes()[1..]
                            .iter()
                            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                })
                && !is_reserved_response_header(header)
        })
        && config
            .gateway_path_prefix
            .as_deref()
            .is_none_or(is_valid_gateway_path_prefix)
}

fn is_valid_gateway_path_prefix(value: &str) -> bool {
    (2..=128).contains(&value.len())
        && value.starts_with('/')
        && value.ends_with('/')
        && !value.contains("//")
        && value
            .split('/')
            .all(|segment| segment != "." && segment != "..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
}

fn is_sorted_unique(headers: &[String]) -> bool {
    headers
        .windows(2)
        .all(|pair| pair[0].to_ascii_lowercase() < pair[1].to_ascii_lowercase())
}

fn is_reserved_response_header(header: &str) -> bool {
    let lower = header.to_ascii_lowercase();
    lower.starts_with("x-forwarded-")
        || lower.starts_with("sec-")
        || matches!(
            lower.as_str(),
            "authorization"
                | "cookie"
                | "set-cookie"
                | "host"
                | "forwarded"
                | "x-real-ip"
                | "connection"
                | "keep-alive"
                | "proxy-authenticate"
                | "proxy-authorization"
                | "proxy"
                | "proxy-connection"
                | "te"
                | "trailer"
                | "transfer-encoding"
                | "upgrade"
                | "content-length"
                | "content-type"
                | "location"
                | "via"
        )
}
