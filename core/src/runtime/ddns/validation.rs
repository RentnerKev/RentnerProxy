use super::models::{Error, Request, Selection};
use crate::proxy::{is_canonical_domain, is_canonical_uuid_v7};
use std::{collections::BTreeSet, net::IpAddr};

pub(super) fn provider_id(id: &str) -> bool {
    crate::runtime::dns::capabilities::ProviderId::Cloudflare.valid_address_record_id(id)
}
pub(super) fn name(name: &str) -> bool {
    name.len() <= 253 && is_canonical_domain(name.strip_prefix("*.").unwrap_or(name))
}
pub(super) fn in_zone(name: &str, zone: &str) -> bool {
    let name = name.strip_prefix("*.").unwrap_or(name);
    name == zone
        || name
            .strip_suffix(zone)
            .is_some_and(|prefix| prefix.ends_with('.'))
}
pub(super) fn request(request: &Request) -> Result<(), Error> {
    if !is_canonical_uuid_v7(&request.actor_user_id)
        || request.targets.is_empty()
        || request.targets.len() > 100
    {
        return Err(Error::InvalidInput);
    }
    let mut ids = BTreeSet::new();
    let mut records = BTreeSet::new();
    for target in &request.targets {
        if !is_canonical_uuid_v7(&target.id)
            || !is_canonical_uuid_v7(&target.connection_id)
            || !(provider_id(&target.zone_id)
                || crate::runtime::dns::capabilities::ProviderId::Desec
                    .valid_zone_id(&target.zone_id))
            || !name(&target.name)
            || !ids.insert(&target.id)
            || !records.insert((&target.zone_id, &target.name, target.record_type))
            || matches!(&target.selection, Selection::Adopt { record_id } if !provider_id(record_id))
        {
            return Err(Error::InvalidInput);
        }
    }
    Ok(())
}

// Deliberately conservative public-unicast policy; reserved/documentation/transition
// ranges cannot become DNS targets after a bad discovery response.
pub(super) fn public(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && b == 0 && c == 0)
                && !(a == 192 && b == 88 && c == 99)
                && !(a == 198 && matches!(b, 18 | 19))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Native global unicast only; exclude IETF protocol assignments,
            // documentation, 6to4, and the former 6bone allocation.
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && s[1] < 0x200)
                && !(s[0] == 0x2001 && s[1] == 0xdb8)
                && s[0] != 0x2002
                && s[0] != 0x3ffe
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}
