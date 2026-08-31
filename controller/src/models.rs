use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProxyConfigRequest {
    pub(crate) version: u8,
    pub(crate) revision: String,
    pub(crate) proxy_hosts: Vec<ProxyHost>,
    #[serde(default, skip_serializing_if = "ProxyHttpSettings::is_empty")]
    pub(crate) http_settings: ProxyHttpSettings,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProxyHttpSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) client_max_body_size_bytes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) proxy_connect_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) proxy_read_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) proxy_send_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) send_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) keepalive_timeout_seconds: Option<u32>,
}

impl ProxyHttpSettings {
    pub(crate) fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProxyHost {
    pub(crate) id: String,
    pub(crate) domains: Vec<String>,
    pub(crate) forward_scheme: String,
    pub(crate) forward_host: String,
    pub(crate) forward_port: u16,
    #[serde(default, skip_serializing_if = "ProxyHttpSettings::is_empty")]
    pub(crate) http_settings: ProxyHttpSettings,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) advanced_config: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedProxyConfig {
    pub(crate) revision: String,
    pub(crate) proxy_hosts: Vec<ProxyHost>,
    pub(crate) http_settings: ProxyHttpSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProxyRuntimeStatus {
    pub(crate) available: bool,
    pub(crate) running: bool,
    pub(crate) active_revision: Option<String>,
    pub(crate) last_apply_at: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ApplyOutcome {
    Applied,
    Unchanged,
}
