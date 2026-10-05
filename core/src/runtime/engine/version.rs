use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, time::timeout};

const MAX_OUTPUT_BYTES: usize = 1_024;
const MAX_VERSION_BYTES: usize = 64;
const VERSION_TIMEOUT: Duration = Duration::from_secs(1);

// This is metadata from the configured binary, independent of the running child.
pub(super) async fn read(binary: &Path) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("version")
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
    }
    let mut child = command.spawn().ok()?;
    let operation = async {
        let stdout = child.stdout.take()?;
        let mut output = Vec::with_capacity(MAX_OUTPUT_BYTES + 1);
        stdout
            .take((MAX_OUTPUT_BYTES + 1) as u64)
            .read_to_end(&mut output)
            .await
            .ok()?;
        if output.len() > MAX_OUTPUT_BYTES {
            return None;
        }
        if !child.wait().await.ok()?.success() {
            return None;
        }
        parse(&output)
    };
    timeout(VERSION_TIMEOUT, operation).await.ok().flatten()
}

fn parse(output: &[u8]) -> Option<String> {
    if output.len() > MAX_OUTPUT_BYTES {
        return None;
    }
    let output = std::str::from_utf8(output).ok()?;
    let token = output.split_ascii_whitespace().next()?;
    let version = token.strip_prefix('v').unwrap_or(token);
    if version.is_empty() || version.len() > MAX_VERSION_BYTES {
        return None;
    }
    // Discard valid SemVer build metadata as well as Caddy's trailing build info.
    let (version, build) = version
        .split_once('+')
        .map_or((version, None), |(v, b)| (v, Some(b)));
    if build.is_some_and(|build| !identifiers(build, false)) {
        return None;
    }
    let (release, prerelease) = version
        .split_once('-')
        .map_or((version, None), |(v, p)| (v, Some(p)));
    let mut parts = release.split('.');
    for _ in 0..3 {
        if !numeric(parts.next()?) {
            return None;
        }
    }
    if parts.next().is_some() || prerelease.is_some_and(|p| !identifiers(p, true)) {
        return None;
    }
    Some(version.to_owned())
}

fn numeric(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value.len() == 1 || !value.starts_with('0'))
}

fn identifiers(value: &str, prerelease: bool) -> bool {
    value.split('.').all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!prerelease
                || !identifier.bytes().all(|byte| byte.is_ascii_digit())
                || numeric(identifier))
    })
}

#[cfg(test)]
#[path = "../../../tests/private/caddy_version.rs"]
mod tests;
