mod connector;
mod validation;

use super::*;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const ACTOR: &str = "0198d98a-0000-7000-8000-000000000001";
static COUNTER: AtomicU64 = AtomicU64::new(0);
fn directory() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "rentnerproxy-discovery-test-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir(&path).unwrap();
    path
}
fn container(id: char) -> Value {
    json!({
        "Id": id.to_string().repeat(64),
        "Name": format!("/app-{id}"),
        "Config": { "Labels": {"rentnerproxy.enable":"true", "rentnerproxy.domains":"app.example.com", "private.example/token":"SYNTHETIC_PRIVATE_LABEL"}, "ExposedPorts":{"8080/tcp":{}}, "Env":["SYNTHETIC_SECRET=not-for-output"] },
        "State":{"Running":true}, "HostConfig":{"NetworkMode":"proxy"},
        "NetworkSettings":{"Networks":{"proxy":{"IPAddress":"172.22.0.5", "GlobalIPv6Address":""}}}
    })
}
fn candidate(value: Value) -> models::Candidate {
    labels::candidate(serde_json::from_value(value).unwrap()).unwrap()
}
fn save(endpoint: Option<String>, enabled: bool, revision: u32) -> models::Save {
    models::Save {
        expected_revision: revision,
        actor_user_id: ACTOR.into(),
        configuration: models::Configuration { endpoint, enabled },
        acknowledge_restore: false,
    }
}
