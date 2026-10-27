use serde::{Deserialize, Serialize};

/// Closed set of built-in adapters. These capabilities describe implementations,
/// never the permissions granted to a particular credential.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProviderId {
    #[default]
    Cloudflare,
    Desec,
    Hetzner,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub(crate) enum AddressRecordType {
    A,
    #[serde(rename = "AAAA")]
    Aaaa,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProxyOptions {
    None,
    Cloudflare,
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum Operation {
    ZoneDiscovery,
    TxtCreate,
    TxtCleanup,
    AddressUpdate {
        record_type: AddressRecordType,
        proxy_options: ProxyOptions,
    },
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capabilities {
    zone_discovery: bool,
    txt_create: bool,
    txt_cleanup: bool,
    address_record_types: &'static [AddressRecordType],
    proxy_options: ProxyOptions,
}

impl Capabilities {
    fn supports(self, operation: Operation) -> bool {
        match operation {
            Operation::ZoneDiscovery => self.zone_discovery,
            Operation::TxtCreate => self.txt_create,
            Operation::TxtCleanup => self.txt_cleanup,
            Operation::AddressUpdate {
                record_type,
                proxy_options,
            } => {
                self.address_record_types.contains(&record_type)
                    && (proxy_options == ProxyOptions::None || proxy_options == self.proxy_options)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderDescriptor {
    id: ProviderId,
    capabilities: Capabilities,
}

const CLOUDFLARE: ProviderDescriptor = ProviderDescriptor {
    id: ProviderId::Cloudflare,
    capabilities: Capabilities {
        zone_discovery: true,
        txt_create: true,
        txt_cleanup: true,
        address_record_types: &[AddressRecordType::A, AddressRecordType::Aaaa],
        proxy_options: ProxyOptions::Cloudflare,
    },
};

pub(crate) fn catalog() -> &'static [ProviderDescriptor] {
    &[CLOUDFLARE, DESEC, HETZNER]
}

const DESEC: ProviderDescriptor = ProviderDescriptor {
    id: ProviderId::Desec,
    capabilities: Capabilities {
        zone_discovery: true,
        txt_create: true,
        txt_cleanup: true,
        address_record_types: &[AddressRecordType::A, AddressRecordType::Aaaa],
        proxy_options: ProxyOptions::None,
    },
};

const HETZNER: ProviderDescriptor = ProviderDescriptor {
    id: ProviderId::Hetzner,
    capabilities: Capabilities {
        zone_discovery: true,
        txt_create: true,
        txt_cleanup: true,
        address_record_types: &[AddressRecordType::A, AddressRecordType::Aaaa],
        proxy_options: ProxyOptions::None,
    },
};

impl ProviderId {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "cloudflare" => Some(Self::Cloudflare),
            "desec" => Some(Self::Desec),
            "hetzner" => Some(Self::Hetzner),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Cloudflare => "cloudflare",
            Self::Desec => "desec",
            Self::Hetzner => "hetzner",
        }
    }

    pub(crate) fn supports(self, operation: Operation) -> bool {
        match self {
            Self::Cloudflare => CLOUDFLARE.capabilities.supports(operation),
            Self::Desec => DESEC.capabilities.supports(operation),
            Self::Hetzner => HETZNER.capabilities.supports(operation),
        }
    }

    pub(crate) fn valid_zone_id(self, value: &str) -> bool {
        match self {
            Self::Cloudflare => super::validation::is_cloudflare_zone_id(value),
            Self::Desec => super::validation::is_desec_zone_id(value),
            Self::Hetzner => super::validation::is_hetzner_zone_id(value),
        }
    }

    pub(crate) fn valid_address_record_id(self, value: &str) -> bool {
        // Cloudflare address-record selection has always required canonical IDs;
        // the legacy TXT cleanup handle has a separate, less restrictive format.
        super::validation::is_cloudflare_zone_id(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_matches_shared_wire_fixture() {
        let expected: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/dns-provider-catalog.json"
        ))
        .unwrap();
        assert_eq!(serde_json::json!({"providers": catalog()}), expected);
        for id in ["", "Cloudflare", "manual", "cloudflare ", "other"] {
            assert_eq!(ProviderId::parse(id), None);
            assert!(serde_json::from_value::<ProviderId>(serde_json::json!(id)).is_err());
        }
    }

    #[test]
    fn unsupported_operations_and_proxy_options_fail_closed() {
        let unsupported = Capabilities {
            zone_discovery: false,
            txt_create: false,
            txt_cleanup: false,
            address_record_types: &[AddressRecordType::A],
            proxy_options: ProxyOptions::None,
        };
        for operation in [
            Operation::ZoneDiscovery,
            Operation::TxtCreate,
            Operation::TxtCleanup,
            Operation::AddressUpdate {
                record_type: AddressRecordType::Aaaa,
                proxy_options: ProxyOptions::None,
            },
            Operation::AddressUpdate {
                record_type: AddressRecordType::A,
                proxy_options: ProxyOptions::Cloudflare,
            },
        ] {
            assert!(!unsupported.supports(operation));
        }
        assert!(unsupported.supports(Operation::AddressUpdate {
            record_type: AddressRecordType::A,
            proxy_options: ProxyOptions::None
        }));
    }
}
