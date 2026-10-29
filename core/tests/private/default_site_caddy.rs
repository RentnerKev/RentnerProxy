use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

use super::fixtures::request;
use crate::{
    models::{DefaultSite, RedirectHost},
    proxy::{revision_for_full_configuration, validate_proxy_config},
    runtime::renderer::{RenderSettings, render_config},
};

struct SmokeWorkspace(PathBuf);

impl SmokeWorkspace {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "rentnerproxy-default-site-caddy-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut directory = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
}

impl Drop for SmokeWorkspace {
    fn drop(&mut self) {
        if self.0.parent() == std::env::temp_dir().canonicalize().ok().as_deref()
            && self.0.file_name().is_some_and(|name| {
                name.to_string_lossy()
                    .starts_with("rentnerproxy-default-site-caddy-")
            })
        {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

struct CaddyChild(Child);

impl Drop for CaddyChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn exchange(address: SocketAddr, host: Option<&str>, path: &str) -> std::io::Result<Vec<u8>> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let host = host
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| address.to_string());
    stream.write_all(
        format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes(),
    )?;
    let mut bytes = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut buffer = [0u8; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::other("Caddy smoke response deadline"));
        }
        stream.set_read_timeout(Some(remaining))?;
        match stream.read(&mut buffer) {
            Ok(0) => return Ok(bytes),
            Ok(count) => {
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.len() > 524_288 {
                    return Err(std::io::Error::other("Caddy smoke response exceeds bound"));
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::ConnectionReset && bytes.is_empty() =>
            {
                return Ok(bytes);
            }
            Err(error) => return Err(error),
        }
    }
}

fn response(bytes: &[u8]) -> HttpResponse {
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("HTTP response headers");
    let header_text = std::str::from_utf8(&bytes[..split]).unwrap();
    let mut lines = header_text.split("\r\n");
    let status = lines
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers = lines
        .map(|line| {
            let (name, value) = line.split_once(':').unwrap();
            (name.to_ascii_lowercase(), value.trim().to_owned())
        })
        .collect();
    HttpResponse {
        status,
        headers,
        body: bytes[split + 4..].to_vec(),
    }
}

fn start_caddy(
    binary: &Path,
    workspace: &Path,
    mode_index: usize,
    site: DefaultSite,
    controller_addr: Option<SocketAddr>,
) -> (CaddyChild, SocketAddr, SocketAddr) {
    let listeners: Vec<_> = (0..2)
        .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
        .collect();
    let addresses: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap())
        .collect();
    let state = workspace.join(format!("state-{mode_index}"));
    std::fs::create_dir(&state).unwrap();
    let mut payload = request(Vec::new());
    payload.default_site = site;
    payload.redirect_hosts.push(RedirectHost {
        id: "018f4b4a-7d1f-7abc-8def-3123456789ab".into(),
        domains: vec!["known.example".into()],
        destination: "https://known-target.example/terminal".into(),
        status_code: 308,
        preserve_request_uri: false,
        certificate_id: None,
    });
    payload.revision = revision_for_full_configuration(
        &payload.proxy_hosts,
        &payload.redirect_hosts,
        &payload.http_settings,
        &payload.trusted_cas,
        &payload.default_site,
    );
    let config = validate_proxy_config(payload).unwrap();
    let rendered = render_config(
        Some(&config),
        &RenderSettings {
            http_port: addresses[0].port(),
            probe_socket: None,
            admin_socket: None,
            state_dir: state.clone(),
            controller_addr: controller_addr.unwrap_or(addresses[0]),
            trusted_proxy_cidrs: Vec::new(),
        },
    )
    .unwrap();
    let mut json: Value = serde_json::from_str(&rendered).unwrap();
    json["apps"]["http"]["servers"]["rentnerproxy-http"]["listen"] =
        json!([addresses[0].to_string()]);
    json["apps"]["http"]["servers"]["rentnerproxy-probe"]["listen"] =
        json!([addresses[1].to_string()]);
    start_rendered_caddy(binary, &state, json, listeners)
}

fn start_rendered_caddy(
    binary: &Path,
    state: &Path,
    mut json: Value,
    listeners: Vec<TcpListener>,
) -> (CaddyChild, SocketAddr, SocketAddr) {
    let addresses: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap())
        .collect();
    let config_path = state.join("caddy.json");
    let mut nonce = [0; 32];
    aws_lc_rs::rand::fill(&mut nonce).unwrap();
    let nonce: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
    let readiness_path = format!("/__smoke_ready_{nonce}");
    json["apps"]["http"]["servers"]["rentnerproxy-probe"]["routes"]
        .as_array_mut()
        .unwrap()
        .insert(
            0,
            json!({
                "match": [{"path": [readiness_path]}],
                "handle": [{"handler": "static_response", "status_code": 200, "body": nonce}],
                "terminal": true
            }),
        );
    std::fs::write(&config_path, serde_json::to_vec(&json).unwrap()).unwrap();
    let log_path = state.join("caddy-stderr.log");
    let mut command = Command::new(binary);
    command
        .args(["run", "--config"])
        .arg(&config_path)
        .current_dir(state)
        .env_clear()
        .env("SYNTHETIC_SENTINEL", "SYNTHETIC_VALUE_MUST_NEVER_EXPAND")
        .env("HOME", state)
        .env("USERPROFILE", state)
        .env("TEMP", state)
        .env("TMP", state)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(std::fs::File::create(&log_path).unwrap()));
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", system_root);
    }
    drop(listeners);
    let mut child = CaddyChild(command.spawn().expect("spawn test Caddy"));
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if child.0.try_wait().unwrap().is_some() {
            break;
        }
        if exchange(addresses[1], None, &readiness_path)
            .ok()
            .is_some_and(|bytes| smoke_readiness_matches(&bytes, &nonce))
            && child.0.try_wait().unwrap().is_none()
        {
            return (child, addresses[0], addresses[1]);
        }
        if child.0.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!(
        "Caddy failed bounded readiness: {}",
        std::fs::read_to_string(log_path).unwrap_or_default()
    );
}

fn smoke_readiness_matches(bytes: &[u8], nonce: &str) -> bool {
    let Some(split) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    (bytes.starts_with(b"HTTP/1.0 200 ") || bytes.starts_with(b"HTTP/1.1 200 "))
        && &bytes[split + 4..] == nonce.as_bytes()
}

#[test]
fn smoke_readiness_rejects_replacement_peers_and_malformed_responses() {
    let mut random = [0; 32];
    aws_lc_rs::rand::fill(&mut random).unwrap();
    let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    assert!(!smoke_readiness_matches(b"invalid", &nonce));
    assert!(!smoke_readiness_matches(
        b"HTTP/1.0 200 OK\r\n\r\nforeign",
        &nonce
    ));
    assert!(!smoke_readiness_matches(
        b"HTTP/1.1 200 OK\r\n\r\nforeign",
        &nonce
    ));
    assert!(smoke_readiness_matches(
        format!("HTTP/1.1 200 OK\r\n\r\n{nonce}").as_bytes(),
        &nonce
    ));
}

#[test]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN"]
fn default_site_real_caddy_smoke() {
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("set RENTNERPROXY_TEST_CADDY_BIN"),
    );
    let binary = binary.canonicalize().expect("test Caddy binary exists");
    let workspace = SmokeWorkspace::new();
    let fixture = workspace.0.join("synthetic-placeholder.txt");
    std::fs::write(&fixture, "SYNTHETIC_FILE_MUST_NEVER_EXPAND").unwrap();
    let html = format!(
        r#"<!doctype html><style>body{{color:red}}</style><pre>{{"mode":"test"}}</pre>{{env.SYNTHETIC_SENTINEL}}|{{file.{}}}|\{{literal}}|\\tail|{{}}|}}"#,
        fixture.display()
    );
    let modes = [
        DefaultSite::NotFound,
        DefaultSite::Welcome,
        DefaultSite::Close,
        DefaultSite::Redirect {
            url: "https://fallback.example/fixed?q=one#anchor".into(),
        },
        DefaultSite::CustomHtml { html: html.clone() },
    ];
    for (index, mode) in modes.into_iter().enumerate() {
        let (_child, public, probe) = start_caddy(&binary, &workspace.0, index, mode.clone(), None);
        let known =
            response(&exchange(public, Some("known.example"), "/incoming?discard=yes").unwrap());
        assert_eq!(known.status, 308);
        assert_eq!(
            known.headers["location"],
            "https://known-target.example/terminal"
        );
        for host in [Some("unknown.example"), None] {
            let bytes = exchange(public, host, "/incoming?discard=yes").unwrap();
            if matches!(mode, DefaultSite::Close) {
                assert!(
                    bytes.is_empty(),
                    "close must abort without any HTTP response bytes"
                );
                continue;
            }
            let result = response(&bytes);
            match &mode {
                DefaultSite::NotFound => assert_eq!(result.status, 404),
                DefaultSite::Redirect { url } => {
                    assert_eq!(result.status, 302);
                    assert_eq!(&result.headers["location"], url);
                    assert_eq!(result.headers["cache-control"], "no-store");
                }
                DefaultSite::Welcome | DefaultSite::CustomHtml { .. } => {
                    assert_eq!(result.status, 200);
                    assert_eq!(result.headers["content-type"], "text/html; charset=utf-8");
                    assert_eq!(result.headers["cache-control"], "no-store");
                    assert_eq!(result.headers["x-content-type-options"], "nosniff");
                    assert_eq!(result.headers["referrer-policy"], "no-referrer");
                    assert_eq!(
                        result.headers["content-security-policy"],
                        if matches!(mode, DefaultSite::Welcome) {
                            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                        } else {
                            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                        }
                    );
                    if matches!(mode, DefaultSite::CustomHtml { .. }) {
                        assert_eq!(result.body, html.as_bytes());
                    } else {
                        assert!(
                            std::str::from_utf8(&result.body)
                                .unwrap()
                                .contains("Welcome to RentnerProxy")
                        );
                    }
                }
                DefaultSite::Close => unreachable!(),
            }
        }
        assert_eq!(
            response(&exchange(probe, None, "/unmatched").unwrap()).status,
            404
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN and IPv6 loopback"]
async fn http01_real_caddy_reaches_ipv4_and_ipv6_controller_binds() {
    use crate::{
        runtime::{ProxyRuntime, RuntimeSettings},
        server::{AppState, app_with_state},
    };
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("set RENTNERPROXY_TEST_CADDY_BIN"),
    );
    let binary = binary.canonicalize().unwrap();
    let workspace = SmokeWorkspace::new();
    for (index, bind) in ["127.0.0.1:0", "[::1]:0"].into_iter().enumerate() {
        let listener = tokio::net::TcpListener::bind(bind).await.unwrap();
        let controller_addr = listener.local_addr().unwrap();
        let runtime = ProxyRuntime::new(
            RuntimeSettings::new(workspace.0.join(format!("controller-{index}")), 8080),
            None,
        );
        let state = AppState::new(runtime, None);
        state
            .challenges
            .insert(
                "challenge.example".to_owned(),
                "test-token".to_owned(),
                "test-token.proof".to_owned(),
            )
            .await
            .unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app_with_state(state)).await.unwrap();
        });
        let (_caddy, public, _) = start_caddy(
            &binary,
            &workspace.0,
            index,
            DefaultSite::NotFound,
            Some(controller_addr),
        );
        let challenge = response(
            &exchange(
                public,
                Some("challenge.example"),
                "/.well-known/acme-challenge/test-token",
            )
            .unwrap(),
        );
        assert_eq!(challenge.status, 200, "controller bind {controller_addr}");
        assert_eq!(challenge.body, b"test-token.proof");
        let missing = response(
            &exchange(
                public,
                Some("unknown.example"),
                "/.well-known/acme-challenge/test-token",
            )
            .unwrap(),
        );
        assert_eq!(missing.status, 404);
        server.abort();
        let _ = server.await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN"]
async fn real_caddy_x_real_ip_uses_effective_client_without_trusting_forged_headers() {
    verify_real_caddy_client_addresses(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN"]
async fn real_caddy_ip_policies_use_effective_clients_and_reject_spoofed_forwarded_headers() {
    verify_real_caddy_client_addresses(true).await;
}

async fn verify_real_caddy_client_addresses(ip_policy: bool) {
    use crate::models::{
        AccessPolicy, AccessPolicyCombination, AccessPolicyMode, BasicAuth, BasicAuthAccount,
        IpDefaultAction, IpRules,
    };
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    use crate::runtime::renderer::{
        TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings, render_config_with_tls,
    };
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("set RENTNERPROXY_TEST_CADDY_BIN"),
    );
    let binary = binary.canonicalize().unwrap();
    let workspace = SmokeWorkspace::new();
    let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream.local_addr().unwrap();
    let upstream_requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let echo_requests = upstream_requests.clone();
    let echo = axum::Router::new().route(
        "/",
        axum::routing::get(move |headers: axum::http::HeaderMap| {
            echo_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            async move {
                headers
                    .get("x-real-ip")
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned()
            }
        }),
    );
    let echo_task = tokio::spawn(async move {
        axum::serve(upstream, echo).await.unwrap();
    });
    let domain = "forwarded.example";
    let certificate = rcgen::generate_simple_self_signed(vec![domain.to_owned()]).unwrap();
    let material = TlsMaterial {
        fullchain_path: workspace.0.join("fullchain.pem"),
        private_key_path: workspace.0.join("private-key.pem"),
    };
    std::fs::write(&material.fullchain_path, certificate.cert.pem()).unwrap();
    std::fs::write(
        &material.private_key_path,
        certificate.signing_key.serialize_pem(),
    )
    .unwrap();
    let trusted_root = reqwest::Certificate::from_pem(certificate.cert.pem().as_bytes()).unwrap();
    let host_id = "018f4b4a-7d1f-7abc-8def-2123456789ab";
    let trusted = || vec!["127.0.0.1/32".to_owned(), "192.0.2.0/24".to_owned()];
    struct ClientCase {
        forwarded: Option<&'static str>,
        authenticated: bool,
        status: u16,
        client_ip: &'static str,
    }
    struct Scenario {
        name: &'static str,
        trusted: Vec<String>,
        policy: Option<AccessPolicy>,
        cases: Vec<ClientCase>,
    }
    let case = |forwarded, authenticated, status, client_ip| ClientCase {
        forwarded,
        authenticated,
        status,
        client_ip,
    };
    let policy = |default_action,
                  allow: &[&str],
                  deny: &[&str],
                  combination: Option<AccessPolicyCombination>| {
        Some(AccessPolicy {
            id: host_id.to_owned(),
            mode: if combination.is_some() {
                AccessPolicyMode::Combined
            } else {
                AccessPolicyMode::IpRestricted
            },
            combination,
            basic_auth: combination.map(|_| BasicAuth {
                accounts: vec![BasicAuthAccount {
                    username: "admin".to_owned(),
                    password_hash: "$argon2id$v=19$m=47104,t=1,p=1$9BnddYjm21weKEjnXdXxPLN3XGAfjqgTp+9xRuie7a4$p6SWsQ6S8czLMzeQ/Z4DKIPXPq+/ZFiX1dIraapovO8".to_owned(),
                }],
            }),
            forward_auth: None,
            ip_rules: Some(IpRules {
                default_action,
                allow: allow.iter().map(|value| (*value).to_owned()).collect(),
                deny: deny.iter().map(|value| (*value).to_owned()).collect(),
            }),
        })
    };
    let scenarios = if ip_policy {
        vec![
            Scenario {
                name: "untrusted headers cannot allow a blocked peer",
                trusted: Vec::new(),
                policy: policy(IpDefaultAction::Deny, &["203.0.113.0/24"], &[], None),
                cases: vec![
                    case(Some("203.0.113.7"), false, 403, ""),
                    case(None, false, 403, ""),
                ],
            },
            Scenario {
                name: "configured trust does not trust other peers",
                trusted: vec!["192.0.2.0/24".to_owned()],
                policy: policy(IpDefaultAction::Deny, &["203.0.113.0/24"], &[], None),
                cases: vec![case(Some("203.0.113.7"), false, 403, "")],
            },
            Scenario {
                name: "direct clients still use the connection address",
                trusted: Vec::new(),
                policy: policy(IpDefaultAction::Deny, &["127.0.0.1/32"], &[], None),
                cases: vec![
                    case(Some("198.51.100.66"), false, 200, "127.0.0.1"),
                    case(None, false, 200, "127.0.0.1"),
                ],
            },
            Scenario {
                name: "trusted clients allow and deny independently of their proxy",
                trusted: trusted(),
                policy: policy(
                    IpDefaultAction::Deny,
                    &["203.0.113.0/24"],
                    &["127.0.0.1/32"],
                    None,
                ),
                cases: vec![
                    case(Some("203.0.113.7"), false, 200, "203.0.113.7"),
                    case(Some("::ffff:203.0.113.7"), false, 200, "::ffff:203.0.113.7"),
                    case(
                        Some("198.51.100.66, 203.0.113.7, 192.0.2.10"),
                        false,
                        200,
                        "203.0.113.7",
                    ),
                    case(
                        Some("203.0.113.7, 198.51.100.66, 192.0.2.10"),
                        false,
                        403,
                        "",
                    ),
                    case(Some("198.51.100.66"), false, 403, ""),
                    case(None, false, 403, ""),
                    case(Some("not-an-address"), false, 403, ""),
                ],
            },
            Scenario {
                name: "default allow still denies the effective client",
                trusted: trusted(),
                policy: policy(IpDefaultAction::Allow, &[], &["203.0.113.0/24"], None),
                cases: vec![
                    case(Some("198.51.100.66"), false, 200, "198.51.100.66"),
                    case(Some("203.0.113.7"), false, 403, ""),
                    case(Some("::ffff:203.0.113.7"), false, 403, ""),
                ],
            },
            Scenario {
                name: "mixed IPv6 and IPv4 rules preserve mapped address exclusions",
                trusted: trusted(),
                policy: policy(
                    IpDefaultAction::Deny,
                    &["203.0.113.0/24", "::/0"],
                    &["2001:db8:bad::/48"],
                    None,
                ),
                cases: vec![
                    case(Some("::ffff:203.0.113.7"), false, 200, "::ffff:203.0.113.7"),
                    case(Some("::ffff:198.51.100.66"), false, 403, ""),
                    case(Some("2001:db8::7"), false, 200, "2001:db8::7"),
                    case(Some("2001:db8:bad::7"), false, 403, ""),
                ],
            },
            Scenario {
                name: "combined all requires the client IP and credentials",
                trusted: trusted(),
                policy: policy(
                    IpDefaultAction::Deny,
                    &["203.0.113.0/24"],
                    &["203.0.113.128/25"],
                    Some(AccessPolicyCombination::All),
                ),
                cases: vec![
                    case(Some("203.0.113.7"), false, 401, ""),
                    case(Some("203.0.113.7"), true, 200, "203.0.113.7"),
                    case(Some("198.51.100.66"), true, 403, ""),
                    case(Some("203.0.113.200"), true, 403, ""),
                ],
            },
            Scenario {
                name: "combined any keeps credentials as a fallback for blocked clients",
                trusted: trusted(),
                policy: policy(
                    IpDefaultAction::Deny,
                    &["203.0.113.0/24"],
                    &["203.0.113.128/25"],
                    Some(AccessPolicyCombination::Any),
                ),
                cases: vec![
                    case(Some("203.0.113.7"), false, 200, "203.0.113.7"),
                    case(Some("198.51.100.66"), false, 401, ""),
                    case(Some("198.51.100.66"), true, 200, "198.51.100.66"),
                    case(Some("203.0.113.200"), false, 401, ""),
                    case(Some("203.0.113.200"), true, 200, "203.0.113.200"),
                ],
            },
        ]
    } else {
        vec![
            Scenario {
                name: "untrusted forwarded headers do not change the upstream client",
                trusted: Vec::new(),
                policy: None,
                cases: vec![
                    case(None, false, 200, "127.0.0.1"),
                    case(Some("203.0.113.7"), false, 200, "127.0.0.1"),
                    case(
                        Some("198.51.100.66, 203.0.113.7, 192.0.2.10"),
                        false,
                        200,
                        "127.0.0.1",
                    ),
                ],
            },
            Scenario {
                name: "trusted forwarded clients are passed to the upstream",
                trusted: trusted(),
                policy: None,
                cases: vec![
                    case(None, false, 200, "127.0.0.1"),
                    case(Some("203.0.113.7"), false, 200, "203.0.113.7"),
                    case(
                        Some("198.51.100.66, 203.0.113.7, 192.0.2.10"),
                        false,
                        200,
                        "203.0.113.7",
                    ),
                ],
            },
        ]
    };
    for (index, scenario) in scenarios.into_iter().enumerate() {
        let listeners: Vec<_> = (0..3)
            .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
            .collect();
        let addresses: Vec<_> = listeners
            .iter()
            .map(|listener| listener.local_addr().unwrap())
            .collect();
        let state = workspace.0.join(format!("forwarded-{index}"));
        std::fs::create_dir(&state).unwrap();
        let mut host = super::fixtures::host(
            host_id,
            &[domain],
            "http",
            "127.0.0.1",
            upstream_addr.port(),
        );
        host.certificate_id = Some(host_id.to_owned());
        host.access_policy = scenario.policy;
        let config = validate_proxy_config(request(vec![host]))
            .unwrap_or_else(|error| panic!("invalid fixture {}: {error:?}", scenario.name));
        let settings = RenderSettings {
            http_port: addresses[0].port(),
            probe_socket: None,
            admin_socket: None,
            state_dir: state.clone(),
            controller_addr: upstream_addr,
            trusted_proxy_cidrs: scenario.trusted,
        };
        let rendered = render_config_with_tls(
            &config,
            &settings,
            &TlsRenderSettings {
                https_port: addresses[2].port(),
                public_https_port: addresses[2].port(),
                controller_port: upstream_addr.port(),
            },
            &BTreeMap::from([(host_id.to_owned(), material.clone())]),
            &UpstreamTlsRenderSettings {
                system_ca_bundle: PathBuf::from("/etc/ssl/certs/ca-certificates.crt"),
                trusted_ca_paths: BTreeMap::new(),
            },
        )
        .unwrap();
        let mut json: Value = serde_json::from_str(&rendered).unwrap();
        for (name, address) in [
            ("rentnerproxy-http", addresses[0]),
            ("rentnerproxy-probe", addresses[1]),
            ("rentnerproxy-https", addresses[2]),
        ] {
            json["apps"]["http"]["servers"][name]["listen"] = json!([address.to_string()]);
        }
        let (_caddy, _, _) = start_rendered_caddy(&binary, &state, json, listeners);
        let client = reqwest::Client::builder()
            .no_proxy()
            .add_root_certificate(trusted_root.clone())
            .resolve(domain, addresses[2])
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        for case in scenario.cases {
            for (url, forwarded_proto) in [
                (format!("http://127.0.0.1:{}/", addresses[0].port()), None),
                (
                    format!("http://127.0.0.1:{}/", addresses[0].port()),
                    Some("https"),
                ),
                (format!("https://{domain}:{}/", addresses[2].port()), None),
            ] {
                let mut request = client
                    .get(url)
                    .header("Host", domain)
                    .header("X-Real-IP", "198.51.100.99");
                if let Some(forwarded) = case.forwarded {
                    request = request.header("X-Forwarded-For", forwarded);
                }
                if let Some(proto) = forwarded_proto {
                    request = request.header("X-Forwarded-Proto", proto);
                }
                if case.authenticated {
                    request = request.basic_auth("admin", Some("fixture-password"));
                }
                let before = upstream_requests.load(std::sync::atomic::Ordering::Relaxed);
                let response = request.send().await.unwrap();
                assert_eq!(
                    response.status(),
                    case.status,
                    "{}, XFF={:?}, XFP={forwarded_proto:?}, authenticated={}",
                    scenario.name,
                    case.forwarded,
                    case.authenticated,
                );
                if case.status != 200 {
                    assert_eq!(
                        upstream_requests.load(std::sync::atomic::Ordering::Relaxed),
                        before,
                        "denied requests must not reach the upstream"
                    );
                    continue;
                }
                assert_eq!(
                    response.text().await.unwrap(),
                    case.client_ip,
                    "{}, XFF={:?}, XFP={forwarded_proto:?}",
                    scenario.name,
                    case.forwarded,
                );
            }
        }
    }
    echo_task.abort();
    let _ = echo_task.await;
}

const COMPRESSED_UPSTREAM: &[u8] = &[
    31, 139, 8, 0, 0, 0, 0, 0, 2, 255, 115, 204, 41, 74, 77, 76, 169, 84, 72, 206, 207, 45, 40, 74,
    45, 46, 78, 77, 81, 40, 45, 40, 46, 1, 10, 230, 42, 20, 36, 86, 230, 228, 39, 166, 232, 41, 56,
    142, 42, 26, 85, 52, 170, 104, 84, 209, 168, 162, 81, 69, 163, 138, 32, 138, 0, 187, 30, 39,
    241, 58, 7, 0, 0,
];

fn compression_exchange(
    address: SocketAddr,
    path: &str,
    encoding: &str,
    method: &str,
) -> HttpResponse {
    compression_exchange_host(address, path, encoding, method, "compression.example")
}

fn compression_exchange_host(
    address: SocketAddr,
    path: &str,
    encoding: &str,
    method: &str,
    host: &str,
) -> HttpResponse {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(1)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(stream, "{method} {path} HTTP/1.0\r\nHost: {host}\r\nAccept-Encoding: {encoding}\r\nConnection: close\r\n\r\n").unwrap();
    let mut bytes = Vec::new();
    read_smoke_body(&mut stream, &mut bytes).unwrap();
    response(&bytes)
}

const MAX_SMOKE_BODY: usize = 524_288;

fn read_smoke_body(stream: &mut TcpStream, bytes: &mut Vec<u8>) -> std::io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut buffer = [0; 4096];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::other("smoke response deadline"));
        }
        stream.set_read_timeout(Some(remaining))?;
        let n = stream.read(&mut buffer)?;
        if n == 0 {
            return Ok(());
        }
        if n > MAX_SMOKE_BODY.saturating_sub(bytes.len()) {
            return Err(std::io::Error::other("smoke response exceeds bound"));
        }
        bytes.extend_from_slice(&buffer[..n]);
    }
}

fn decompress_response(bytes: &[u8], encoding: &str) -> Vec<u8> {
    assert!(
        bytes.len() <= MAX_SMOKE_BODY,
        "compressed input exceeds bound"
    );
    assert!(matches!(encoding, "gzip" | "zstd"));
    let binary = std::env::var_os("RENTNERPROXY_TEST_BUN_BIN").unwrap_or_else(|| "bun".into());
    let script = r#"
        const { Transform } = require('node:stream');
        const { pipeline } = require('node:stream/promises');
        const { createGunzip, createZstdDecompress, constants } = require('node:zlib');
        function bounded(max) {
            let size = 0;
            return new Transform({ transform(chunk, _, done) {
                size += chunk.length;
                done(size > max ? new Error('smoke payload exceeds bound') : null,
                    size > max ? undefined : chunk);
            }});
        }
        await pipeline(process.stdin, bounded(524288),
            process.argv[1] === 'gzip' ? createGunzip() : createZstdDecompress({
                params: { [constants.ZSTD_d_windowLogMax]: 20 }
            }),
            bounded(524288), process.stdout);
    "#;
    let mut child = CaddyChild(
        Command::new(binary)
            .args(["--no-env-file", "-e", script, encoding])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("Bun is required to decode smoke response payloads"),
    );
    let mut input = child.0.stdin.take().unwrap();
    let input_bytes = bytes.to_vec();
    let writer = std::thread::spawn(move || input.write_all(&input_bytes));
    let output = child.0.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut decoded = Vec::new();
        output
            .take((MAX_SMOKE_BODY + 1) as u64)
            .read_to_end(&mut decoded)?;
        Ok::<_, std::io::Error>(decoded)
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    let status = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= deadline {
            let _ = child.0.kill();
            let _ = child.0.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let written = writer.join().unwrap();
    let decoded = reader.join().unwrap().unwrap();
    assert!(
        status.is_some_and(|status| status.success()),
        "bounded smoke decompression failed"
    );
    written.unwrap();
    assert!(
        decoded.len() <= MAX_SMOKE_BODY,
        "decoded output exceeds bound"
    );
    decoded
}

#[test]
#[should_panic(expected = "compressed input exceeds bound")]
fn smoke_decompression_rejects_oversized_input_before_spawning() {
    decompress_response(&vec![0; MAX_SMOKE_BODY + 1], "gzip");
}

#[test]
#[ignore = "requires Bun for bounded streaming payload decoding"]
fn smoke_decompression_bounds_expansion_and_rejects_corrupt_payloads() {
    assert_eq!(
        decompress_response(COMPRESSED_UPSTREAM, "gzip"),
        b"Already compressed upstream payload. ".repeat(50)
    );
    assert!(
        std::panic::catch_unwind(|| {
            decompress_response(&COMPRESSED_UPSTREAM.repeat(400), "gzip")
        })
        .is_err()
    );
    for encoding in ["gzip", "zstd"] {
        assert!(std::panic::catch_unwind(|| decompress_response(b"invalid", encoding)).is_err());
    }
}

#[test]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN and Bun for payload decoding"]
fn response_compression_real_caddy_smoke() {
    use crate::models::{ProxyHttpSettings, ResponseCompression};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    };

    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("set RENTNERPROXY_TEST_CADDY_BIN"),
    )
    .canonicalize()
    .unwrap();
    let workspace = SmokeWorkspace::new();
    let payload = "Compression must preserve every byte. äöüß\n"
        .repeat(100)
        .into_bytes();
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    upstream.set_nonblocking(true).unwrap();
    let upstream_address = upstream.local_addr().unwrap();
    let running = Arc::new(AtomicBool::new(true));
    let worker_running = running.clone();
    let upstream_payload = payload.clone();
    let (release_stream, stream_release) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        while worker_running.load(Ordering::Relaxed) {
            let Ok((mut socket, _)) = upstream.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                if socket.read(&mut byte).unwrap_or(0) == 0 {
                    break;
                }
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap();
            let path = request.split_whitespace().nth(1).unwrap_or("/");
            if path == "/stream" {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: first\n\n").unwrap();
                socket.flush().unwrap();
                let _ = stream_release.recv_timeout(Duration::from_secs(3));
                let _ = socket.write_all(b"data: last\n\n");
                continue;
            }
            let (mime, body, extra) = match path {
                "/small" => ("text/plain", b"small".as_slice(), ""),
                "/binary" => ("image/png", upstream_payload.as_slice(), ""),
                "/encoded" => (
                    "text/plain",
                    COMPRESSED_UPSTREAM,
                    "Content-Encoding: gzip\r\n",
                ),
                "/no-transform" => (
                    "text/plain",
                    upstream_payload.as_slice(),
                    "Cache-Control: no-transform\r\n",
                ),
                _ => ("text/plain; charset=utf-8", upstream_payload.as_slice(), ""),
            };
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n", body.len()).unwrap();
            if !request.starts_with("HEAD ") {
                let _ = socket.write_all(body);
            }
        }
    });
    // The worker is bounded even if a response assertion fails.
    struct StopWorker(Arc<AtomicBool>);
    impl Drop for StopWorker {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Relaxed);
        }
    }
    let _stop_worker = StopWorker(running.clone());
    let listeners: Vec<_> = (0..2)
        .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
        .collect();
    let addresses: Vec<_> = listeners.iter().map(|v| v.local_addr().unwrap()).collect();
    let state = workspace.0.join("compression");
    std::fs::create_dir(&state).unwrap();
    let mut host = super::fixtures::host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["compression.example"],
        "http",
        "127.0.0.1",
        upstream_address.port(),
    );
    let mut disabled = host.clone();
    disabled.id = "018f4b4a-7d1f-7abc-8def-1123456789ab".into();
    disabled.domains = vec!["off.example".into()];
    disabled.http_settings.response_compression = Some(ResponseCompression::Off);
    host.http_settings.response_compression = None;
    let config = validate_proxy_config(super::fixtures::request_with_settings(
        vec![host, disabled],
        ProxyHttpSettings {
            response_compression: Some(ResponseCompression::Auto),
            ..Default::default()
        },
    ))
    .unwrap();
    let rendered = render_config(
        Some(&config),
        &RenderSettings {
            http_port: addresses[0].port(),
            probe_socket: None,
            admin_socket: None,
            state_dir: state.clone(),
            controller_addr: addresses[0],
            trusted_proxy_cidrs: Vec::new(),
        },
    )
    .unwrap();
    let mut json: Value = serde_json::from_str(&rendered).unwrap();
    json["apps"]["http"]["servers"]["rentnerproxy-http"]["listen"] =
        json!([addresses[0].to_string()]);
    json["apps"]["http"]["servers"]["rentnerproxy-probe"]["listen"] =
        json!([addresses[1].to_string()]);
    let (_caddy, address, _) = start_rendered_caddy(&binary, &state, json, listeners);
    for (accept, expected) in [
        ("gzip", "gzip"),
        ("zstd", "zstd"),
        ("gzip, zstd", "zstd"),
        ("zstd;q=0.2, gzip;q=1", "gzip"),
    ] {
        let result = compression_exchange(address, "/", accept, "GET");
        assert_eq!(result.status, 200);
        assert_eq!(result.headers.get("content-encoding").unwrap(), expected);
        assert!(
            result
                .headers
                .get("vary")
                .unwrap()
                .to_ascii_lowercase()
                .contains("accept-encoding")
        );
        assert_eq!(decompress_response(&result.body, expected), payload);
    }
    for path in ["/small", "/binary", "/no-transform"] {
        let result = compression_exchange(address, path, "zstd, gzip", "GET");
        assert!(!result.headers.contains_key("content-encoding"));
        assert_eq!(
            result.body,
            if path == "/small" {
                b"small".to_vec()
            } else {
                payload.clone()
            }
        );
    }
    for encoding in ["identity", "br", "gzip;q=0, zstd;q=0"] {
        let result = compression_exchange(address, "/", encoding, "GET");
        assert!(!result.headers.contains_key("content-encoding"));
        assert_eq!(result.body, payload);
    }
    let preserved = compression_exchange(address, "/encoded", "zstd, gzip", "GET");
    assert_eq!(preserved.headers.get("content-encoding").unwrap(), "gzip");
    assert_eq!(preserved.body, COMPRESSED_UPSTREAM);
    assert_eq!(
        decompress_response(&preserved.body, "gzip"),
        b"Already compressed upstream payload. ".repeat(50)
    );
    let off = compression_exchange_host(address, "/", "zstd, gzip", "GET", "off.example");
    assert!(!off.headers.contains_key("content-encoding"));
    assert_eq!(off.body, payload);
    let off_encoded =
        compression_exchange_host(address, "/encoded", "zstd, gzip", "GET", "off.example");
    assert_eq!(off_encoded.body, COMPRESSED_UPSTREAM);
    assert_eq!(off_encoded.headers.get("content-encoding").unwrap(), "gzip");
    assert!(
        compression_exchange(address, "/", "gzip", "HEAD")
            .body
            .is_empty()
    );

    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    stream
        .write_all(
            b"GET /stream HTTP/1.0\r\nHost: compression.example\r\nAccept-Encoding: gzip\r\n\r\n",
        )
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    let header_deadline = Instant::now() + Duration::from_secs(3);
    while !bytes.windows(4).any(|v| v == b"\r\n\r\n") {
        let remaining = header_deadline.saturating_duration_since(Instant::now());
        assert!(!remaining.is_zero(), "SSE header deadline");
        stream.set_read_timeout(Some(remaining)).unwrap();
        let count = stream
            .read(&mut buffer)
            .expect("SSE headers must arrive before upstream completes");
        assert_ne!(count, 0);
        assert!(
            count <= 16_384usize.saturating_sub(bytes.len()),
            "SSE headers exceed bound"
        );
        bytes.extend_from_slice(&buffer[..count]);
    }
    release_stream.send(()).unwrap();
    read_smoke_body(&mut stream, &mut bytes).unwrap();
    let streamed = response(&bytes);
    assert_eq!(streamed.status, 200);
    let decoded = match streamed.headers.get("content-encoding") {
        Some(encoding) => decompress_response(&streamed.body, encoding),
        None => streamed.body,
    };
    assert_eq!(decoded, b"data: first\n\ndata: last\n\n");
    running.store(false, Ordering::Relaxed);
    worker.join().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires RENTNERPROXY_TEST_CADDY_BIN"]
async fn browser_cache_real_caddy_smoke() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    use crate::models::{
        AccessPolicy, AccessPolicyMode, BrowserCacheRule, BrowserCacheSettings, IpDefaultAction,
        IpRules,
    };
    use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri};
    let binary = PathBuf::from(
        std::env::var_os("RENTNERPROXY_TEST_CADDY_BIN").expect("set RENTNERPROXY_TEST_CADDY_BIN"),
    )
    .canonicalize()
    .unwrap();
    let workspace = SmokeWorkspace::new();
    let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_addr = upstream.local_addr().unwrap();
    let app = axum::Router::new().fallback(|uri: Uri| async move {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-type",
            HeaderValue::from_static("text/css; charset=utf-8"),
        );
        headers.insert("etag", HeaderValue::from_static("\"original\""));
        headers.insert("x-upstream", HeaderValue::from_static("preserved"));
        let mut status = StatusCode::OK;
        let file = uri.path().rsplit('/').next().unwrap_or_default();
        match file {
            "private.css" => {
                headers.insert(
                    "cache-control",
                    HeaderValue::from_static("private, max-age=5"),
                );
            }
            "no-store.css" => {
                headers.insert("cache-control", HeaderValue::from_static("no-store"));
            }
            "no-cache.css" => {
                headers.insert("cache-control", HeaderValue::from_static("no-cache"));
            }
            "public-policy.css" => {
                headers.insert(
                    "cache-control",
                    HeaderValue::from_static("public, max-age=17"),
                );
            }
            "cookie.css" => {
                headers.insert("set-cookie", HeaderValue::from_static("synthetic=1"));
            }
            "vary.css" => {
                headers.insert("vary", HeaderValue::from_static("Cookie"));
            }
            "expires.css" => {
                headers.insert("expires", HeaderValue::from_static("0"));
            }
            "pragma.css" => {
                headers.insert("pragma", HeaderValue::from_static("no-cache"));
            }
            "html.css" => {
                headers.insert("content-type", HeaderValue::from_static("text/html"));
            }
            "json.css" => {
                headers.insert("content-type", HeaderValue::from_static("application/json"));
            }
            "error.css" => status = StatusCode::INTERNAL_SERVER_ERROR,
            "missing.css" => status = StatusCode::NOT_FOUND,
            "redirect.css" => status = StatusCode::FOUND,
            "partial.css" => {
                status = StatusCode::PARTIAL_CONTENT;
                headers.insert("content-range", HeaderValue::from_static("bytes 0-2/3"));
            }
            "not-modified.css" => status = StatusCode::NOT_MODIFIED,
            _ => {}
        }
        (
            status,
            headers,
            if file == "compressed.css" {
                "body { color: red; }".repeat(100)
            } else {
                "body { color: red; }".to_owned()
            },
        )
    });
    let upstream_task = tokio::spawn(async move {
        axum::serve(upstream, app).await.unwrap();
    });
    let listeners: Vec<_> = (0..2)
        .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
        .collect();
    let addresses: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap())
        .collect();
    let mut public = super::fixtures::host(
        "018f4b4a-7d1f-7abc-8def-0123456789ab",
        &["assets.example"],
        "http",
        "127.0.0.1",
        upstream_addr.port(),
    );
    public.http_settings.browser_cache = Some(BrowserCacheSettings {
        enabled: true,
        rules: vec![
            BrowserCacheRule {
                path: "/assets/".to_owned(),
                max_age_seconds: 3600,
                immutable: true,
            },
            BrowserCacheRule {
                path: "/fixed.css".to_owned(),
                max_age_seconds: 60,
                immutable: false,
            },
        ],
    });
    let mut explicit_public = public.clone();
    explicit_public.id = "018f4b4a-7d1f-7abc-8def-4123456789ab".to_owned();
    explicit_public.domains = vec!["public-policy.example".to_owned()];
    explicit_public.access_policy = Some(AccessPolicy {
        id: explicit_public.id.clone(),
        mode: AccessPolicyMode::Public,
        combination: None,
        basic_auth: None,
        forward_auth: None,
        ip_rules: None,
    });
    let mut protected = public.clone();
    protected.id = "018f4b4a-7d1f-7abc-8def-1123456789ab".to_owned();
    protected.domains = vec!["protected.example".to_owned()];
    protected.access_policy = Some(AccessPolicy {
        id: protected.id.clone(),
        mode: AccessPolicyMode::IpRestricted,
        combination: None,
        basic_auth: None,
        forward_auth: None,
        ip_rules: Some(IpRules {
            default_action: IpDefaultAction::Allow,
            allow: vec![],
            deny: vec![],
        }),
    });
    let mut disabled = public.clone();
    disabled.id = "018f4b4a-7d1f-7abc-8def-2123456789ab".to_owned();
    disabled.domains = vec!["disabled.example".to_owned()];
    disabled
        .http_settings
        .browser_cache
        .as_mut()
        .unwrap()
        .enabled = false;
    let mut omitted = disabled.clone();
    omitted.id = "018f4b4a-7d1f-7abc-8def-3123456789ab".to_owned();
    omitted.domains = vec!["omitted.example".to_owned()];
    omitted.http_settings.browser_cache = None;
    let config = validate_proxy_config(super::fixtures::request_with_settings(
        vec![public, explicit_public, protected, disabled, omitted],
        crate::models::ProxyHttpSettings {
            response_compression: Some(crate::models::ResponseCompression::Auto),
            ..Default::default()
        },
    ))
    .unwrap();
    let rendered = render_config(
        Some(&config),
        &RenderSettings {
            http_port: addresses[0].port(),
            probe_socket: None,
            admin_socket: None,
            state_dir: workspace.0.clone(),
            controller_addr: upstream_addr,
            trusted_proxy_cidrs: Vec::new(),
        },
    )
    .unwrap();
    let mut json: Value = serde_json::from_str(&rendered).unwrap();
    json["apps"]["http"]["servers"]["rentnerproxy-http"]["listen"] =
        json!([addresses[0].to_string()]);
    json["apps"]["http"]["servers"]["rentnerproxy-probe"]["listen"] =
        json!([addresses[1].to_string()]);
    let (_child, address, _) = start_rendered_caddy(&binary, &workspace.0, json, listeners);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let url = |path: &str| format!("http://{address}{path}");
    for method in [reqwest::Method::GET, reqwest::Method::HEAD] {
        let response = client
            .request(method.clone(), url("/assets/public.css"))
            .header("Host", "assets.example")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["cache-control"],
            "public, max-age=3600, immutable"
        );
        assert_eq!(response.headers()["etag"], "\"original\"");
        assert_eq!(response.headers()["x-upstream"], "preserved");
        assert_eq!(
            response.text().await.unwrap(),
            if method == reqwest::Method::HEAD {
                ""
            } else {
                "body { color: red; }"
            }
        );
    }
    for method in [reqwest::Method::GET, reqwest::Method::HEAD] {
        let response = client
            .request(method, url("/assets/public.css"))
            .header("Host", "public-policy.example")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.headers()["cache-control"],
            "public, max-age=3600, immutable"
        );
    }
    let mut compressed = client
        .get(url("/assets/compressed.css"))
        .header("Host", "assets.example")
        .header("Accept-Encoding", "gzip")
        .send()
        .await
        .unwrap();
    assert_eq!(
        compressed.headers()["cache-control"],
        "public, max-age=3600, immutable"
    );
    assert_eq!(compressed.headers()["content-encoding"], "gzip");
    assert!(
        compressed.headers()["vary"]
            .to_str()
            .unwrap()
            .to_ascii_lowercase()
            .contains("accept-encoding")
    );
    let body = tokio::time::timeout(Duration::from_secs(3), async {
        let mut body = Vec::new();
        while let Some(chunk) = compressed.chunk().await.unwrap() {
            assert!(
                chunk.len() <= MAX_SMOKE_BODY - body.len(),
                "compressed input exceeds bound"
            );
            body.extend_from_slice(&chunk);
        }
        body
    })
    .await
    .unwrap();
    assert_eq!(
        decompress_response(&body, "gzip"),
        "body { color: red; }".repeat(100).as_bytes()
    );
    let exact = client
        .get(url("/fixed.css"))
        .header("Host", "assets.example")
        .send()
        .await
        .unwrap();
    assert_eq!(exact.headers()["cache-control"], "public, max-age=60");
    for path in [
        "/other/public.css",
        "/assets-other/public.css",
        "/fixed.css/extra",
        "/assets/public.css?token=synthetic",
        "/assets/cookie.css",
        "/assets/vary.css",
        "/assets/expires.css",
        "/assets/pragma.css",
        "/assets/html.css",
        "/assets/json.css",
        "/assets/error.css",
        "/assets/missing.css",
        "/assets/redirect.css",
        "/assets/partial.css",
        "/assets/not-modified.css",
    ] {
        let response = client
            .get(url(path))
            .header("Host", "assets.example")
            .send()
            .await
            .unwrap();
        if path == "/assets/pragma.css" {
            // Go's HTTP transport expands upstream Pragma: no-cache to Cache-Control.
            assert_eq!(response.headers()["cache-control"], "no-cache");
            assert_eq!(response.headers()["pragma"], "no-cache");
        } else {
            assert!(
                !response.headers().contains_key("cache-control"),
                "{path}: {:?}",
                response.headers()
            );
        }
    }
    for (path, value) in [
        ("private.css", "private, max-age=5"),
        ("no-store.css", "no-store"),
        ("no-cache.css", "no-cache"),
        ("public-policy.css", "public, max-age=17"),
    ] {
        let response = client
            .get(url(&format!("/assets/{path}")))
            .header("Host", "assets.example")
            .send()
            .await
            .unwrap();
        assert_eq!(response.headers()["cache-control"], value);
    }
    for (name, value) in [
        ("Cookie", "synthetic=1"),
        ("Remote-User", "synthetic"),
        ("Remote-Email", "synthetic"),
        ("Remote-Name", "synthetic"),
        ("Remote-Groups", "synthetic"),
        ("X-Auth-Request-User", "synthetic"),
        ("X-Auth-Request-Email", "synthetic"),
        ("X-Auth-Request-Groups", "synthetic"),
        ("X-Auth-Request-Preferred-Username", "synthetic"),
        ("X-Forwarded-User", "synthetic"),
        ("X-Forwarded-Email", "synthetic"),
        ("X-User", "synthetic"),
        ("X-Email", "synthetic"),
        ("X-Authentik-Username", "synthetic"),
        ("X-Authentik-Email", "synthetic"),
        ("X-Authentik-Name", "synthetic"),
        ("X-Authentik-Groups", "synthetic"),
        ("X-Authentik-Uid", "synthetic"),
        ("Authorization", "Bearer synthetic"),
        ("Proxy-Authorization", "Basic synthetic"),
        ("Range", "bytes=0-2"),
        ("If-Range", "synthetic"),
        ("If-Match", "synthetic"),
        ("If-None-Match", "synthetic"),
        ("If-Modified-Since", "Wed, 21 Oct 2015 07:28:00 GMT"),
        ("If-Unmodified-Since", "Wed, 21 Oct 2015 07:28:00 GMT"),
        ("Cache-Control", "no-cache"),
        ("Pragma", "no-cache"),
    ] {
        let response = client
            .get(url("/assets/public.css"))
            .header("Host", "assets.example")
            .header(name, value)
            .send()
            .await
            .unwrap();
        assert!(!response.headers().contains_key("cache-control"), "{name}");
    }
    for domain in ["protected.example", "disabled.example", "omitted.example"] {
        let response = client
            .get(url("/assets/public.css"))
            .header("Host", domain)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert!(
            !response.headers().contains_key("cache-control"),
            "{domain}"
        );
    }
    let post = client
        .post(url("/assets/public.css"))
        .header("Host", "assets.example")
        .send()
        .await
        .unwrap();
    assert!(!post.headers().contains_key("cache-control"));
    upstream_task.abort();
}
