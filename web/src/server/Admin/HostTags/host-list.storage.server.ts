import '@tanstack/react-start/server-only'
import { asc, eq } from 'drizzle-orm'

import { hostDomains, proxyHosts, redirectHosts } from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type {
    ProxyHostListEntry,
    RedirectHostListEntry,
} from '@/lib/HostTags/Types/host-tags.types.ts'

function groupDomains<T extends { readonly id: string; readonly domain: string | null }>(
    rows: T[],
) {
    const hosts = new Map<string, Omit<T, 'domain'> & { domains: string[] }>()
    for (const row of rows) {
        const previous = hosts.get(row.id)
        if (previous) {
            if (row.domain) previous.domains.push(row.domain)
        } else {
            const { domain, ...host } = row
            hosts.set(row.id, { ...host, domains: domain ? [domain] : [] })
        }
    }
    return [...hosts.values()].map((host) =>
        Object.assign(host, { domains: host.domains.toSorted() }),
    )
}

/**
 * Reads the lightweight search/sort basis and global domain facets in one snapshot.
 * Complete pool members are included for secondary-target filtering before page
 * selection, while jobs and discovery metadata are deferred to summary hydration.
 */
export async function readProxyHostListBasis(
    transaction: AuthTransaction,
): Promise<ProxyHostListEntry[]> {
    return groupDomains(
        await transaction
            .select({
                id: proxyHosts.id,
                enabled: proxyHosts.enabled,
                createdAt: proxyHosts.createdAt,
                certificateId: proxyHosts.certificateId,
                forwardHost: proxyHosts.forwardHost,
                forwardScheme: proxyHosts.forwardScheme,
                forwardPort: proxyHosts.forwardPort,
                upstreamPool: proxyHosts.upstreamPool,
                domain: hostDomains.domain,
            })
            .from(proxyHosts)
            .leftJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
            .orderBy(asc(proxyHosts.id), asc(hostDomains.domain)),
    )
}

export async function readRedirectHostListBasis(
    transaction: AuthTransaction,
): Promise<RedirectHostListEntry[]> {
    return groupDomains(
        await transaction
            .select({
                id: redirectHosts.id,
                enabled: redirectHosts.enabled,
                createdAt: redirectHosts.createdAt,
                certificateId: redirectHosts.certificateId,
                destination: redirectHosts.destination,
                statusCode: redirectHosts.statusCode,
                domain: hostDomains.domain,
            })
            .from(redirectHosts)
            .leftJoin(hostDomains, eq(hostDomains.redirectHostId, redirectHosts.id))
            .orderBy(asc(redirectHosts.id), asc(hostDomains.domain)),
    )
}
