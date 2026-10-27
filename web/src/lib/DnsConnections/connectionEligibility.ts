import type { DnsConnectionChoice } from './Types/dns-connections.types.ts'
import type { DnsZone } from './Types/dns-connections.types.ts'
import type { DnsProviderDescriptor } from './Types/dns-provider.types.ts'
import { dnsProviderForId, supportsDdns, supportsDns01 } from './dnsProviders.ts'

export function verifiedConnectionZones(connection: DnsConnectionChoice) {
    if (connection.verification?.status !== 'connected') return []
    return connection.zones.filter((zone) => connection.verification?.zoneIds.includes(zone.id))
}

export function zoneCoversDomains(zone: DnsZone, domains: readonly string[]) {
    const names = domains
        .map((domain) => domain.trim().toLowerCase().replace(/^\*\./u, '').replace(/\.$/u, ''))
        .filter(Boolean)
    return (
        names.length > 0 &&
        names.every((name) => name === zone.name || name.endsWith(`.${zone.name}`))
    )
}

export function connectionSupportsOperation(
    connection: DnsConnectionChoice,
    providers: readonly DnsProviderDescriptor[],
    operation: 'dns01' | 'A' | 'AAAA' | 'both',
) {
    const provider = dnsProviderForId(providers, connection.provider)
    if (!verifiedConnectionZones(connection).length) return false
    if (operation === 'dns01') return supportsDns01(provider)
    return operation === 'both'
        ? supportsDdns(provider, 'A') && supportsDdns(provider, 'AAAA')
        : supportsDdns(provider, operation)
}

/** Delegated challenges target a verified zone independently of certificate SANs. */
export function certificateConnectionZones(
    connection: DnsConnectionChoice,
    domains: readonly string[],
    dnsMode: string | undefined,
) {
    return verifiedConnectionZones(connection).filter(
        (zone) => dnsMode === 'delegated' || zoneCoversDomains(zone, domains),
    )
}
