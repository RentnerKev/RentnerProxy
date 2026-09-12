use super::{
    ACTIVE_CONFIGURATION_FILE, ProxyRuntime, RenderPurpose, RuntimeError, StagedCertificate,
    renderer::{
        MAX_RENDERED_PROXY_CONFIG_BYTES, MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError,
        TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings, render_config_with_tls,
        render_host_config_for_runtime, render_host_sources_for_runtime,
    },
    state::{atomic_write, open_absolute_regular_file, state_dir},
};
use crate::{
    models::{ProxyConfigRequest, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, revision_from_config, validate_proxy_config},
};
use std::{collections::BTreeMap, io::Read, path::Path};

impl ProxyRuntime {
    pub(super) fn restore_active_configuration(&self) -> Option<ValidatedProxyConfig> {
        let bytes = state_dir(&self.settings.state_dir)
            .ok()?
            .read_file(ACTIVE_CONFIGURATION_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES)
            .ok()?;
        let request = serde_json::from_slice::<ProxyConfigRequest>(&bytes).ok()?;
        validate_proxy_config(request).ok()
    }

    pub(super) fn persist_active_configuration(
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
            &self.settings.trusted_proxy_cidrs,
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

    pub(super) fn render_active_host_sources(
        &self,
        config: &ValidatedProxyConfig,
    ) -> Result<BTreeMap<String, String>, RuntimeError> {
        let upstream_tls = self.upstream_tls_render_settings(config, false)?;
        render_host_sources_for_runtime(
            config,
            self.settings.public_https_port,
            Some(&upstream_tls),
            &self.settings.trusted_proxy_cidrs,
        )
        .map_err(|_| RuntimeError::ApplyFailed)
    }

    pub(super) async fn render_proxy_config_for_apply(
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
}

fn is_readable_system_ca_bundle(path: &Path) -> bool {
    let mut file = match open_absolute_regular_file(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut byte = [0u8; 1];
    file.read(&mut byte).is_ok_and(|read| read > 0)
}
