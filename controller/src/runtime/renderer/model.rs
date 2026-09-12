use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub(super) struct CaddyConfig {
    pub(super) admin: Admin,
    pub(super) storage: Storage,
    pub(super) logging: Value,
    pub(super) apps: Apps,
}

#[derive(Serialize)]
pub(super) struct Admin {
    pub(super) listen: String,
    pub(super) config: AdminConfig,
}

#[derive(Serialize)]
pub(super) struct AdminConfig {
    pub(super) persist: bool,
}

#[derive(Serialize)]
pub(super) struct Storage {
    pub(super) module: String,
    pub(super) root: String,
}

#[derive(Serialize)]
pub(super) struct Apps {
    pub(super) http: HttpApp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tls: Option<TlsApp>,
}

#[derive(Serialize)]
pub(super) struct HttpApp {
    pub(super) servers: BTreeMap<String, HttpServer>,
}

#[derive(Serialize)]
pub(super) struct HttpServer {
    pub(super) listen: Vec<String>,
    pub(super) routes: Vec<Route>,
    pub(super) automatic_https: AutoHttps,
    pub(super) protocols: Vec<String>,
    pub(super) read_header_timeout: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) write_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) idle_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) strict_sni_host: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) trusted_proxies: Option<TrustedProxies>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) trusted_proxies_strict: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tls_connection_policies: Option<Vec<TlsConnectionPolicy>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) logs: Option<ServerLogs>,
}

#[derive(Serialize)]
pub(super) struct TrustedProxies {
    pub(super) source: String,
    pub(super) ranges: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct ServerLogs {}

#[derive(Serialize)]
pub(super) struct AutoHttps {
    pub(super) disable: bool,
}

#[derive(Serialize)]
pub(super) struct Route {
    #[serde(rename = "match", skip_serializing_if = "Vec::is_empty")]
    pub(super) matchers: Vec<MatcherSet>,
    pub(super) handle: Vec<Handler>,
    pub(super) terminal: bool,
}

#[derive(Default, Serialize)]
pub(super) struct MatcherSet {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) host: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) remote_ip: Option<RemoteIpMatcher>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) vars: Option<BTreeMap<String, Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) not: Option<Vec<MatcherSet>>,
}

#[derive(Serialize)]
pub(super) struct RemoteIpMatcher {
    pub(super) ranges: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct Subroute {
    pub(super) routes: Vec<Route>,
}

impl MatcherSet {
    pub(super) fn host(domains: &[String]) -> Self {
        Self {
            host: Some(domains.to_vec()),
            ..Self::default()
        }
    }

    pub(super) fn path(paths: Vec<String>) -> Self {
        Self {
            path: Some(paths),
            ..Self::default()
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "handler")]
pub(super) enum Handler {
    #[serde(rename = "static_response")]
    StaticResponse(StaticResponse),
    #[serde(rename = "reverse_proxy")]
    ReverseProxy(Box<ReverseProxy>),
    #[serde(rename = "subroute")]
    Subroute(Subroute),
    #[serde(rename = "request_body")]
    RequestBody(RequestBody),
    #[serde(rename = "authentication")]
    Authentication(Authentication),
    #[serde(rename = "log_append")]
    LogAppend(LogAppend),
}

#[derive(Serialize)]
pub(super) struct LogAppend {
    pub(super) key: String,
    pub(super) value: String,
}

#[derive(Serialize)]
pub(super) struct Authentication {
    pub(super) providers: BTreeMap<String, HttpBasicAuth>,
}

#[derive(Serialize)]
pub(super) struct HttpBasicAuth {
    pub(super) hash: BasicAuthHash,
    pub(super) accounts: Vec<HttpBasicAuthAccount>,
    pub(super) realm: String,
    pub(super) hash_cache: HashCache,
}

#[derive(Serialize)]
pub(super) struct BasicAuthHash {
    pub(super) algorithm: String,
}

#[derive(Serialize)]
pub(super) struct HttpBasicAuthAccount {
    pub(super) username: String,
    pub(super) password: String,
}

#[derive(Serialize)]
pub(super) struct HashCache {}

#[derive(Serialize)]
pub(super) struct StaticResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) headers: Option<BTreeMap<String, Vec<String>>>,
}

#[derive(Serialize)]
pub(super) struct RequestBody {
    pub(super) max_size: u64,
}

#[derive(Serialize)]
pub(super) struct ReverseProxy {
    pub(super) upstreams: Vec<Upstream>,
    pub(super) headers: RequestHeaders,
    pub(super) transport: HttpTransport,
    pub(super) stream_close_delay: String,
}

#[derive(Serialize)]
pub(super) struct Upstream {
    pub(super) dial: String,
}

#[derive(Serialize)]
pub(super) struct RequestHeaders {
    pub(super) request: HeaderOps,
}

#[derive(Serialize)]
pub(super) struct HeaderOps {
    pub(super) set: BTreeMap<String, Vec<String>>,
    pub(super) delete: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct HttpTransport {
    pub(super) protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) dial_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) read_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) response_header_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) write_timeout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) tls: Option<UpstreamTls>,
}

#[derive(Serialize)]
pub(super) struct UpstreamTls {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) ca: Option<CaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) insecure_skip_verify: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) server_name: Option<String>,
}

#[derive(Serialize)]
pub(super) struct CaSource {
    pub(super) provider: String,
    pub(super) pem_files: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct TlsApp {
    pub(super) certificates: CertificateLoaders,
}

#[derive(Serialize)]
pub(super) struct CertificateLoaders {
    pub(super) load_files: Vec<CertificateFile>,
}

#[derive(Serialize)]
pub(super) struct CertificateFile {
    pub(super) certificate: String,
    pub(super) key: String,
    pub(super) tags: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct TlsConnectionPolicy {
    #[serde(rename = "match")]
    pub(super) matcher: TlsMatcher,
    pub(super) certificate_selection: CertificateSelection,
    pub(super) protocol_min: String,
    pub(super) alpn: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct TlsMatcher {
    pub(super) sni: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct CertificateSelection {
    pub(super) any_tag: Vec<String>,
}
