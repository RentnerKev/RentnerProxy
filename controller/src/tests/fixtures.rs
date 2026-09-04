use crate::{
    models::{ProxyConfigRequest, ProxyHost, ProxyHttpSettings},
    proxy::revision_for_configuration,
};

pub(super) fn host(
    id: &str,
    domains: &[&str],
    scheme: &str,
    forward_host: &str,
    port: u16,
) -> ProxyHost {
    ProxyHost {
        id: id.to_owned(),
        domains: domains.iter().map(|domain| (*domain).to_owned()).collect(),
        forward_scheme: scheme.to_owned(),
        forward_host: forward_host.to_owned(),
        forward_port: port,
        http_settings: ProxyHttpSettings::default(),
        advanced_config: String::new(),
        certificate_id: None,
        force_https: false,
        upstream_tls: None,
    }
}

pub(super) fn request(hosts: Vec<ProxyHost>) -> ProxyConfigRequest {
    request_with_settings(hosts, ProxyHttpSettings::default())
}

pub(super) fn request_with_settings(
    hosts: Vec<ProxyHost>,
    http_settings: ProxyHttpSettings,
) -> ProxyConfigRequest {
    let version = if hosts.iter().any(|host| host.upstream_tls.is_some()) {
        5
    } else if hosts.iter().any(|host| host.certificate_id.is_some()) {
        4
    } else if hosts
        .iter()
        .any(|host| !host.http_settings.is_empty() || !host.advanced_config.is_empty())
    {
        3
    } else if http_settings.is_empty() {
        1
    } else {
        2
    };
    ProxyConfigRequest {
        version,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        redirect_hosts: Vec::new(),
        http_settings,
        trusted_cas: Vec::new(),
    }
}

static PRIVATE_WRITE_FAILURE_PREFIX: std::sync::OnceLock<
    std::sync::Mutex<Option<std::path::PathBuf>>,
> = std::sync::OnceLock::new();

pub(super) fn fail_next_private_key_write_below(path: std::path::PathBuf) {
    let lock = PRIVATE_WRITE_FAILURE_PREFIX.get_or_init(|| std::sync::Mutex::new(None));
    let path = path.canonicalize().unwrap_or(path);
    *lock.lock().expect("test failure lock must not poison") = Some(path);
}

pub(crate) fn should_fail_private_key_write(path: &std::path::Path) -> bool {
    let Some(lock) = PRIVATE_WRITE_FAILURE_PREFIX.get() else {
        return false;
    };
    let mut prefix = lock.lock().expect("test failure lock must not poison");
    let matches = prefix.as_ref().is_some_and(|prefix| {
        path.starts_with(prefix)
            && path
                .file_name()
                .is_some_and(|name| name == "private-key.pem")
    });
    if matches {
        *prefix = None;
    }
    matches
}
