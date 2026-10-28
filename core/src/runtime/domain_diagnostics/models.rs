use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HostType {
    Proxy,
    Redirect,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Request {
    pub(crate) host_type: HostType,
    pub(crate) host_id: String,
    pub(crate) domain: String,
    pub(crate) expected_revision: String,
    #[serde(default)]
    pub(crate) upstream_only: bool,
    pub(crate) timeout_ms: Option<u32>,
}
impl Request {
    pub(super) fn validate(&self) -> std::result::Result<(), super::Error> {
        let name = self.domain.strip_prefix("*.").unwrap_or(&self.domain);
        if self
            .timeout_ms
            .is_some_and(|timeout| !(1000..=10000).contains(&timeout))
            || (self.upstream_only
                && (self.host_type != HostType::Proxy || self.domain.starts_with("*.")))
            || !crate::proxy::is_canonical_uuid(&self.host_id)
            || self.domain.len() > 253
            || !crate::proxy::is_canonical_domain(name)
            || !self
                .expected_revision
                .strip_prefix("sha256:")
                .is_some_and(|hash| {
                    hash.len() == 64
                        && hash
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
                })
        {
            return Err(super::Error::InvalidInput);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    Passed,
    Failed,
    Unknown,
    NotApplicable,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Code {
    ConfigurationActive,
    ConfigurationStale,
    ConfigurationChanged,
    HostNotActive,
    RuntimeUnavailable,
    Skipped,
    DnsResolved,
    DnsNotFound,
    DnsFailed,
    DnsTimeout,
    WildcardDomain,
    UpstreamResponded,
    UpstreamUnreachable,
    UpstreamTimeout,
    UpstreamDnsFailed,
    AccessDenied,
    UpstreamError,
    RedirectNotFollowed,
    UnexpectedStatus,
    TlsVerified,
    TlsVerificationDisabled,
    TlsFailed,
    TlsUnconfirmed,
    HttpUpstream,
    RedirectHost,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stage {
    pub(crate) status: Status,
    pub(crate) code: Code,
    pub(crate) duration_ms: u32,
    pub(crate) addresses: Vec<String>,
    pub(crate) http_status: Option<u16>,
}
impl Stage {
    pub(super) fn new(status: Status, code: Code) -> Self {
        Self {
            status,
            code,
            duration_ms: 0,
            addresses: Vec::new(),
            http_status: None,
        }
    }
    pub(super) fn skipped() -> Self {
        Self::new(Status::Unknown, Code::Skipped)
    }
    pub(super) fn elapsed(mut self, start: tokio::time::Instant) -> Self {
        self.duration_ms = start.elapsed().as_millis().min(12_000) as u32;
        self
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stages {
    pub(crate) configuration: Stage,
    pub(crate) dns: Stage,
    pub(crate) upstream: Stage,
    pub(crate) tls: Stage,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Result {
    pub(crate) host_type: HostType,
    pub(crate) host_id: String,
    pub(crate) domain: String,
    pub(crate) expected_revision: String,
    pub(crate) active_revision: Option<String>,
    pub(crate) checked_at: String,
    pub(crate) observation_point: &'static str,
    pub(crate) public_reachability: &'static str,
    pub(crate) stages: Stages,
}
