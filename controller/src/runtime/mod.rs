pub(crate) mod access_logs;
mod acme;
mod apply;
mod certificate_management;
mod certificates;
pub(crate) mod clock;
mod configuration;
mod dns;
mod engine;
mod lifecycle;
pub(crate) mod renderer;
mod renewal;
mod state;
mod trusted_cas;

use crate::models::ValidatedProxyConfig;
use certificates::StagedCertificate;
#[cfg(test)]
pub(crate) use certificates::{CertificateEnvironment, CertificateSource, CertificateStatus};
pub(crate) use certificates::{
    CertificateError, CertificateEventPage, CertificateImportRequest, CertificateIssueRequest,
    CertificateMetadata, CertificateOperationStage, CertificateStore, CertificateStoreReadiness,
};
pub(crate) use engine::{CaddyProcess, EngineError, EngineFuture, ProxyEngine};
use renderer::RenderSettings;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, AtomicUsize},
    },
    time::Duration,
};
use tokio::{sync::Mutex, task::JoinHandle};
use trusted_cas::TrustedCaStore;

const BASELINE_PROBE_REVISION: &str = "none";
const ACTIVE_CONFIGURATION_FILE: &str = "active-proxy-snapshot.json";
const MAX_CANDIDATE_ACTIVATIONS_PER_TICK: usize = 4;

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSettings {
    pub(crate) state_dir: PathBuf,
    pub(crate) http_port: u16,
    pub(crate) https_port: u16,
    pub(crate) public_https_port: u16,
    pub(crate) trusted_proxy_cidrs: Vec<String>,
    pub(crate) controller_port: u16,
    pub(crate) lock_wait: Duration,
    pub(crate) stage_timeout: Duration,
    pub(crate) recovery_interval: Duration,
    pub(crate) system_ca_bundle: PathBuf,
}
impl RuntimeSettings {
    pub(crate) fn new(state_dir: PathBuf, http_port: u16) -> Self {
        Self {
            state_dir,
            http_port,
            https_port: 8_443,
            public_https_port: 443,
            trusted_proxy_cidrs: Vec::new(),
            controller_port: 8_081,
            lock_wait: Duration::from_secs(2),
            stage_timeout: Duration::from_secs(15),
            recovery_interval: Duration::from_secs(5),
            system_ca_bundle: PathBuf::from("/etc/ssl/certs/ca-certificates.crt"),
        }
    }
    pub(crate) fn probe_socket(&self) -> Option<PathBuf> {
        cfg!(unix).then(|| self.state_dir.join("runtime-probe.sock"))
    }
    fn render_settings(&self) -> RenderSettings {
        RenderSettings {
            http_port: self.http_port,
            probe_socket: self.probe_socket(),
            admin_socket: cfg!(unix).then(|| self.state_dir.join("caddy-admin.sock")),
            state_dir: self.state_dir.clone(),
            controller_port: self.controller_port,
            trusted_proxy_cidrs: self.trusted_proxy_cidrs.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RuntimeError {
    Busy,
    Unavailable,
    ApplyFailed,
    ConfigTooLarge,
    HostConfigNotFound,
}

struct RuntimeState {
    active_revision: Option<String>,
    last_apply_at: Option<String>,
    engine_available: bool,
    initialized: bool,
    active_json: String,
    host_sources: BTreeMap<String, String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RenderPurpose {
    Activation,
    Preview,
    Recovery,
}

pub(crate) struct ProxyRuntime {
    settings: RuntimeSettings,
    engine: Option<Arc<dyn ProxyEngine>>,
    state: Mutex<RuntimeState>,
    apply_lock: Mutex<()>,
    apply_sequence: AtomicU64,
    stopping: AtomicBool,
    active_configuration: Mutex<Option<ValidatedProxyConfig>>,
    certificate_store: CertificateStore,
    trusted_ca_store: TrustedCaStore,
    access_log_snapshots: access_logs::SnapshotCache,
    renewal_task: Mutex<Option<JoinHandle<()>>>,
    recovery_task: Mutex<Option<JoinHandle<()>>>,
    candidate_cursor: AtomicUsize,
    dns_cleanup_cursor: AtomicUsize,
}

impl ProxyRuntime {
    pub(crate) async fn access_logs(
        &self,
        query: access_logs::ValidatedAccessLogQuery,
    ) -> Result<access_logs::AccessLogResponse, access_logs::ReadError> {
        access_logs::read(&self.settings.state_dir, query, &self.access_log_snapshots).await
    }

    pub(crate) fn new(
        settings: RuntimeSettings,
        engine: Option<Arc<dyn ProxyEngine>>,
    ) -> Arc<Self> {
        let certificate_store = CertificateStore::new(settings.state_dir.clone());
        let trusted_ca_store = TrustedCaStore::new(settings.state_dir.clone());
        Arc::new(Self {
            settings,
            engine,
            certificate_store,
            trusted_ca_store,
            access_log_snapshots: access_logs::SnapshotCache::new(),
            state: Mutex::new(RuntimeState {
                active_revision: None,
                last_apply_at: None,
                engine_available: false,
                initialized: false,
                active_json: String::new(),
                host_sources: BTreeMap::new(),
            }),
            apply_lock: Mutex::new(()),
            apply_sequence: AtomicU64::new(0),
            stopping: AtomicBool::new(false),
            active_configuration: Mutex::new(None),
            renewal_task: Mutex::new(None),
            recovery_task: Mutex::new(None),
            candidate_cursor: AtomicUsize::new(0),
            dns_cleanup_cursor: AtomicUsize::new(0),
        })
    }
}
