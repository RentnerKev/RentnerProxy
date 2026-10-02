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
                if bytes.len() > 65_536 {
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
) -> (CaddyChild, SocketAddr, SocketAddr) {
    let listeners: Vec<_> = (0..3)
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
            controller_port: addresses[0].port(),
            trusted_proxy_cidrs: Vec::new(),
        },
    )
    .unwrap();
    let mut json: Value = serde_json::from_str(&rendered).unwrap();
    json["apps"]["http"]["servers"]["rentnerproxy-http"]["listen"] =
        json!([addresses[0].to_string()]);
    json["apps"]["http"]["servers"]["rentnerproxy-probe"]["listen"] =
        json!([addresses[1].to_string()]);
    json["admin"]["listen"] = json!(addresses[2].to_string());
    let config_path = state.join("caddy.json");
    std::fs::write(&config_path, serde_json::to_vec(&json).unwrap()).unwrap();
    let log_path = state.join("caddy-stderr.log");
    let mut command = Command::new(binary);
    command
        .args(["run", "--config"])
        .arg(&config_path)
        .current_dir(&state)
        .env_clear()
        .env("SYNTHETIC_SENTINEL", "SYNTHETIC_VALUE_MUST_NEVER_EXPAND")
        .env("HOME", &state)
        .env("USERPROFILE", &state)
        .env("TEMP", &state)
        .env("TMP", &state)
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
        let (_child, public, probe) = start_caddy(&binary, &workspace.0, index, mode.clone());
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
                        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
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
