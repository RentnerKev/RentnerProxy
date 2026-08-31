// oxlint-disable-next-line import/no-unassigned-import -- Keeps database snapshot reads behind the server boundary.
import '@tanstack/react-start/server-only'

import { asc, eq, inArray } from 'drizzle-orm'

import { proxyHostDomains, proxyHosts, trustedCas } from '../../db/schema'
import type { AuthTransaction } from '../Auth/Core/database.server'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import { readProxyHttpSettings, readProxyHostHttpSettingsMap } from './proxy-runtime-settings'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
    ProxyRuntimeTrustedCa,
    ProxyRuntimeUpstreamTls,
} from './Types/proxy-runtime.types'

export async function readProxyRuntimeTrustedCas(
    transaction: AuthTransaction,
    hosts: ReadonlyArray<ProxyRuntimeHost>,
): Promise<ProxyRuntimeTrustedCa[]> {
    const ids = [
        ...new Set(
            hosts.flatMap((host) =>
                host.forwardScheme === 'https' && host.upstreamTls?.trustedCaId
                    ? [host.upstreamTls.trustedCaId]
                    : [],
            ),
        ),
    ]
    if (ids.length === 0) return []
    return transaction
        .select({
            id: trustedCas.id,
            pem: trustedCas.pem,
            fingerprintSha256: trustedCas.fingerprintSha256,
        })
        .from(trustedCas)
        .where(inArray(trustedCas.id, ids))
        .orderBy(asc(trustedCas.id))
}

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
            verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
            upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
            trustedCaId: proxyHosts.trustedCaId,
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
            upstreamTls?: ProxyRuntimeUpstreamTls
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
                ...(row.forwardScheme === 'https'
                    ? {
                          upstreamTls: {
                              verify: row.verifyUpstreamTls,
                              serverName: row.upstreamTlsServerName,
                              trustedCaId: row.trustedCaId,
                          },
                      }
                    : {}),
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
    const referencedCas = await readProxyRuntimeTrustedCas(transaction, configuredHosts)
    return createProxyRuntimeSnapshot(configuredHosts, httpSettings, referencedCas)
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
            verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
            upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
            trustedCaId: proxyHosts.trustedCaId,
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
        ...(first.forwardScheme === 'https'
            ? {
                  upstreamTls: {
                      verify: first.verifyUpstreamTls,
                      serverName: first.upstreamTlsServerName,
                      trustedCaId: first.trustedCaId,
                  },
              }
            : {}),
        enabled: first.enabled,
    }
}
