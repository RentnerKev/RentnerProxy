use crate::{
    models::{ProxyConfigRequest, ProxyHost, ProxyHttpSettings},
    proxy::revision_for_configuration,
};

pub(crate) async fn reserve_dns_socket_pair(
    mut candidate: std::net::SocketAddr,
) -> std::io::Result<(tokio::net::TcpListener, tokio::net::UdpSocket)> {
    let mut attempts = 0;
    loop {
        attempts += 1;
        // Start with UDP so Windows avoids UDP-reserved ranges when choosing an
        // ephemeral port. Keep it reserved while binding TCP to the same port.
        let pair: std::io::Result<_> = async {
            let udp = tokio::net::UdpSocket::bind(candidate).await?;
            let tcp = tokio::net::TcpListener::bind(udp.local_addr()?).await?;
            Ok((tcp, udp))
        }
        .await;
        match pair {
            Ok(pair) => return Ok(pair),
            Err(error)
                if (error.kind() == std::io::ErrorKind::AddrInUse
                    || (cfg!(windows) && error.kind() == std::io::ErrorKind::PermissionDenied))
                    && attempts < 32 =>
            {
                candidate.set_port(0);
            }
            Err(error) => return Err(error),
        }
    }
}

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
        certificate_id: None,
        force_https: false,
        upstream_tls: None,
        response_cache: None,
        access_policy: None,
    }
}

pub(super) fn request(hosts: Vec<ProxyHost>) -> ProxyConfigRequest {
    request_with_settings(hosts, ProxyHttpSettings::default())
}

pub(super) fn request_with_settings(
    hosts: Vec<ProxyHost>,
    http_settings: ProxyHttpSettings,
) -> ProxyConfigRequest {
    ProxyConfigRequest {
        version: 7,
        revision: revision_for_configuration(&hosts, &http_settings),
        proxy_hosts: hosts,
        redirect_hosts: Vec::new(),
        http_settings,
        trusted_cas: Vec::new(),
        default_site: crate::models::DefaultSite::default(),
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

pub(super) fn trusted_ca_certificate() -> rcgen::Certificate {
    let mut parameters = rcgen::CertificateParams::new(vec!["test-ca.internal".to_owned()])
        .expect("test CA names should be valid");
    parameters.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    parameters.key_usages = vec![rcgen::KeyUsagePurpose::KeyCertSign];
    let key_pair = rcgen::KeyPair::generate().expect("test CA key should generate");
    parameters
        .self_signed(&key_pair)
        .expect("test CA certificate should generate")
}
