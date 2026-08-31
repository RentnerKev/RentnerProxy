use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::models::ProxyHost;

pub(crate) fn revision_for_hosts(hosts: &[ProxyHost]) -> String {
    let snapshot = CanonicalSnapshot {
        version: 1,
        proxy_hosts: canonical_hosts(hosts),
    };
    let bytes = serde_json::to_vec(&snapshot)
        .expect("canonical proxy snapshot only contains serializable strings and numbers");
    let hash = Sha256::digest(bytes);
    format!("sha256:{hash:x}")
}

pub(crate) fn revision_from_config(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        line.strip_prefix("# rentnerproxy-revision: ")
            .filter(|revision| is_revision(revision))
            .map(ToOwned::to_owned)
    })
}

pub(super) fn canonical_hosts(hosts: &[ProxyHost]) -> Vec<ProxyHost> {
    let mut hosts = hosts.to_vec();
    for host in &mut hosts {
        host.domains.sort_unstable();
    }
    hosts.sort_unstable_by(|left, right| left.id.cmp(&right.id));
    hosts
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalSnapshot {
    version: u8,
    proxy_hosts: Vec<ProxyHost>,
}

pub(super) fn is_revision(value: &str) -> bool {
    let Some(hash) = value.strip_prefix("sha256:") else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}
