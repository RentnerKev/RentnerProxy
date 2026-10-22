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
        std::fs::create_dir(&root).unwrap();
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
    let mut buffer = [0u8; 4096];
    loop {
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
    json: Value,
    listeners: Vec<TcpListener>,
) -> (CaddyChild, SocketAddr, SocketAddr) {
    let addresses: Vec<_> = listeners
        .iter()
        .map(|listener| listener.local_addr().unwrap())
        .collect();
    let config_path = state.join("caddy.json");
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
        if exchange(addresses[1], None, "/__rentnerproxy_runtime_probe")
            .ok()
            .is_some_and(|bytes| !bytes.is_empty() && response(&bytes).status == 200)
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
