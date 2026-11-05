use super::*;
use std::{
    fs::{self, Permissions},
    os::unix::fs::{PermissionsExt, symlink},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::process::Command;

static NEXT: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: PathBuf,
    engine: CaddyProcess,
    uid: u32,
    pid: Option<u32>,
}

impl Fixture {
    async fn new(child: bool) -> Self {
        let root = std::env::temp_dir().join(format!(
            "rp-caddy-maintenance-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, Permissions::from_mode(0o700)).unwrap();
        let engine = CaddyProcess::new(PathBuf::from("/bin/sleep"), root.clone());
        let pid = if child {
            let process = Command::new("/bin/sleep")
                .arg("30")
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let pid = process.id();
            *engine.child.lock().await = Some(process);
            pid
        } else {
            None
        };
        // SAFETY: geteuid has no arguments or memory-safety preconditions.
        let uid = unsafe { libc::geteuid() };
        Self {
            root,
            engine,
            uid,
            pid,
        }
    }

    fn request(&self) -> serde_json::Value {
        serde_json::json!({
            "id": "01900000-0000-7000-8000-000000000001",
            "controllerPid": std::process::id(),
            "controllerStartTicks": process_start_ticks(std::process::id()).unwrap(),
            "expiresAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 + 50_000,
        })
    }

    fn install(&self, value: &serde_json::Value) {
        let path = self.root.join("controller-maintenance-request.json");
        fs::write(&path, serde_json::to_vec(value).unwrap()).unwrap();
        fs::set_permissions(path, Permissions::from_mode(0o440)).unwrap();
        let receipt = self.root.join("controller-maintenance-receipt.json");
        fs::write(&receipt, []).unwrap();
        fs::set_permissions(receipt, Permissions::from_mode(0o600)).unwrap();
    }

    async fn retain(&self) -> Result<bool, EngineError> {
        self.engine
            .retain_owned_for_backup_at(
                Instant::now() + Duration::from_secs(1),
                &self.root,
                self.uid,
            )
            .await
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(mut child) = self.engine.child.get_mut().take() {
            let _ = child.start_kill();
        } else if let Some(pid) = self.pid {
            // SAFETY: this fixture created and exclusively owns this child. A
            // successful handoff deliberately forgot its Tokio handle; reap it
            // here so the test cannot leave a retained process behind.
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
                libc::waitpid(pid as i32, std::ptr::null_mut(), 0);
            }
        }
        assert!(self.root.starts_with(std::env::temp_dir()));
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn root_handoff_keeps_the_owned_child_alive_and_records_its_exact_identity() {
    let fixture = Fixture::new(true).await;
    fixture.install(&fixture.request());
    assert_eq!(fixture.retain().await, Ok(true));
    assert!(fixture.engine.child.lock().await.is_none());
    let receipt: serde_json::Value = serde_json::from_slice(
        &fs::read(fixture.root.join("controller-maintenance-receipt.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(receipt["controllerPid"], std::process::id());
    assert_eq!(receipt["caddyPid"], fixture.pid.unwrap());
    assert_eq!(
        receipt["caddyStartTicks"],
        process_start_ticks(fixture.pid.unwrap()).unwrap()
    );
    assert_eq!(receipt["id"], fixture.request()["id"]);
}

#[tokio::test]
async fn missing_requests_leave_normal_shutdown_ownership_unchanged() {
    let fixture = Fixture::new(true).await;
    assert_eq!(fixture.retain().await, Ok(false));
    assert!(fixture.engine.child.lock().await.is_some());
    let absent = fixture.root.join("absent");
    assert!(read_request(&absent, fixture.uid).unwrap().is_none());
}

#[tokio::test]
async fn an_empty_engine_produces_an_explicit_empty_handoff() {
    let fixture = Fixture::new(false).await;
    fixture.install(&fixture.request());
    assert_eq!(fixture.retain().await, Ok(true));
    let receipt: serde_json::Value = serde_json::from_slice(
        &fs::read(fixture.root.join("controller-maintenance-receipt.json")).unwrap(),
    )
    .unwrap();
    assert!(receipt["caddyPid"].is_null());
    assert!(receipt["caddyStartTicks"].is_null());
}

#[tokio::test]
async fn stale_foreign_or_malformed_requests_never_release_the_child() {
    for (field, value) in [
        ("id", serde_json::json!("invalid")),
        ("controllerPid", serde_json::json!(1)),
        ("controllerStartTicks", serde_json::json!("0")),
        ("expiresAt", serde_json::json!(1)),
        ("expiresAt", serde_json::json!(u64::MAX)),
    ] {
        let fixture = Fixture::new(true).await;
        let mut request = fixture.request();
        request[field] = value;
        fixture.install(&request);
        assert!(fixture.retain().await.is_err(), "accepted {field}");
        assert!(fixture.engine.child.lock().await.is_some());
    }
}

#[tokio::test]
async fn unsafe_authority_links_modes_and_reused_receipts_are_rejected() {
    for mode in [
        "request-link",
        "receipt-link",
        "request-mode",
        "receipt-mode",
        "receipt-replay",
        "directory-mode",
        "owner",
        "oversized",
        "invalid-json",
        "hard-link",
    ] {
        let fixture = Fixture::new(true).await;
        fixture.install(&fixture.request());
        let request = fixture.root.join("controller-maintenance-request.json");
        let receipt = fixture.root.join("controller-maintenance-receipt.json");
        match mode {
            "request-link" | "receipt-link" => {
                let original = if mode == "request-link" {
                    &request
                } else {
                    &receipt
                };
                let target = fixture.root.join("linked");
                fs::rename(original, &target).unwrap();
                symlink(target, original).unwrap();
            }
            "request-mode" => fs::set_permissions(&request, Permissions::from_mode(0o666)).unwrap(),
            "receipt-mode" => fs::set_permissions(&receipt, Permissions::from_mode(0o666)).unwrap(),
            "receipt-replay" => fs::write(&receipt, "previous response").unwrap(),
            "directory-mode" => {
                fs::set_permissions(&fixture.root, Permissions::from_mode(0o777)).unwrap()
            }
            "owner" => {
                assert!(read_request(&fixture.root, fixture.uid.wrapping_add(1)).is_err());
                continue;
            }
            "oversized" | "invalid-json" => {
                fs::set_permissions(&request, Permissions::from_mode(0o600)).unwrap();
                fs::write(
                    &request,
                    if mode == "oversized" {
                        vec![b' '; 1025]
                    } else {
                        b"invalid".to_vec()
                    },
                )
                .unwrap();
                fs::set_permissions(&request, Permissions::from_mode(0o440)).unwrap();
            }
            "hard-link" => fs::hard_link(&request, fixture.root.join("other-link")).unwrap(),
            _ => unreachable!(),
        }
        assert!(fixture.retain().await.is_err(), "accepted {mode}");
        assert!(fixture.engine.child.lock().await.is_some());
    }
}
