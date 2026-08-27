use std::{env, net::SocketAddr};

pub const LISTEN_ADDR_ENV: &str = "RENTNERPROXY_CONTROLLER_LISTEN_ADDR";
pub const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:8081";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub listen_addr: SocketAddr,
}

#[derive(Debug)]
pub enum ConfigError {
    InvalidListenAddr {
        variable: &'static str,
        value: String,
        source: std::net::AddrParseError,
    },
    InvalidListenAddrEncoding {
        variable: &'static str,
    },
    NonLoopbackListenAddr {
        variable: &'static str,
        value: String,
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
            Self::NonLoopbackListenAddr { variable, value } => write!(
                formatter,
                "invalid {variable} value {value:?}: the controller must listen on a loopback address",
            ),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidListenAddr { source, .. } => Some(source),
            Self::InvalidListenAddrEncoding { .. } | Self::NonLoopbackListenAddr { .. } => None,
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let value = match env::var(LISTEN_ADDR_ENV) {
            Ok(value) => value,
            Err(env::VarError::NotPresent) => DEFAULT_LISTEN_ADDR.to_owned(),
            Err(env::VarError::NotUnicode(_)) => {
                return Err(ConfigError::InvalidListenAddrEncoding {
                    variable: LISTEN_ADDR_ENV,
                });
            }
        };
        Self::from_optional_listen_addr(Some(&value))
    }

    pub fn from_optional_listen_addr(value: Option<&str>) -> Result<Self, ConfigError> {
        let raw = match value {
            Some(value) => value,
            None => DEFAULT_LISTEN_ADDR,
        };
        let listen_addr: SocketAddr =
            raw.parse()
                .map_err(|source| ConfigError::InvalidListenAddr {
                    variable: LISTEN_ADDR_ENV,
                    value: raw.to_owned(),
                    source,
                })?;

        if !listen_addr.ip().is_loopback() {
            return Err(ConfigError::NonLoopbackListenAddr {
                variable: LISTEN_ADDR_ENV,
                value: raw.to_owned(),
            });
        }

        Ok(Self { listen_addr })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_loopback_controller_port() {
        let config = Config::from_optional_listen_addr(None);
        let config = match config {
            Ok(config) => config,
            Err(error) => panic!("default address should parse: {error}"),
        };
        assert_eq!(config.listen_addr, SocketAddr::from(([127, 0, 0, 1], 8081)));
    }

    #[test]
    fn parses_configured_address() {
        let config = Config::from_optional_listen_addr(Some("127.0.0.1:9090"));
        let config = match config {
            Ok(config) => config,
            Err(error) => panic!("configured address should parse: {error}"),
        };
        assert_eq!(config.listen_addr, SocketAddr::from(([127, 0, 0, 1], 9090)));
    }

    #[test]
    fn rejects_invalid_address_with_variable_name_and_value() {
        let error = Config::from_optional_listen_addr(Some("not-an-address"));
        let message = match error {
            Ok(_) => String::new(),
            Err(error) => error.to_string(),
        };
        assert!(message.contains(LISTEN_ADDR_ENV));
        assert!(message.contains("not-an-address"));
    }

    #[test]
    fn rejects_non_loopback_addresses() {
        for address in ["0.0.0.0:8081", "[::]:8081", "192.168.1.10:8081"] {
            let error = Config::from_optional_listen_addr(Some(address));
            let message = match error {
                Ok(_) => String::new(),
                Err(error) => error.to_string(),
            };
            assert!(message.contains(LISTEN_ADDR_ENV));
            assert!(message.contains(address));
            assert!(message.contains("loopback"));
        }
    }
}
