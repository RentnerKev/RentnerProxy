use crate::runtime::engine::{
    CaddyProcess, EngineEnvironment, EngineError, MAX_METRICS_RESPONSE_BYTES, ProxyEngine,
};
use std::{
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixListener,
    process::Command,
    time::timeout,
};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    engine: CaddyProcess,
    root: PathBuf,
}

impl Fixture {
    fn new(script: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "rp-engine-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let binary = root.join("caddy-fixture");
        std::fs::write(&binary, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self {
            engine: CaddyProcess::new(binary, root.clone()),
            root,
        }
    }

    async fn tracked_child(&self) {
        let child = Command::new("/bin/sleep")
            .arg("60")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        *self.engine.child.lock().await = Some(child);
    }

    fn listener(&self, name: &str) -> UnixListener {
        let path = self.root.join(name);
        if path.exists() {
            std::fs::remove_file(&path).unwrap();
        }
        UnixListener::bind(path).unwrap()
    }

    async fn reap(&self) {
        self.engine
            .terminate_child_bounded(Duration::from_secs(1))
            .await
            .unwrap();
        assert!(!self.engine.is_running().await);
        assert!(self.engine.child.lock().await.is_none());
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn respond(
    listener: &UnixListener,
    request_line: &str,
    request_body: &str,
    status: u16,
    response_body: &[u8],
) {
    timeout(Duration::from_secs(5), async {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            headers.push(stream.read_u8().await.unwrap());
            assert!(headers.len() < 4_096);
        }
        let headers = String::from_utf8(headers).unwrap();
        assert!(headers.starts_with(request_line));
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(|length| length.parse::<usize>().unwrap())
            })
            .unwrap_or(0);
        assert_eq!(length, request_body.len());
        let mut body = vec![0; length];
        stream.read_exact(&mut body).await.unwrap();
        assert_eq!(body, request_body.as_bytes());
        let response = format!(
            "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            response_body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        // An over-limit client is allowed to close before the fixture finishes.
        let _ = stream.write_all(response_body).await;
        let _ = stream.shutdown().await;
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn owned_start_passes_configuration_and_private_environment_and_reuses_verified_child() {
    let fixture = Fixture::new(
        "/bin/cat > captured.json\nprintf '%s\\n%s\\n%s' \"$XDG_CONFIG_HOME\" \"$XDG_DATA_HOME\" \"$RENTNERPROXY_CROWDSEC_BOUNCER_KEY\" > captured.env\n: > started\nexec /bin/sleep 60",
    );
    fixture
        .engine
        .set_environment(EngineEnvironment::with_crowdsec_bouncer_key(
            "fixture-bouncer-key".to_owned(),
        ));
    let listener = fixture.listener("runtime-probe.sock");
    let probe = async {
        timeout(Duration::from_secs(2), async {
            while !fixture.root.join("started").exists() {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        })
        .await
        .unwrap();
        respond(
            &listener,
            "GET /__rentnerproxy_runtime_probe HTTP/1.1\r\n",
            "",
            200,
            b"revision-one\n",
        )
        .await;
    };
    let (result, ()) = tokio::join!(
        fixture.engine.start("{\"test\":true}", "revision-one"),
        probe
    );
    assert_eq!(result, Ok(()));
    assert!(fixture.engine.is_running().await);
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("captured.json")).unwrap(),
        "{\"test\":true}"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("captured.env")).unwrap(),
        format!(
            "{}\n{}\nfixture-bouncer-key",
            fixture.root.join("caddy/config").display(),
            fixture.root.join("caddy/data").display()
        )
    );
    let original_pid = fixture.engine.child.lock().await.as_ref().unwrap().id();
    let (result, ()) = tokio::join!(
        fixture
            .engine
            .start("must not replace active input", "revision-one"),
        respond(
            &listener,
            "GET /__rentnerproxy_runtime_probe HTTP/1.1\r\n",
            "",
            200,
            b"revision-one\n",
        )
    );
    assert_eq!(result, Ok(()));
    assert_eq!(
        fixture.engine.child.lock().await.as_ref().unwrap().id(),
        original_pid
    );
    assert_eq!(
        std::fs::read_to_string(fixture.root.join("captured.json")).unwrap(),
        "{\"test\":true}"
    );
    fixture.reap().await;
}

#[tokio::test]
async fn runtime_probe_requires_both_success_status_and_the_exact_revision() {
    let fixture = Fixture::new("exit 1");
    fixture.tracked_child().await;
    let listener = fixture.listener("runtime-probe.sock");
    let replies = async {
        for (status, body) in [
            (200, b"old-revision\n".as_slice()),
            (503, b"revision-one\n".as_slice()),
            (200, b"revision-one\n".as_slice()),
        ] {
            respond(
                &listener,
                "GET /__rentnerproxy_runtime_probe HTTP/1.1\r\n",
                "",
                status,
                body,
            )
            .await;
        }
    };
    let (result, ()) = tokio::join!(fixture.engine.probe("revision-one"), replies);
    assert_eq!(result, Ok(()));
    fixture.reap().await;
}

#[tokio::test]
async fn unverified_owned_start_times_out_and_reaps_the_child() {
    let fixture = Fixture::new("/bin/cat > captured.json\nexec /bin/sleep 60");
    assert_eq!(
        timeout(
            Duration::from_secs(5),
            fixture.engine.start("{}", "never-confirmed")
        )
        .await
        .unwrap(),
        Err(EngineError::TimedOut)
    );
    assert!(fixture.engine.child.lock().await.is_none());
    assert!(!fixture.engine.is_running().await);
}

#[tokio::test]
async fn owned_start_rejects_missing_nonexecutable_and_prematurely_exited_children() {
    let fixture = Fixture::new("exit 0");
    let missing = CaddyProcess::new(fixture.root.join("missing"), fixture.root.clone());
    assert_eq!(
        missing.start("{}", "r").await,
        Err(EngineError::Unavailable)
    );
    std::fs::set_permissions(
        &fixture.engine.binary,
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    assert_eq!(
        fixture.engine.start("{}", "r").await,
        Err(EngineError::CommandFailed)
    );
    std::fs::set_permissions(
        &fixture.engine.binary,
        std::fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    assert_eq!(
        fixture.engine.start("", "r").await,
        Err(EngineError::Unavailable)
    );
    assert!(fixture.engine.child.lock().await.is_none());
}

#[tokio::test]
async fn admin_load_distinguishes_acceptance_rejection_and_invalid_responses() {
    let fixture = Fixture::new("exit 1");
    assert_eq!(
        fixture.engine.load("{}").await,
        Err(EngineError::Unavailable)
    );
    fixture.tracked_child().await;
    for (status, body, expected) in [
        (200, "", Ok(())),
        (200, "unexpected", Err(EngineError::InvalidResponse)),
        (400, "rejected", Err(EngineError::Rejected)),
        (499, "rejected", Err(EngineError::Rejected)),
        (500, "failed", Err(EngineError::InvalidResponse)),
    ] {
        let listener = fixture.listener("caddy-admin.sock");
        let (result, ()) = tokio::join!(
            fixture.engine.load("{\"revision\":1}"),
            respond(
                &listener,
                "POST /load HTTP/1.1\r\n",
                "{\"revision\":1}",
                status,
                body.as_bytes(),
            )
        );
        assert_eq!(result, expected);
    }
    fixture.reap().await;
}

#[tokio::test]
async fn metrics_require_a_running_child_and_a_successful_bounded_response() {
    let fixture = Fixture::new("exit 1");
    assert_eq!(
        fixture.engine.metrics().await,
        Err(EngineError::Unavailable)
    );
    fixture.tracked_child().await;
    for (status, length, expected) in [
        (200, 8_192, None),
        (503, 0, Some(EngineError::InvalidResponse)),
        (
            200,
            MAX_METRICS_RESPONSE_BYTES + 1,
            Some(EngineError::InvalidResponse),
        ),
    ] {
        let listener = fixture.listener("caddy-admin.sock");
        let body = vec![b'm'; length];
        let (result, ()) = tokio::join!(
            fixture.engine.metrics(),
            respond(&listener, "GET /metrics HTTP/1.1\r\n", "", status, &body)
        );
        match expected {
            Some(error) => assert_eq!(result, Err(error)),
            None => assert_eq!(result.unwrap().as_ref(), body),
        }
    }
    fixture.reap().await;
}
