use super::{MAX_OUTPUT_BYTES, parse, read};
use crate::runtime::{CaddyProcess, EngineEnvironment, ProxyEngine};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

#[test]
fn caddy_version_parser_returns_only_the_semantic_version() {
    for (output, expected) in [
        ("v2.10.0 h1:private-build-hash\n", "2.10.0"),
        ("2.11.0-rc.1 custom build info", "2.11.0-rc.1"),
        ("v2.11.0-beta.2+private.build", "2.11.0-beta.2"),
        ("v0.0.0", "0.0.0"),
    ] {
        assert_eq!(parse(output.as_bytes()).as_deref(), Some(expected));
    }
}

#[test]
fn caddy_version_parser_rejects_nonversion_and_malformed_output() {
    for output in [
        "",
        "(devel)",
        "unknown",
        "Caddy v2.10.0",
        "v2.10",
        "v2.10.0.1",
        "v02.10.0",
        "v2.01.0",
        "v2.10.00",
        "v2.10.0-01",
        "v2.10.0-",
        "v2.10.0-rc..1",
        "v2.10.0+",
        "v2.10.0+a..b",
        "v2.10.0-α",
        "v2.10.0\0credential",
        "vv2.10.0",
        "https://private.test",
        "v2.10.0/private",
    ] {
        assert_eq!(parse(output.as_bytes()), None, "{output:?}");
    }
    assert_eq!(parse(&[0xff]), None);
    assert_eq!(parse(format!("2.10.0-{}", "a".repeat(65)).as_bytes()), None);
    assert_eq!(
        parse(format!("2.10.0 {}", "x".repeat(MAX_OUTPUT_BYTES)).as_bytes()),
        None
    );
}

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    root: PathBuf,
    binary: PathBuf,
}

impl Fixture {
    fn compile(body: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "rp-version-{}-{}",
            std::process::id(),
            FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("fixture.rs");
        let binary = root.join(format!("fixture{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&source, format!("fn main() {{ {body} }}")).unwrap();
        let mut command = std::process::Command::new("rustc");
        command
            .arg("--edition=2024")
            .arg(&source)
            .arg("-o")
            .arg(&binary);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        assert!(
            command.status().unwrap().success(),
            "compile isolated version fixture"
        );
        Self { root, binary }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.root.parent(), Some(std::env::temp_dir().as_path()));
        assert!(
            self.root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("rp-version-")
        );
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn caddy_version_command_has_fixed_arguments_and_a_clean_environment() {
    let fixture = Fixture::compile(
        r#"
        assert_eq!(std::env::args().skip(1).collect::<Vec<_>>(), ["version"]);
        assert!(std::env::vars_os().all(|(name, _)| name == "SystemRoot"));
        println!("v2.10.0 h1:private-build-hash");
    "#,
    );
    let engine = CaddyProcess::new(fixture.binary.clone(), fixture.root.clone());
    engine.set_environment(EngineEnvironment::with_crowdsec_bouncer_key(
        "fixture-secret".into(),
    ));
    assert_eq!(engine.version().await.as_deref(), Some("2.10.0"));
    assert!(!engine.is_running().await);
}

#[tokio::test]
async fn caddy_version_missing_binary_returns_none() {
    assert_eq!(
        read(&std::env::temp_dir().join("rp-version-absent-binary")).await,
        None
    );
}

#[tokio::test]
async fn caddy_version_command_timeout_returns_none_and_is_bounded() {
    let fixture = Fixture::compile("std::thread::sleep(std::time::Duration::from_secs(60));");
    let started = tokio::time::Instant::now();
    assert_eq!(read(&fixture.binary).await, None);
    assert!(started.elapsed() < std::time::Duration::from_secs(3));
}

#[tokio::test]
async fn caddy_version_output_limit_returns_none_without_waiting_for_exit() {
    let fixture = Fixture::compile(
        r#"
        use std::io::Write;
        print!("v2.10.0 {}", "x".repeat(2048));
        std::io::stdout().flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(60));
    "#,
    );
    assert_eq!(read(&fixture.binary).await, None);
}

#[tokio::test]
async fn caddy_version_unsuccessful_exit_does_not_return_stdout() {
    let fixture = Fixture::compile(r#"println!("v2.10.0 private-info"); std::process::exit(7);"#);
    assert_eq!(read(&fixture.binary).await, None);
}
