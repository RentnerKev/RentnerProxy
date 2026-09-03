mod acme;
mod apply;
mod certificates;
pub(crate) mod clock;
mod engine;
pub(crate) mod renderer;
mod state;
mod trusted_cas;

use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use serde::{Deserialize, Serialize};
use tokio::{
    sync::Mutex,
    task::JoinHandle,
    time::{interval, timeout},
};
use tracing::{info, warn};

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
pub(crate) use engine::{EngineError, EngineFuture, ProcessEngine, ProxyEngine};
use renderer::{
    MAX_RENDERED_PROXY_CONFIG_BYTES, MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError,
    RenderSettings, TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings, render_config,
    render_config_with_tls, render_host_config_for_runtime, render_host_sources_for_runtime,
};
use state::{
    ACTIVE_CONFIG_FILE, CANDIDATE_CONFIG_FILE, LAST_APPLY_FILE, LAST_GOOD_CONFIG_FILE,
    atomic_write, open_absolute_regular_file, prepare_state_dir, read_trimmed, state_dir,
};
use trusted_cas::TrustedCaStore;

#[cfg(unix)]
const PROBE_SOCKET_FILE: &str = "runtime-probe.sock";
const BASELINE_PROBE_REVISION: &str = "none";
const ACTIVE_HOST_SOURCES_FILE: &str = "active-host-sources.json";
const ACTIVE_CONFIGURATION_FILE: &str = "active-proxy-snapshot.json";
const MAX_ACTIVE_HOST_SOURCES_BYTES: usize = MAX_RENDERED_PROXY_CONFIG_BYTES * 6 + 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct RuntimeSettings {
    pub(crate) state_dir: PathBuf,
    pub(crate) http_port: u16,
    pub(crate) https_port: u16,
    pub(crate) public_https_port: u16,
    pub(crate) controller_port: u16,
    pub(crate) lock_wait: Duration,
    pub(crate) stage_timeout: Duration,
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
            stage_timeout: Duration::from_secs(4),
            system_ca_bundle: PathBuf::from("/etc/ssl/certs/ca-certificates.crt"),
        }
    }

    pub(crate) fn probe_socket(&self) -> Option<PathBuf> {
        #[cfg(unix)]
        {
            Some(self.state_dir.join(PROBE_SOCKET_FILE))
        }
        #[cfg(not(unix))]
        {
            None
        }
    }

    fn render_settings(&self) -> RenderSettings {
        RenderSettings {
            http_port: self.http_port,
            probe_socket: self.probe_socket(),
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ActiveHostSources {
    revision: String,
    host_sources: BTreeMap<String, String>,
}

struct RuntimeState {
    active_revision: Option<String>,
    last_apply_at: Option<String>,
    engine_available: bool,
}

pub(crate) struct ProxyRuntime {
    settings: RuntimeSettings,
    engine: Option<Arc<dyn ProxyEngine>>,
    state: Mutex<RuntimeState>,
    apply_lock: Mutex<()>,
    active_configuration: Mutex<Option<ValidatedProxyConfig>>,
    certificate_store: CertificateStore,
    trusted_ca_store: TrustedCaStore,
    renewal_task: Mutex<Option<JoinHandle<()>>>,
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
            state: Mutex::new(RuntimeState {
                active_revision: None,
                last_apply_at: None,
                engine_available: true,
            }),
            apply_lock: Mutex::new(()),
            active_configuration: Mutex::new(None),
            certificate_store,
            trusted_ca_store,
            renewal_task: Mutex::new(None),
        })
    }

    pub(crate) async fn initialize(&self) {
        if prepare_state_dir(&self.settings.state_dir).is_err() {
            self.mark_unavailable().await;
            warn!(stage = "state_directory", "proxy runtime is unavailable");
            return;
        }
        if self.certificate_store.initialize().await.is_err() {
            self.mark_unavailable().await;
            warn!(stage = "certificate_store", "proxy runtime is unavailable");
            return;
        }
        if self.trusted_ca_store.initialize().is_err() {
            self.mark_unavailable().await;
            warn!(stage = "trusted_ca_store", "proxy runtime is unavailable");
            return;
        }

        let active_path = self.active_path();
        let mut last_good = self
            .read_state_text(LAST_GOOD_CONFIG_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES)
            .ok();
        let mut persist_active_as_last_good = last_good.is_none();
        let mut active_contents =
            match self.read_state_text(ACTIVE_CONFIG_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES) {
                Ok(contents) => contents,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    if let Some(last_good) = last_good.as_ref() {
                        if atomic_write(&active_path, last_good.as_bytes()).is_err() {
                            self.mark_unavailable().await;
                            warn!(
                                stage = "restore_missing_active",
                                "proxy runtime is unavailable"
                            );
                            return;
                        }
                        persist_active_as_last_good = false;
                        last_good.clone()
                    } else {
                        let baseline = match render_config(None, &self.settings.render_settings()) {
                            Ok(config) => config,
                            Err(_) => {
                                self.mark_unavailable().await;
                                warn!(stage = "render_baseline", "proxy runtime is unavailable");
                                return;
                            }
                        };
                        if atomic_write(&active_path, baseline.as_bytes()).is_err()
                            || atomic_write(&self.last_good_path(), baseline.as_bytes()).is_err()
                        {
                            self.mark_unavailable().await;
                            warn!(stage = "write_baseline", "proxy runtime is unavailable");
                            return;
                        }
                        last_good = Some(baseline.clone());
                        persist_active_as_last_good = false;
                        baseline
                    }
                }
                Err(_) => {
                    let Some(last_good) = last_good.as_ref() else {
                        self.mark_unavailable().await;
                        warn!(stage = "read_active", "proxy runtime is unavailable");
                        return;
                    };
                    if atomic_write(&active_path, last_good.as_bytes()).is_err() {
                        self.mark_unavailable().await;
                        warn!(
                            stage = "restore_unreadable_active",
                            "proxy runtime is unavailable"
                        );
                        return;
                    }
                    persist_active_as_last_good = false;
                    last_good.clone()
                }
            };
        let mut engine_available = false;
        if let Some(engine) = &self.engine {
            if self
                .start_configuration(engine, &active_path, &active_contents)
                .await
                .is_err()
            {
                let restored = last_good
                    .as_ref()
                    .filter(|last_good| *last_good != &active_contents);
                if let Some(last_good) = restored
                    && atomic_write(&active_path, last_good.as_bytes()).is_ok()
                    && self
                        .start_configuration(engine, &active_path, last_good)
                        .await
                        .is_ok()
                {
                    active_contents = last_good.clone();
                    persist_active_as_last_good = false;
                    engine_available = true;
                    info!(
                        stage = "startup_recovery",
                        "proxy runtime restored last-good configuration"
                    );
                }
            } else {
                engine_available = true;
            }
            if !engine_available {
                warn!(
                    stage = "startup",
                    "proxy runtime did not start; controller remains available"
                );
            }
        }
        if engine_available
            && persist_active_as_last_good
            && atomic_write(&self.last_good_path(), active_contents.as_bytes()).is_err()
        {
            warn!(
                stage = "write_last_good",
                "proxy runtime could not persist its last-good configuration"
            );
        }
        let restored_configuration = self.restore_active_configuration(&active_contents).await;
        let mut state = self.state.lock().await;
        state.active_revision = revision_from_config(&active_contents);
        state.last_apply_at = read_trimmed(&self.last_apply_path());
        state.engine_available = engine_available;
        drop(state);
        *self.active_configuration.lock().await = restored_configuration;
    }

    async fn restore_active_configuration(
        &self,
        active_contents: &str,
    ) -> Option<ValidatedProxyConfig> {
        let mut reader = state_dir(&self.settings.state_dir)
            .ok()?
            .open_file(ACTIVE_CONFIGURATION_FILE)
            .ok()?
            .take((MAX_RENDERED_PROXY_CONFIG_BYTES as u64) + 1);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).ok()?;
        if bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return None;
        }
        let request = serde_json::from_slice::<ProxyConfigRequest>(&bytes).ok()?;
        let configuration = validate_proxy_config(request).ok()?;
        if revision_from_config(active_contents).as_deref() != Some(configuration.revision.as_str())
        {
            return None;
        }
        self.render_proxy_config_for_apply(&configuration, None, true)
            .await
            .ok()
            .filter(|rendered| rendered == active_contents)
            .map(|_| configuration)
    }

    fn persist_active_configuration(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<(), RuntimeError> {
        let request = ProxyConfigRequest {
            version: snapshot_version(configuration),
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
        atomic_write(&self.active_configuration_path(), &bytes)
            .map_err(|_| RuntimeError::ApplyFailed)
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
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| CertificateError::InUse)?;
        let marker = format!("/certificates/{id}/versions/");
        let active_or_last_good = [ACTIVE_CONFIG_FILE, LAST_GOOD_CONFIG_FILE];
        let in_use = active_or_last_good.iter().any(|component| {
            match self.read_state_text(component, MAX_RENDERED_PROXY_CONFIG_BYTES) {
                Ok(contents) => contents.contains(&marker),
                Err(_) => true,
            }
        }) || match self
            .read_state_text(CANDIDATE_CONFIG_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES)
        {
            Ok(contents) => contents.contains(&marker),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => true,
        };
        self.certificate_store.delete_if_unused(id, in_use).await
    }

    pub(crate) async fn status(&self) -> ProxyRuntimeStatus {
        let (active_revision, last_apply_at, available) = {
            let state = self.state.lock().await;
            (
                state.active_revision.clone(),
                state.last_apply_at.clone(),
                state.engine_available && self.engine.is_some(),
            )
        };
        let running = match &self.engine {
            Some(engine) if available => engine.is_running().await,
            Some(_) | None => false,
        };
        ProxyRuntimeStatus {
            available,
            running,
            active_revision,
            last_apply_at,
        }
    }

    pub(crate) async fn is_ready(&self) -> bool {
        let status = self.status().await;
        if !status.available || !status.running {
            return false;
        }

        matches!(
            self.active_config().await,
            Ok((configuration, _)) if !configuration.trim().is_empty()
        )
    }

    pub(crate) async fn preview_config(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<String, RuntimeError> {
        self.render_proxy_config_for_apply(configuration, None, false)
            .await
    }

    pub(crate) async fn active_config(&self) -> Result<(String, Option<String>), RuntimeError> {
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;
        let mut reader = state_dir(&self.settings.state_dir)
            .and_then(|directory| directory.open_file(ACTIVE_CONFIG_FILE))
            .map_err(|_| RuntimeError::Unavailable)?
            .take((MAX_RENDERED_PROXY_CONFIG_BYTES as u64) + 1);
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .map_err(|_| RuntimeError::Unavailable)?;
        if bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        let contents = String::from_utf8(bytes).map_err(|_| RuntimeError::Unavailable)?;
        let revision = revision_from_config(&contents);
        Ok((contents, revision))
    }

    pub(crate) fn preview_host_config(
        &self,
        configuration: &ValidatedProxyConfig,
        host_id: &str,
    ) -> Result<String, RuntimeError> {
        if !is_canonical_uuid(host_id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let host = configuration
            .proxy_hosts
            .iter()
            .find(|host| host.id == host_id)
            .ok_or(RuntimeError::HostConfigNotFound)?;
        let upstream_tls = self.upstream_tls_render_settings(configuration, false)?;
        let source = render_host_config_for_runtime(
            host,
            self.settings.http_port,
            self.settings.controller_port,
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
        host_id: &str,
    ) -> Result<(String, String), RuntimeError> {
        if !is_canonical_uuid(host_id) {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let _apply_guard = timeout(self.settings.lock_wait, self.apply_lock.lock())
            .await
            .map_err(|_| RuntimeError::Busy)?;

        let mut active_reader = state_dir(&self.settings.state_dir)
            .and_then(|directory| directory.open_file(ACTIVE_CONFIG_FILE))
            .map_err(|_| RuntimeError::Unavailable)?
            .take((MAX_RENDERED_PROXY_CONFIG_BYTES as u64) + 1);
        let mut active_bytes = Vec::new();
        active_reader
            .read_to_end(&mut active_bytes)
            .map_err(|_| RuntimeError::Unavailable)?;
        if active_bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        let active_contents =
            String::from_utf8(active_bytes).map_err(|_| RuntimeError::Unavailable)?;
        let active_revision =
            revision_from_config(&active_contents).ok_or(RuntimeError::HostConfigNotFound)?;

        let mut source_reader = state_dir(&self.settings.state_dir)
            .and_then(|directory| directory.open_file(ACTIVE_HOST_SOURCES_FILE))
            .map_err(|_| RuntimeError::HostConfigNotFound)?
            .take((MAX_ACTIVE_HOST_SOURCES_BYTES as u64) + 1);
        let mut source_bytes = Vec::new();
        source_reader
            .read_to_end(&mut source_bytes)
            .map_err(|_| RuntimeError::HostConfigNotFound)?;
        if source_bytes.len() > MAX_ACTIVE_HOST_SOURCES_BYTES {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let sources = serde_json::from_slice::<ActiveHostSources>(&source_bytes)
            .map_err(|_| RuntimeError::HostConfigNotFound)?;
        if sources.revision != active_revision {
            return Err(RuntimeError::HostConfigNotFound);
        }
        let source = sources
            .host_sources
            .get(host_id)
            .filter(|source| source.len() <= MAX_RENDERED_PROXY_HOST_SOURCE_BYTES)
            .cloned()
            .ok_or(RuntimeError::HostConfigNotFound)?;
        Ok((source, active_revision))
    }

    fn render_active_host_sources(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<ActiveHostSources, RuntimeError> {
        let upstream_tls = self.upstream_tls_render_settings(configuration, false)?;
        let host_sources = render_host_sources_for_runtime(
            configuration,
            self.settings.http_port,
            self.settings.controller_port,
            self.settings.public_https_port,
            Some(&upstream_tls),
        )
        .map_err(|error| match error {
            RenderError::ConfigTooLarge => RuntimeError::ConfigTooLarge,
            RenderError::InvalidProbeSocket
            | RenderError::InvalidCertificatePath
            | RenderError::MissingCertificate
            | RenderError::MissingTrustedCa => RuntimeError::ApplyFailed,
        })?;
        Ok(ActiveHostSources {
            revision: configuration.revision.clone(),
            host_sources,
        })
    }

    fn persist_active_host_sources(&self, sources: &ActiveHostSources) -> Result<(), RuntimeError> {
        let bytes = serde_json::to_vec(sources).map_err(|_| RuntimeError::ApplyFailed)?;
        if bytes.len() > MAX_ACTIVE_HOST_SOURCES_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        atomic_write(&self.active_host_sources_path(), &bytes)
            .map_err(|_| RuntimeError::ApplyFailed)
    }

    async fn render_proxy_config_for_apply(
        &self,
        configuration: &ValidatedProxyConfig,
        staged: Option<&StagedCertificate>,
        materialize_upstream_tls: bool,
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
                    .covers_domains(certificate_id, domains)
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
            self.upstream_tls_render_settings(configuration, materialize_upstream_tls)?;
        render_config_with_tls(
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
            | RenderError::MissingTrustedCa => RuntimeError::ApplyFailed,
        })
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
        if let Some(task) = self.renewal_task.lock().await.take() {
            task.abort();
        }
        if let Some(engine) = &self.engine
            && engine.shutdown().await.is_err()
        {
            warn!(stage = "shutdown", "proxy engine did not stop cleanly");
        }
    }

    async fn run_stage<'a>(&self, future: EngineFuture<'a>) -> Result<(), EngineError> {
        timeout(self.settings.stage_timeout, future)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    async fn start_configuration(
        &self,
        engine: &Arc<dyn ProxyEngine>,
        config_path: &Path,
        contents: &str,
    ) -> Result<(), EngineError> {
        let expected_revision =
            revision_from_config(contents).unwrap_or_else(|| BASELINE_PROBE_REVISION.to_owned());
        self.run_stage(engine.test_config(config_path)).await?;
        self.run_stage(engine.start(config_path, &expected_revision))
            .await
    }

    async fn handle_engine_error(&self, error: EngineError) {
        if matches!(error, EngineError::Unavailable | EngineError::Unsupported) {
            self.mark_unavailable().await;
        }
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

    fn read_state_text(&self, component: &str, maximum_bytes: usize) -> std::io::Result<String> {
        let bytes = state_dir(&self.settings.state_dir)?.read_file(component, maximum_bytes)?;
        String::from_utf8(bytes).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "runtime state file is not UTF-8",
            )
        })
    }
    fn active_path(&self) -> PathBuf {
        self.settings.state_dir.join(ACTIVE_CONFIG_FILE)
    }

    fn candidate_path(&self) -> PathBuf {
        self.settings.state_dir.join(CANDIDATE_CONFIG_FILE)
    }

    fn last_good_path(&self) -> PathBuf {
        self.settings.state_dir.join(LAST_GOOD_CONFIG_FILE)
    }

    fn last_apply_path(&self) -> PathBuf {
        self.settings.state_dir.join(LAST_APPLY_FILE)
    }

    fn active_configuration_path(&self) -> PathBuf {
        self.settings.state_dir.join(ACTIVE_CONFIGURATION_FILE)
    }
    fn active_host_sources_path(&self) -> PathBuf {
        self.settings.state_dir.join(ACTIVE_HOST_SOURCES_FILE)
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
fn snapshot_version(configuration: &ValidatedProxyConfig) -> u8 {
    if !configuration.redirect_hosts.is_empty() {
        6
    } else if configuration
        .proxy_hosts
        .iter()
        .any(|host| host.upstream_tls.is_some())
    {
        5
    } else if configuration
        .proxy_hosts
        .iter()
        .any(|host| host.certificate_id.is_some())
    {
        4
    } else if configuration
        .proxy_hosts
        .iter()
        .any(|host| !host.http_settings.is_empty() || !host.advanced_config.is_empty())
    {
        3
    } else if !configuration.http_settings.is_empty() {
        2
    } else {
        1
    }
}
