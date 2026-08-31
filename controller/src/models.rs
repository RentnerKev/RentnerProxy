use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProxyConfigRequest {
    pub(crate) version: u8,
    pub(crate) revision: String,
    pub(crate) proxy_hosts: Vec<ProxyHost>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ProxyHost {
    pub(crate) id: String,
    pub(crate) domains: Vec<String>,
    pub(crate) forward_scheme: String,
    pub(crate) forward_host: String,
    pub(crate) forward_port: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ValidatedProxyConfig {
    pub(crate) revision: String,
    pub(crate) proxy_hosts: Vec<ProxyHost>,
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
