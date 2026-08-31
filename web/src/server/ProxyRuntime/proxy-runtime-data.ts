// oxlint-disable-next-line import/no-unassigned-import -- Keeps database snapshot reads behind the server boundary.
import '@tanstack/react-start/server-only'

import { asc, eq } from 'drizzle-orm'

import { proxyHostDomains, proxyHosts } from '../../db/schema'
import type { AuthTransaction } from '../Auth/Core/database.server'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import { readProxyHttpSettings, readProxyHostHttpSettingsMap } from './proxy-runtime-settings'
import type { ProxyRuntimeHost, ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export async function readProxyRuntimeSnapshot(
    transaction: AuthTransaction,
): Promise<ProxyRuntimeSnapshot> {
    const rows = await transaction
        .select({
            id: proxyHosts.id,
            domain: proxyHostDomains.domain,
            forwardScheme: proxyHosts.forwardScheme,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            advancedConfig: proxyHosts.advancedConfig,
            certificateId: proxyHosts.certificateId,
            forceHttps: proxyHosts.forceHttps,
        })
        .from(proxyHosts)
        .leftJoin(proxyHostDomains, eq(proxyHostDomains.proxyHostId, proxyHosts.id))
        .where(eq(proxyHosts.enabled, true))
        .orderBy(asc(proxyHosts.id), asc(proxyHostDomains.domain))
    const hosts = new Map<
        string,
        {
            id: string
            domains: string[]
            forwardScheme: 'http' | 'https'
            forwardHost: string
            forwardPort: number
            advancedConfig: string
            certificateId: string | null
            forceHttps: boolean
            enabled: boolean
        }
    >()

    for (const row of rows) {
        let host = hosts.get(row.id)
        if (!host) {
            host = {
                id: row.id,
                domains: [],
                forwardScheme: row.forwardScheme,
                forwardHost: row.forwardHost,
                forwardPort: row.forwardPort,
                advancedConfig: row.advancedConfig,
                certificateId: row.certificateId,
                forceHttps: row.forceHttps,
                enabled: true,
            }
            hosts.set(row.id, host)
        }
        if (row.domain !== null) host.domains.push(row.domain)
    }

    const httpSettings = await readProxyHttpSettings(transaction)
    const hostSettings = await readProxyHostHttpSettingsMap(transaction, [...hosts.keys()])
    const configuredHosts = [...hosts.values()].map((host) =>
        Object.assign({}, host, {
            httpSettings: hostSettings.get(host.id) ?? {},
        }),
    )
    return createProxyRuntimeSnapshot(configuredHosts, httpSettings)
}

export async function readProxyRuntimeHost(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<(ProxyRuntimeHost & { readonly enabled: boolean }) | null> {
    const rows = await transaction
        .select({
            id: proxyHosts.id,
            domain: proxyHostDomains.domain,
            forwardScheme: proxyHosts.forwardScheme,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            advancedConfig: proxyHosts.advancedConfig,
            certificateId: proxyHosts.certificateId,
            forceHttps: proxyHosts.forceHttps,
            enabled: proxyHosts.enabled,
        })
        .from(proxyHosts)
        .leftJoin(proxyHostDomains, eq(proxyHostDomains.proxyHostId, proxyHosts.id))
        .where(eq(proxyHosts.id, proxyHostId))
        .orderBy(asc(proxyHostDomains.domain))
    const first = rows.at(0)
    if (!first) return null
    return {
        id: first.id,
        domains: rows.flatMap((row) => (row.domain === null ? [] : [row.domain])),
        forwardScheme: first.forwardScheme,
        forwardHost: first.forwardHost,
        forwardPort: first.forwardPort,
        advancedConfig: first.advancedConfig,
        certificateId: first.certificateId,
        forceHttps: first.forceHttps,
        enabled: first.enabled,
    }
}
