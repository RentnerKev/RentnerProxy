use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Configuration {
    pub(crate) enabled: bool,
    pub(crate) endpoint: Option<String>,
}

// Endpoint addresses are management data. Neither Debug nor public runtime responses expose them.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Document {
    pub(crate) version: u8,
    pub(crate) revision: u32,
    pub(crate) settings: Configuration,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            settings: Configuration::default(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Save {
    pub(crate) expected_revision: u32,
    pub(crate) actor_user_id: String,
    pub(crate) configuration: Configuration,
    pub(crate) acknowledge_restore: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Error {
    InvalidInput,
    Conflict,
    StoreUnavailable,
    EndpointUnavailable,
    InvalidResponse,
    InventoryTooLarge,
    Stopping,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    #[default]
    Disabled,
    Paused,
    Connecting,
    Ready,
    Unavailable,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub(crate) configuration: Document,
    pub(crate) status: Status,
    pub(crate) stale: bool,
    pub(crate) error: Option<Error>,
    pub(crate) candidates: Vec<Candidate>,
}
impl Snapshot {
    pub(super) fn for_configuration(configuration: Document, restored: bool) -> Self {
        let status = if restored {
            Status::Paused
        } else if configuration.settings.enabled {
            Status::Connecting
        } else {
            Status::Disabled
        };
        Self {
            configuration,
            status,
            stale: true,
            error: None,
            candidates: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    pub(crate) container_id: String,
    pub(crate) domains: Vec<String>,
    pub(crate) target: Option<Target>,
    pub(crate) certificate_id: Option<String>,
    pub(crate) access_policy_id: Option<String>,
    pub(crate) issues: Vec<Issue>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub(crate) scheme: String,
    pub(crate) address: String,
    pub(crate) port: u16,
    pub(crate) network: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Issue {
    InvalidDomains,
    UnsupportedLabel,
    MissingPort,
    AmbiguousPort,
    InvalidPort,
    InvalidProtocol,
    MissingNetwork,
    AmbiguousNetwork,
    InvalidNetwork,
    UnsupportedNetworkMode,
    MissingAddress,
    InvalidCertificateReference,
    InvalidAccessPolicyReference,
    ContainerNotRunning,
    DomainConflict,
    UnsupportedOrchestrator,
}

// Docker uses an open schema. Deserialize only required fields: Env, mounts, images and other labels
// are never copied to management output, logs, persistence or candidate diagnostics.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Summary {
    pub(super) id: String,
    #[serde(default, deserialize_with = "nullable_map")]
    pub(super) labels: BTreeMap<String, String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Container {
    pub(super) id: String,
    pub(super) config: ContainerConfig,
    pub(super) state: ContainerState,
    pub(super) host_config: HostConfig,
    pub(super) network_settings: NetworkSettings,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct ContainerConfig {
    #[serde(default, deserialize_with = "nullable_map")]
    pub(super) labels: BTreeMap<String, String>,
    #[serde(default)]
    pub(super) exposed_ports: Option<BTreeMap<String, serde_json::Value>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct ContainerState {
    pub(super) running: bool,
    #[serde(default)]
    pub(super) paused: bool,
    #[serde(default)]
    pub(super) restarting: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct HostConfig {
    pub(super) network_mode: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct NetworkSettings {
    #[serde(default, deserialize_with = "nullable_map")]
    pub(super) networks: BTreeMap<String, Network>,
}
#[derive(Deserialize)]
pub(super) struct Network {
    #[serde(rename = "IPAddress", default)]
    pub(super) ipv4: String,
    #[serde(rename = "GlobalIPv6Address", default)]
    pub(super) ipv6: String,
}

fn nullable_map<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<BTreeMap<String, T>, D::Error> {
    Option::<BTreeMap<String, T>>::deserialize(deserializer).map(Option::unwrap_or_default)
}
