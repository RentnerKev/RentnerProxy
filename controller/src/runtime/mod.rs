mod acme;
mod apply;
mod certificates;
pub(crate) mod clock;
mod engine;
pub(crate) mod renderer;
mod state;
mod trusted_cas;

use crate::{
    models::{ProxyConfigRequest, ProxyRuntimeStatus, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, revision_from_config, validate_proxy_config},
};
use certificates::StagedCertificate;
#[cfg(test)]
pub(crate) use certificates::{CertificateEnvironment, CertificateSource, CertificateStatus};
pub(crate) use certificates::{
    CertificateError, CertificateImportRequest, CertificateIssueRequest, CertificateMetadata,
    CertificateStore,
};
pub(crate) use engine::{CaddyProcess, EngineError, EngineFuture, ProxyEngine};
use renderer::{
    MAX_RENDERED_PROXY_CONFIG_BYTES, MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError,
    RenderSettings, TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings, render_config,
    render_config_with_tls, render_host_config_for_runtime, render_host_sources_for_runtime,
};
use state::{
    LAST_APPLY_FILE, atomic_write, open_absolute_regular_file, prepare_state_dir, read_trimmed,
    state_dir,
};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{
    sync::Mutex,
    task::JoinHandle,
    time::{interval, sleep, timeout},
};
use tracing::{info, warn};
use trusted_cas::TrustedCaStore;

const BASELINE_PROBE_REVISION: &str = "none";
const ACTIVE_CONFIGURATION_FILE: &str = "active-proxy-snapshot.json";

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSettings {
    pub(crate) state_dir: PathBuf,
    pub(crate) http_port: u16,
    pub(crate) https_port: u16,
    pub(crate) public_https_port: u16,
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
    renewal_task: Mutex<Option<JoinHandle<()>>>,
    recovery_task: Mutex<Option<JoinHandle<()>>>,
}

impl ProxyRuntime {
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
        })
    }

    pub(crate) async fn initialize(&self) {
        let _guard = self.apply_lock.lock().await;
        if let Err(error) = self.initialize_locked().await {
            self.mark_unavailable().await;
            warn!(
                stage = "startup",
                ?error,
                "Caddy runtime unavailable; recovery will retry"
            );
        }
    }

    async fn initialize_locked(&self) -> Result<(), RuntimeError> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        prepare_state_dir(&self.settings.state_dir).map_err(|_| RuntimeError::Unavailable)?;
        let caddy = state_dir(&self.settings.state_dir)
            .and_then(|dir| dir.ensure_dir("caddy"))
            .map_err(|_| RuntimeError::Unavailable)?;
        caddy
            .ensure_dir("data")
            .map_err(|_| RuntimeError::Unavailable)?;
        let autosave_dir = caddy
            .ensure_dir("config")
            .and_then(|dir| dir.ensure_dir("caddy"))
            .map_err(|_| RuntimeError::Unavailable)?;
        // Caddy writes its own autosave directly. Reject planted links before that write.
        let autosave_path = autosave_dir
            .child_path("autosave.json")
            .map_err(|_| RuntimeError::Unavailable)?;
        match std::fs::symlink_metadata(autosave_path) {
            Ok(_) => {
                let file = autosave_dir
                    .open_file("autosave.json")
                    .map_err(|_| RuntimeError::Unavailable)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    file.set_permissions(std::fs::Permissions::from_mode(0o600))
                        .map_err(|_| RuntimeError::Unavailable)?;
                }
                #[cfg(not(unix))]
                let _ = file;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(RuntimeError::Unavailable),
        }
        self.certificate_store
            .initialize()
            .await
            .map_err(|_| RuntimeError::Unavailable)?;
        self.trusted_ca_store
            .initialize()
            .map_err(|_| RuntimeError::Unavailable)?;
        let baseline = render_config(None, &self.settings.render_settings())
            .map_err(|_| RuntimeError::ApplyFailed)?;
        // Only a verified v7 snapshot is a recovery cache. Database desired state wins on reconcile.
        let restored = self.restore_active_configuration();
        let restored = if let Some(configuration) = restored {
            self.render_proxy_config_for_apply(&configuration, None, RenderPurpose::Recovery)
                .await
                .ok()
                .map(|json| (configuration, json))
        } else {
            None
        };
        let (configuration, json) = restored.map_or((None, baseline.clone()), |(config, json)| {
            (Some(config), json)
        });
        let expected = configuration
            .as_ref()
            .map_or(BASELINE_PROBE_REVISION, |config| config.revision.as_str());
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        let started = self.start_engine(engine, &json, expected).await;
        let (configuration, json) = if started.is_ok() {
            (configuration, json)
        } else {
            let _ = engine.shutdown().await;
            self.start_engine(engine, &baseline, BASELINE_PROBE_REVISION)
                .await
                .map_err(|_| RuntimeError::Unavailable)?;
            (None, baseline)
        };
        let host_sources = configuration
            .as_ref()
            .map(|config| self.render_active_host_sources(config))
            .transpose()?
            .unwrap_or_default();
        let mut state = self.state.lock().await;
        state.active_revision = configuration.as_ref().map(|config| config.revision.clone());
        state.last_apply_at = read_trimmed(&self.settings.state_dir.join(LAST_APPLY_FILE));
        state.active_json = json;
        state.host_sources = host_sources;
        state.initialized = true;
        state.engine_available = true;
        drop(state);
        *self.active_configuration.lock().await = configuration;
        Ok(())
    }

    fn restore_active_configuration(&self) -> Option<ValidatedProxyConfig> {
        let bytes = state_dir(&self.settings.state_dir)
            .ok()?
            .read_file(ACTIVE_CONFIGURATION_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES)
            .ok()?;
        let request = serde_json::from_slice::<ProxyConfigRequest>(&bytes).ok()?;
        validate_proxy_config(request).ok()
    }

    fn persist_active_configuration(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<(), RuntimeError> {
        let request = ProxyConfigRequest {
            version: 7,
            revision: configuration.revision.clone(),
            proxy_hosts: configuration.proxy_hosts.clone(),
            redirect_hosts: configuration.redirect_hosts.clone(),
            http_settings: configuration.http_settings.clone(),
            trusted_cas: configuration.trusted_cas.clone(),
        };
        let bytes = serde_json::to_vec(&request).map_err(|_| RuntimeError::ApplyFailed)?;
        if bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        atomic_write(
            &self.settings.state_dir.join(ACTIVE_CONFIGURATION_FILE),
            &bytes,
        )
        .map_err(|_| RuntimeError::ApplyFailed)
    }

    pub(crate) async fn start_recovery_worker(self: &Arc<Self>) {
        let mut slot = self.recovery_task.lock().await;
        if slot.is_some() {
            return;
        }
        let runtime = Arc::clone(self);
        *slot = Some(tokio::spawn(async move {
            let mut failures = 0u32;
            loop {
                let delay = if failures == 0 {
                    runtime.settings.recovery_interval
                } else {
                    Duration::from_secs((1u64 << failures.min(6)).min(60))
                };
                sleep(delay).await;
                if runtime.stopping.load(Ordering::SeqCst) {
                    break;
                }
                if runtime.recover().await.is_ok() {
                    failures = 0;
                } else {
                    failures = failures.saturating_add(1);
                }
            }
        }));
    }

    pub(crate) async fn recover(&self) -> Result<(), RuntimeError> {
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        // Healthy idle operation checks only the child handle; it does not rerender or call Admin API.
        if engine.is_running().await && self.state.lock().await.engine_available {
            return Ok(());
        }
        let _guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;
        if !self.state.lock().await.initialized {
            return self.initialize_locked().await;
        }
        self.ensure_running_locked().await
    }

    async fn ensure_running_locked(&self) -> Result<(), RuntimeError> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(RuntimeError::Unavailable);
        }
        let Some(engine) = &self.engine else {
            return Err(RuntimeError::Unavailable);
        };
        let (initialized, available, json, revision) = {
            let state = self.state.lock().await;
            (
                state.initialized,
                state.engine_available,
                state.active_json.clone(),
                state
                    .active_revision
                    .clone()
                    .unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned()),
            )
        };
        if !initialized {
            return Err(RuntimeError::Unavailable);
        }
        if engine.is_running().await && available {
            return Ok(());
        }
        // A failed acknowledgement is ambiguous. Terminate that process before replaying verified state.
        let _ = engine.shutdown().await;
        if self.start_engine(engine, &json, &revision).await.is_err() {
            self.mark_unavailable().await;
            return Err(RuntimeError::Unavailable);
        }
        self.state.lock().await.engine_available = true;
        info!("Caddy recovered verified runtime configuration");
        Ok(())
    }

    pub(crate) async fn start_renewal_scheduler(
        self: &Arc<Self>,
        challenges: crate::server::challenges::ChallengeStore,
    ) {
        let mut task = self.renewal_task.lock().await;
        if task.is_some() {
            return;
        }
        let runtime = Arc::clone(self);
        *task = Some(tokio::spawn(async move {
            let mut timer = interval(Duration::from_secs(6 * 60 * 60));
            loop {
                timer.tick().await;
                runtime.renew_due_certificates(challenges.clone()).await;
            }
        }));
    }

    async fn renew_due_certificates(
        self: &Arc<Self>,
        challenges: crate::server::challenges::ChallengeStore,
    ) {
        let Ok(certificates) = self.certificate_store.list().await else {
            return;
        };
        for certificate in certificates {
            if certificate.source != certificates::CertificateSource::Acme
                || certificate.operation != certificates::CertificateOperation::Idle
                || certificate.status != certificates::CertificateStatus::Valid
                || !Self::renewal_is_due(&certificate)
            {
                continue;
            }
            if !self
                .certificate_store
                .renewal_is_allowed(&certificate.id)
                .await
            {
                continue;
            }
            let _ = self
                .start_scheduled_acme_renewal(certificate.id, challenges.clone())
                .await;
        }
    }

    pub(crate) async fn certificates(&self) -> Result<Vec<CertificateMetadata>, CertificateError> {
        self.certificate_store.list().await
    }

    pub(crate) async fn certificate(
        &self,
        id: &str,
    ) -> Result<CertificateMetadata, CertificateError> {
        self.certificate_store.get(id).await
    }

    pub(crate) async fn import_certificate(
        self: &Arc<Self>,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        let runtime = Arc::clone(self);
        let id = id.to_owned();
        tokio::spawn(async move { runtime.import_certificate_inner(&id, request).await })
            .await
            .unwrap_or(Err(CertificateError::StoreUnavailable))
    }

    async fn import_certificate_inner(
        self: &Arc<Self>,
        id: &str,
        request: CertificateImportRequest,
    ) -> Result<CertificateMetadata, CertificateError> {
        let staged = self.certificate_store.stage_manual(id, request).await?;
        self.commit_or_reapply_staged_certificate(staged).await
    }

    pub(crate) async fn activate_acme_certificate(
        self: &Arc<Self>,
        id: &str,
        request: &CertificateIssueRequest,
        certificate_pem: String,
        private_key_pem: String,
    ) -> Result<CertificateMetadata, CertificateError> {
        let staged = self
            .certificate_store
            .stage_acme(id, request, certificate_pem, private_key_pem)
            .await?;
        self.commit_or_reapply_staged_certificate(staged).await
    }

    async fn commit_or_reapply_staged_certificate(
        self: &Arc<Self>,
        staged: StagedCertificate,
    ) -> Result<CertificateMetadata, CertificateError> {
        let id = staged.id().to_owned();
        if self.apply_staged_for_active(staged.clone()).await.is_err() {
            self.certificate_store.discard_staged(&staged).await;
            return Err(CertificateError::RuntimeApplyFailed);
        }
        self.certificate_store.get(&id).await
    }

    pub(crate) async fn delete_certificate(&self, id: &str) -> Result<(), CertificateError> {
        let _guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| CertificateError::InUse)?;
        let state = self.state.lock().await;
        let marker = format!("/certificates/{id}/versions/");
        let in_use =
            !state.engine_available || state.active_json.replace('\\', "/").contains(&marker);
        drop(state);
        let cached_in_use = self.restore_active_configuration().is_some_and(|config| {
            config
                .proxy_hosts
                .iter()
                .any(|host| host.certificate_id.as_deref() == Some(id))
                || config
                    .redirect_hosts
                    .iter()
                    .any(|host| host.certificate_id.as_deref() == Some(id))
        });
        self.certificate_store
            .delete_if_unused(id, in_use || cached_in_use)
            .await
    }

    pub(crate) async fn status(&self) -> ProxyRuntimeStatus {
        let state = self.state.lock().await;
        let (active_revision, last_apply_at, available) = (
            state.active_revision.clone(),
            state.last_apply_at.clone(),
            state.engine_available && self.engine.is_some(),
        );
        drop(state);
        let running = match &self.engine {
            Some(engine) => engine.is_running().await,
            None => false,
        };
        ProxyRuntimeStatus {
            available,
            running,
            active_revision,
            last_apply_at,
        }
    }

    pub(crate) async fn is_ready(&self) -> bool {
        // A concurrent apply can legitimately change the probe while state is being committed.
        let Ok(_guard) = timeout(self.settings.lock_wait, self.apply_lock.lock()).await else {
            return false;
        };
        let status = self.status().await;
        if !status.available || !status.running {
            return false;
        }
        let Some(engine) = &self.engine else {
            return false;
        };
        let ready = self
            .run_stage(
                engine.probe(
                    status
                        .active_revision
                        .as_deref()
                        .unwrap_or(BASELINE_PROBE_REVISION),
                ),
            )
            .await
            .is_ok();
        if !ready {
            self.mark_unavailable().await;
        }
        ready
    }

    pub(crate) async fn preview_config(
        &self,
        config: &ValidatedProxyConfig,
    ) -> Result<String, RuntimeError> {
        self.render_proxy_config_for_apply(config, None, RenderPurpose::Preview)
            .await
    }

    pub(crate) async fn active_config(&self) -> Result<(String, Option<String>), RuntimeError> {
        let state = self.state.lock().await;
        if !state.initialized {
            return Err(RuntimeError::Unavailable);
        }
        Ok((state.active_json.clone(), state.active_revision.clone()))
    }

    pub(crate) fn preview_host_config(
        &self,
        config: &ValidatedProxyConfig,
        id: &str,
    ) -> Result<String, RuntimeError> {
        if !is_canonical_uuid(id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let host = config
            .proxy_hosts
            .iter()
            .find(|host| host.id == id)
            .ok_or(RuntimeError::HostConfigNotFound)?;
        let upstream_tls = self.upstream_tls_render_settings(config, false)?;
        let source = render_host_config_for_runtime(
            host,
            &config.http_settings,
            self.settings.public_https_port,
            Some(&upstream_tls),
        )
        .map_err(|_| RuntimeError::ApplyFailed)?;
        if source.len() > MAX_RENDERED_PROXY_HOST_SOURCE_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        Ok(source)
    }

    pub(crate) async fn active_host_config(
        &self,
        id: &str,
    ) -> Result<(String, String), RuntimeError> {
        if !is_canonical_uuid(id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let state = self.state.lock().await;
        let revision = state
            .active_revision
            .clone()
            .ok_or(RuntimeError::HostConfigNotFound)?;
        let source = state
            .host_sources
            .get(id)
            .cloned()
            .ok_or(RuntimeError::HostConfigNotFound)?;
        Ok((source, revision))
    }

    fn render_active_host_sources(
        &self,
        config: &ValidatedProxyConfig,
    ) -> Result<BTreeMap<String, String>, RuntimeError> {
        let upstream_tls = self.upstream_tls_render_settings(config, false)?;
        render_host_sources_for_runtime(
            config,
            self.settings.public_https_port,
            Some(&upstream_tls),
        )
        .map_err(|_| RuntimeError::ApplyFailed)
    }

    async fn render_proxy_config_for_apply(
        &self,
        configuration: &ValidatedProxyConfig,
        staged: Option<&StagedCertificate>,
        purpose: RenderPurpose,
    ) -> Result<String, RuntimeError> {
        let mut materials = BTreeMap::new();
        let certificate_hosts = configuration
            .proxy_hosts
            .iter()
            .filter_map(|host| {
                host.certificate_id
                    .as_deref()
                    .map(|certificate_id| (certificate_id, host.domains.as_slice()))
            })
            .chain(configuration.redirect_hosts.iter().filter_map(|host| {
                host.certificate_id
                    .as_deref()
                    .map(|certificate_id| (certificate_id, host.domains.as_slice()))
            }));
        for (certificate_id, domains) in certificate_hosts {
            let staged_certificate = staged.filter(|staged| staged.id() == certificate_id);
            let covers_domains = match staged_certificate {
                Some(staged) => staged.covers_domains(domains),
                None => self
                    .certificate_store
                    .covers_domains(certificate_id, domains, purpose != RenderPurpose::Recovery)
                    .await
                    .map_err(|_| RuntimeError::ApplyFailed)?,
            };
            if !covers_domains {
                return Err(RuntimeError::ApplyFailed);
            }
            let material = match staged_certificate {
                Some(staged) => self
                    .certificate_store
                    .staged_material(staged)
                    .map_err(|_| RuntimeError::ApplyFailed)?,
                None => self
                    .certificate_store
                    .material(certificate_id)
                    .await
                    .map_err(|_| RuntimeError::ApplyFailed)?,
            };
            materials.insert(
                certificate_id.to_owned(),
                TlsMaterial {
                    fullchain_path: material.fullchain_path,
                    private_key_path: material.private_key_path,
                },
            );
        }
        let upstream_tls =
            self.upstream_tls_render_settings(configuration, purpose != RenderPurpose::Preview)?;
        let rendered = render_config_with_tls(
            configuration,
            &self.settings.render_settings(),
            &TlsRenderSettings {
                https_port: self.settings.https_port,
                public_https_port: self.settings.public_https_port,
                controller_port: self.settings.controller_port,
            },
            &materials,
            &upstream_tls,
        )
        .map_err(|error| match error {
            RenderError::ConfigTooLarge => RuntimeError::ConfigTooLarge,
            RenderError::InvalidProbeSocket
            | RenderError::InvalidCertificatePath
            | RenderError::MissingCertificate
            | RenderError::MissingTrustedCa
            | RenderError::MissingUpstreamTlsPolicy => RuntimeError::ApplyFailed,
        })?;
        if revision_from_config(&rendered).as_deref() != Some(configuration.revision.as_str()) {
            return Err(RuntimeError::ApplyFailed);
        }
        Ok(rendered)
    }

    fn upstream_tls_render_settings(
        &self,
        configuration: &ValidatedProxyConfig,
        materialize: bool,
    ) -> Result<UpstreamTlsRenderSettings, RuntimeError> {
        let uses_system_trust = configuration.proxy_hosts.iter().any(|host| {
            host.upstream_tls.as_ref().is_some_and(|upstream_tls| {
                upstream_tls.verify && upstream_tls.trusted_ca_id.is_none()
            })
        });
        if uses_system_trust && !is_readable_system_ca_bundle(&self.settings.system_ca_bundle) {
            return Err(RuntimeError::ApplyFailed);
        }
        let mut trusted_ca_paths = BTreeMap::new();
        for trusted_ca in &configuration.trusted_cas {
            let material = if materialize {
                self.trusted_ca_store.materialize(trusted_ca)
            } else {
                self.trusted_ca_store.material_for(trusted_ca)
            }
            .map_err(|_| RuntimeError::ApplyFailed)?;
            trusted_ca_paths.insert(trusted_ca.id.clone(), material.pem_path);
        }
        Ok(UpstreamTlsRenderSettings {
            system_ca_bundle: self.settings.system_ca_bundle.clone(),
            trusted_ca_paths,
        })
    }

    pub(crate) async fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        for slot in [&self.renewal_task, &self.recovery_task] {
            if let Some(task) = slot.lock().await.take() {
                task.abort();
                let _ = task.await;
            }
        }
        let _guard = self.apply_lock.lock().await;
        if let Some(engine) = &self.engine
            && engine.shutdown().await.is_err()
        {
            warn!(stage = "shutdown", "Caddy required forced termination");
        }
        self.mark_unavailable().await;
    }

    async fn start_engine(
        &self,
        engine: &Arc<dyn ProxyEngine>,
        json: &str,
        revision: &str,
    ) -> Result<(), EngineError> {
        let result = self.run_stage(engine.start(json, revision)).await;
        if result.is_err() {
            // Also reap a child when the outer stage timeout cancels start's future.
            let _ = engine.shutdown().await;
        }
        result
    }

    async fn run_stage<'a>(&self, future: EngineFuture<'a>) -> Result<(), EngineError> {
        timeout(self.settings.stage_timeout, future)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }
    async fn mark_unavailable(&self) {
        self.state.lock().await.engine_available = false;
    }

    fn renewal_is_due(certificate: &CertificateMetadata) -> bool {
        let Some(expires_at) = certificate.expires_at.as_deref() else {
            return false;
        };
        let Ok(expires_at) = OffsetDateTime::parse(expires_at, &Rfc3339) else {
            return false;
        };
        let now = OffsetDateTime::now_utc();
        let minimum_window = Duration::from_secs(30 * 24 * 60 * 60).as_secs() as i64;
        let one_third = certificate
            .issued_at
            .as_deref()
            .and_then(|issued_at| OffsetDateTime::parse(issued_at, &Rfc3339).ok())
            .map(|issued_at| (expires_at - issued_at).whole_seconds() / 3)
            .unwrap_or(minimum_window);
        expires_at - now <= time::Duration::seconds(minimum_window.max(one_third))
    }
}

fn is_readable_system_ca_bundle(path: &Path) -> bool {
    let mut file = match open_absolute_regular_file(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut byte = [0u8; 1];
    file.read(&mut byte).is_ok_and(|read| read > 0)
}
