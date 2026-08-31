use std::{env, net::SocketAddr, path::PathBuf};

const LISTEN_ADDR_ENV: &str = "RENTNERPROXY_CONTROLLER_LISTEN_ADDR";
pub(crate) const CONTROLLER_TOKEN_ENV: &str = "RENTNERPROXY_CONTROLLER_TOKEN";
const PROXY_ENGINE_BIN_ENV: &str = "RENTNERPROXY_PROXY_ENGINE_BIN";
const PROXY_STATE_DIR_ENV: &str = "RENTNERPROXY_PROXY_STATE_DIR";
const PROXY_HTTP_PORT_ENV: &str = "RENTNERPROXY_PROXY_HTTP_PORT";
const PROXY_HTTPS_PORT_ENV: &str = "RENTNERPROXY_PROXY_HTTPS_PORT";
const PROXY_PUBLIC_HTTPS_PORT_ENV: &str = "RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT";
const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:8081";
const DEFAULT_PROXY_HTTP_PORT: u16 = 8_080;
const DEFAULT_PROXY_HTTPS_PORT: u16 = 8_443;
const DEFAULT_PROXY_PUBLIC_HTTPS_PORT: u16 = 443;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ControllerToken(String);

impl ControllerToken {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ControllerToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ControllerToken(REDACTED)")
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Config {
    pub(crate) listen_addr: SocketAddr,
    pub(crate) controller_token: Option<ControllerToken>,
    pub(crate) proxy_engine_bin: Option<PathBuf>,
    pub(crate) proxy_state_dir: PathBuf,
    pub(crate) proxy_http_port: u16,
    pub(crate) proxy_https_port: u16,
    pub(crate) proxy_public_https_port: u16,
}

#[derive(Debug)]
pub(crate) enum ConfigError {
    InvalidListenAddr {
        variable: &'static str,
        value: String,
        source: std::net::AddrParseError,
    },
    InvalidListenAddrEncoding {
        variable: &'static str,
    },
    InvalidControllerToken {
        variable: &'static str,
    },
    MissingControllerToken {
        variable: &'static str,
    },
    InvalidProxyHttpPort {
        variable: &'static str,
    },
    InvalidProxyStateDir {
        variable: &'static str,
    },
    MissingProxyStateDir {
        variable: &'static str,
    },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidListenAddr {
                variable,
                value,
                source,
            } => write!(formatter, "invalid {variable} value {value:?}: {source}"),
            Self::InvalidListenAddrEncoding { variable } => {
                write!(formatter, "invalid non-Unicode value for {variable}")
            }
            Self::InvalidControllerToken { variable } => write!(
                formatter,
                "invalid {variable}: expected a trimmed 32 to 256 character base64url or hexadecimal token",
            ),
            Self::MissingControllerToken { variable } => {
                write!(
                    formatter,
                    "missing required {variable} for a non-loopback controller"
                )
            }
            Self::InvalidProxyHttpPort { variable } => {
                write!(
                    formatter,
                    "invalid {variable}: expected an integer from 1 through 65535"
                )
            }
            Self::InvalidProxyStateDir { variable } => {
                write!(
                    formatter,
                    "invalid {variable}: expected an absolute directory path"
                )
            }
            Self::MissingProxyStateDir { variable } => write!(
                formatter,
                "missing required {variable} for a release controller; use a persistent absolute directory",
            ),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidListenAddr { source, .. } => Some(source),
            Self::InvalidListenAddrEncoding { .. }
            | Self::InvalidControllerToken { .. }
            | Self::MissingControllerToken { .. }
            | Self::InvalidProxyHttpPort { .. }
            | Self::InvalidProxyStateDir { .. }
            | Self::MissingProxyStateDir { .. } => None,
        }
    }
}

impl Config {
    pub(crate) fn from_env() -> Result<Self, ConfigError> {
        let listen_addr =
            read_env(LISTEN_ADDR_ENV)?.unwrap_or_else(|| DEFAULT_LISTEN_ADDR.to_owned());
        let controller_token =
            read_env(CONTROLLER_TOKEN_ENV)?.filter(|value| !value.trim().is_empty());
        let proxy_engine_bin = read_env(PROXY_ENGINE_BIN_ENV)?
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);
        let proxy_state_dir = read_env(PROXY_STATE_DIR_ENV)?.and_then(|value| {
            let value = value.trim();
            (!value.is_empty()).then(|| PathBuf::from(value))
        });
        let proxy_http_port = read_env(PROXY_HTTP_PORT_ENV)?;
        let proxy_https_port = read_env(PROXY_HTTPS_PORT_ENV)?;
        let proxy_public_https_port = read_env(PROXY_PUBLIC_HTTPS_PORT_ENV)?;
        let require_state_dir = cfg!(not(debug_assertions)) && proxy_engine_bin.is_some();

        let mut config = Self::from_values(
            Some(&listen_addr),
            controller_token.as_deref(),
            proxy_engine_bin,
            proxy_state_dir,
            proxy_http_port.as_deref(),
            require_state_dir,
        )?;
        config.proxy_https_port = parse_proxy_port(
            proxy_https_port.as_deref(),
            PROXY_HTTPS_PORT_ENV,
            DEFAULT_PROXY_HTTPS_PORT,
        )?;
        config.proxy_public_https_port = parse_proxy_port(
            proxy_public_https_port.as_deref(),
            PROXY_PUBLIC_HTTPS_PORT_ENV,
            DEFAULT_PROXY_PUBLIC_HTTPS_PORT,
        )?;
        Ok(config)
    }

    pub(crate) fn from_values(
        listen_addr: Option<&str>,
        controller_token: Option<&str>,
        proxy_engine_bin: Option<PathBuf>,
        proxy_state_dir: Option<PathBuf>,
        proxy_http_port: Option<&str>,
        require_state_dir: bool,
    ) -> Result<Self, ConfigError> {
        let raw_listen_addr = listen_addr.unwrap_or(DEFAULT_LISTEN_ADDR);
        let listen_addr: SocketAddr =
            raw_listen_addr
                .parse()
                .map_err(|source| ConfigError::InvalidListenAddr {
                    variable: LISTEN_ADDR_ENV,
                    value: raw_listen_addr.to_owned(),
                    source,
                })?;
        let controller_token = controller_token.map(parse_controller_token).transpose()?;
        if !listen_addr.ip().is_loopback() && controller_token.is_none() {
            return Err(ConfigError::MissingControllerToken {
                variable: CONTROLLER_TOKEN_ENV,
            });
        }

        let proxy_http_port = proxy_http_port
            .map(|value| {
                value.parse::<u16>().ok().filter(|port| *port != 0).ok_or(
                    ConfigError::InvalidProxyHttpPort {
                        variable: PROXY_HTTP_PORT_ENV,
                    },
                )
            })
            .transpose()?
            .unwrap_or(DEFAULT_PROXY_HTTP_PORT);

        let proxy_state_dir = match proxy_state_dir {
            Some(path) if path.is_absolute() => path,
            Some(_) => {
                return Err(ConfigError::InvalidProxyStateDir {
                    variable: PROXY_STATE_DIR_ENV,
                });
            }
            None if require_state_dir => {
                return Err(ConfigError::MissingProxyStateDir {
                    variable: PROXY_STATE_DIR_ENV,
                });
            }
            None => env::temp_dir().join("rentnerproxy-controller"),
        };

        Ok(Self {
            listen_addr,
            controller_token,
            proxy_engine_bin,
            proxy_state_dir,
            proxy_http_port,
            proxy_https_port: DEFAULT_PROXY_HTTPS_PORT,
            proxy_public_https_port: DEFAULT_PROXY_PUBLIC_HTTPS_PORT,
        })
    }
}

fn parse_proxy_port(
    value: Option<&str>,
    variable: &'static str,
    default: u16,
) -> Result<u16, ConfigError> {
    value
        .map(|value| {
            value
                .parse::<u16>()
                .ok()
                .filter(|port| *port != 0)
                .ok_or(ConfigError::InvalidProxyHttpPort { variable })
        })
        .transpose()?
        .map_or(Ok(default), Ok)
}

fn read_env(variable: &'static str) -> Result<Option<String>, ConfigError> {
    match env::var(variable) {
        Ok(value) => Ok(Some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(env::VarError::NotUnicode(_)) if variable == LISTEN_ADDR_ENV => {
            Err(ConfigError::InvalidListenAddrEncoding { variable })
        }
        Err(env::VarError::NotUnicode(_)) => Err(ConfigError::InvalidControllerToken { variable }),
    }
}

fn parse_controller_token(value: &str) -> Result<ControllerToken, ConfigError> {
    let value = value.trim();
    let valid = (32..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    if !valid {
        return Err(ConfigError::InvalidControllerToken {
            variable: CONTROLLER_TOKEN_ENV,
        });
    }
    Ok(ControllerToken(value.to_owned()))
}
