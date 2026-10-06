use super::{
    ACTIVE_CONFIGURATION_FENCE, ACTIVE_CONFIGURATION_FILE, ProxyRuntime, RenderPurpose,
    RuntimeError, StagedCertificate,
    renderer::{
        MAX_RENDERED_PROXY_CONFIG_BYTES, MAX_RENDERED_PROXY_HOST_SOURCE_BYTES, RenderError,
        TlsMaterial, TlsRenderSettings, UpstreamTlsRenderSettings,
        render_config_with_tls_and_crowdsec, render_host_config_for_runtime,
        render_host_sources_for_runtime,
    },
    state::{FileRemovalError, atomic_write, open_absolute_regular_file, state_dir},
};
use crate::{
    models::{ProxyConfigRequest, ValidatedProxyConfig},
    proxy::{is_canonical_uuid, revision_from_config, validate_proxy_config},
};
use std::{collections::BTreeMap, io::Read, path::Path};

impl ProxyRuntime {
    pub(super) fn restore_active_configuration(&self) -> Option<ValidatedProxyConfig> {
        // Only a missing fence authorizes recovery. Incomplete activation, invalid
        // paths and storage errors all recover the baseline without public routes.
        if self.configuration_activation_is_fenced() {
            return None;
        }
        let bytes = state_dir(&self.settings.state_dir)
            .ok()?
            .read_file(ACTIVE_CONFIGURATION_FILE, MAX_RENDERED_PROXY_CONFIG_BYTES)
            .ok()?;
        let request = serde_json::from_slice::<ProxyConfigRequest>(&bytes).ok()?;
        validate_proxy_config(request).ok()
    }

    pub(super) fn configuration_activation_is_fenced(&self) -> bool {
        let Ok(directory) = state_dir(&self.settings.state_dir) else {
            return true;
        };
        let Ok(fence) = directory.child_path(ACTIVE_CONFIGURATION_FENCE) else {
            return true;
        };
        !matches!(std::fs::symlink_metadata(fence), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    }

    pub(super) fn persist_active_configuration(
        &self,
        configuration: &ValidatedProxyConfig,
    ) -> Result<(), RuntimeError> {
        #[cfg(test)]
        self.recovery_write_fault(super::RecoveryWriteFault::BeforeSnapshotWrite)?;
        let request = ProxyConfigRequest {
            version: 7,
            revision: configuration.revision.clone(),
            proxy_hosts: configuration.proxy_hosts.clone(),
            redirect_hosts: configuration.redirect_hosts.clone(),
            http_settings: configuration.http_settings.clone(),
            trusted_cas: configuration.trusted_cas.clone(),
            default_site: configuration.default_site.clone(),
        };
        let bytes = serde_json::to_vec(&request).map_err(|_| RuntimeError::ApplyFailed)?;
        if bytes.len() > MAX_RENDERED_PROXY_CONFIG_BYTES {
            return Err(RuntimeError::ConfigTooLarge);
        }
        atomic_write(
            &self.settings.state_dir.join(ACTIVE_CONFIGURATION_FILE),
            &bytes,
        )
        .map_err(|_| RuntimeError::ApplyFailed)?;
        #[cfg(test)]
        self.recovery_write_fault(super::RecoveryWriteFault::AfterSnapshotWrite)?;
        Ok(())
    }

    pub(super) fn fence_configuration_activation(&self) -> Result<(), RuntimeError> {
        #[cfg(test)]
        self.recovery_write_fault(super::RecoveryWriteFault::BeforeFenceWrite)?;
        atomic_write(
            &self.settings.state_dir.join(ACTIVE_CONFIGURATION_FENCE),
            b"pending\n",
        )
        .map_err(|_| RuntimeError::ApplyFailed)
    }

    pub(super) fn finish_configuration_activation(&self) -> Result<(), RuntimeError> {
        #[cfg(test)]
        self.recovery_write_fault(super::RecoveryWriteFault::BeforeFenceRemoval)?;
        let removal = state_dir(&self.settings.state_dir)
            .map_err(FileRemovalError::BeforeUnlink)
            .and_then(|directory| directory.remove_file_with_outcome(ACTIVE_CONFIGURATION_FENCE));
        #[cfg(test)]
        let removal = removal.and_then(|()| {
            self.recovery_write_fault(super::RecoveryWriteFault::AfterFenceRemoval)
                .map_err(|_| {
                    FileRemovalError::AfterUnlink(std::io::Error::other(
                        "injected fence sync failure",
                    ))
                })
        });
        match removal {
            Ok(()) => Ok(()),
            Err(FileRemovalError::BeforeUnlink(_)) => Err(RuntimeError::ApplyFailed),
            Err(FileRemovalError::AfterUnlink(error)) => {
                // The snapshot is durable and verified before this commit point.
                // Unsynced unlink can recover the candidate or a retained fence's
                // closed baseline; rolling back traffic would split authority.
                tracing::warn!(
                    ?error,
                    stage = "snapshot_commit",
                    "Recovery fence removal was not synchronized; durable snapshot remains authoritative"
                );
                Ok(())
            }
        }
    }

    pub(super) fn restore_recovery_configuration(
        &self,
        configuration: Option<&ValidatedProxyConfig>,
    ) {
        // Rollback only runs before the fence unlink commit point. Preserve the
        // existing fence if storage cannot prepare or complete durable rollback.
        if self.fence_configuration_activation().is_err() {
            tracing::warn!(
                stage = "snapshot_rollback",
                "Recovery snapshot rollback was not prepared"
            );
            return;
        }
        let restored = match configuration {
            Some(configuration) => self.persist_active_configuration(configuration),
            None => state_dir(&self.settings.state_dir)
                .and_then(|directory| directory.remove_file(ACTIVE_CONFIGURATION_FILE))
                .map_err(|_| RuntimeError::ApplyFailed),
        };
        if restored.is_err() || self.finish_configuration_activation().is_err() {
            tracing::warn!(
                stage = "snapshot_rollback",
                "Recovery remains fenced after snapshot rollback"
            );
        }
    }

    #[cfg(test)]
    fn recovery_write_fault(&self, fault: super::RecoveryWriteFault) -> Result<(), RuntimeError> {
        let mut faults = self.recovery_write_faults.lock().unwrap();
        if faults.front() == Some(&fault) {
            faults.pop_front();
            return Err(RuntimeError::ApplyFailed);
        }
        Ok(())
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
        let provider = self.active_crowdsec_provider().await;
        self.render_proxy_config_for_provider(configuration, staged, purpose, &provider)
            .await
    }

    pub(super) async fn render_proxy_config_for_provider(
        &self,
        configuration: &ValidatedProxyConfig,
        staged: Option<&StagedCertificate>,
        purpose: RenderPurpose,
        provider: &super::crowdsec::ActiveProvider,
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
        let crowdsec = provider.render_settings();
        let rendered = render_config_with_tls_and_crowdsec(
            configuration,
            &self.settings.render_settings(),
            &TlsRenderSettings {
                https_port: self.settings.https_port,
                public_https_port: self.settings.public_https_port,
                controller_port: self.settings.controller_port,
            },
            &materials,
            &upstream_tls,
            crowdsec.as_ref(),
        )
        .map_err(|error| match error {
            RenderError::ConfigTooLarge => RuntimeError::ConfigTooLarge,
            RenderError::InvalidProbeSocket
            | RenderError::InvalidCertificatePath
            | RenderError::MissingCertificate
            | RenderError::MissingTrustedCa
            | RenderError::InvalidForwardAuthEndpoint
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
