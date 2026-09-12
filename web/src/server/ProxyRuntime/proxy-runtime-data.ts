// oxlint-disable-next-line import/no-unassigned-import -- Keeps database snapshot reads behind the server boundary.
import '@tanstack/react-start/server-only'

import { asc, eq, inArray } from 'drizzle-orm'

import {
    accessPolicyBasicAuthAccounts,
    accessPolicies,
    hostDomains,
    proxyHosts,
    redirectHosts,
    trustedCas,
} from '../../db/schema'
import type { AuthTransaction } from '../Auth/Core/database.server'
import { createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import { readProxyHttpSettings, readProxyHostHttpSettingsMap } from './proxy-runtime-settings'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
    ProxyRuntimeTrustedCa,
    RedirectRuntimeHost,
} from './Types/proxy-runtime.types'

async function readBasicAuthAccounts(
    transaction: AuthTransaction,
    policyIds: ReadonlyArray<string>,
): Promise<Map<string, Array<{ readonly username: string; readonly passwordHash: string }>>> {
    if (policyIds.length === 0) return new Map()
    const rows = await transaction
        .select({
            policyId: accessPolicyBasicAuthAccounts.policyId,
            username: accessPolicyBasicAuthAccounts.username,
            passwordHash: accessPolicyBasicAuthAccounts.passwordHash,
        })
        .from(accessPolicyBasicAuthAccounts)
        .where(inArray(accessPolicyBasicAuthAccounts.policyId, policyIds))
        .orderBy(
            asc(accessPolicyBasicAuthAccounts.policyId),
            asc(accessPolicyBasicAuthAccounts.username),
        )
    const accounts = new Map<
        string,
        Array<{ readonly username: string; readonly passwordHash: string }>
    >()
    for (const row of rows) {
        const existing = accounts.get(row.policyId)
        if (existing) existing.push({ username: row.username, passwordHash: row.passwordHash })
        else
            accounts.set(row.policyId, [{ username: row.username, passwordHash: row.passwordHash }])
    }
    return accounts
}

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
            domain: hostDomains.domain,
            forwardScheme: proxyHosts.forwardScheme,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            certificateId: proxyHosts.certificateId,
            forceHttps: proxyHosts.forceHttps,
            verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
            upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
            trustedCaId: proxyHosts.trustedCaId,
            accessPolicyId: proxyHosts.accessPolicyId,
            accessPolicyMode: accessPolicies.mode,
            accessPolicyCombination: accessPolicies.combination,
        })
        .from(proxyHosts)
        .leftJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
        .leftJoin(accessPolicies, eq(accessPolicies.id, proxyHosts.accessPolicyId))
        .where(eq(proxyHosts.enabled, true))
        .orderBy(asc(proxyHosts.id), asc(hostDomains.domain))
    const hosts = new Map<
        string,
        ProxyRuntimeHost & { domains: string[]; readonly enabled: boolean }
    >()
    const policyIds = [
        ...new Set(
            rows.flatMap((row) => (row.accessPolicyId === null ? [] : [row.accessPolicyId])),
        ),
    ]
    const basicAuthAccounts = await readBasicAuthAccounts(transaction, policyIds)

    for (const row of rows) {
        let host = hosts.get(row.id)
        if (!host) {
            const accounts =
                row.accessPolicyId === null ? [] : (basicAuthAccounts.get(row.accessPolicyId) ?? [])
            host = {
                id: row.id,
                domains: [],
                forwardScheme: row.forwardScheme,
                forwardHost: row.forwardHost,
                forwardPort: row.forwardPort,
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
                ...(row.accessPolicyId === null
                    ? {}
                    : row.accessPolicyMode === null
                      ? (() => {
                            throw new Error('Referenced access policy is missing.')
                        })()
                      : {
                            accessPolicy: {
                                id: row.accessPolicyId,
                                mode: row.accessPolicyMode,
                                combination: row.accessPolicyCombination,
                                ...((row.accessPolicyMode === 'authenticated' ||
                                    row.accessPolicyMode === 'combined') &&
                                accounts.length > 0
                                    ? { basicAuth: { accounts } }
                                    : {}),
                            },
                        }),
            }
            hosts.set(row.id, host)
        }
        if (!host) continue
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
    const redirectRows = await transaction
        .select({
            id: redirectHosts.id,
            domain: hostDomains.domain,
            destination: redirectHosts.destination,
            statusCode: redirectHosts.statusCode,
            preserveRequestUri: redirectHosts.preserveRequestUri,
            certificateId: redirectHosts.certificateId,
        })
        .from(redirectHosts)
        .leftJoin(hostDomains, eq(hostDomains.redirectHostId, redirectHosts.id))
        .where(eq(redirectHosts.enabled, true))
        .orderBy(asc(redirectHosts.id), asc(hostDomains.domain))
    const redirects = new Map<
        string,
        RedirectRuntimeHost & { domains: string[]; readonly enabled: boolean }
    >()
    for (const row of redirectRows) {
        let redirect = redirects.get(row.id)
        if (!redirect) {
            redirect = {
                id: row.id,
                domains: [],
                destination: row.destination,
                statusCode: row.statusCode,
                preserveRequestUri: row.preserveRequestUri,
                certificateId: row.certificateId,
                enabled: true,
            }
            redirects.set(row.id, redirect)
        }
        if (row.domain !== null) redirect.domains.push(row.domain)
    }
    return createProxyRuntimeSnapshot(configuredHosts, httpSettings, referencedCas, [
        ...redirects.values(),
    ])
}

export async function readProxyRuntimeHost(
    transaction: AuthTransaction,
    proxyHostId: string,
): Promise<(ProxyRuntimeHost & { readonly enabled: boolean }) | null> {
    const rows = await transaction
        .select({
            id: proxyHosts.id,
            domain: hostDomains.domain,
            forwardScheme: proxyHosts.forwardScheme,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
            certificateId: proxyHosts.certificateId,
            forceHttps: proxyHosts.forceHttps,
            verifyUpstreamTls: proxyHosts.verifyUpstreamTls,
            upstreamTlsServerName: proxyHosts.upstreamTlsServerName,
            trustedCaId: proxyHosts.trustedCaId,
            accessPolicyId: proxyHosts.accessPolicyId,
            accessPolicyMode: accessPolicies.mode,
            accessPolicyCombination: accessPolicies.combination,
            enabled: proxyHosts.enabled,
        })
        .from(proxyHosts)
        .leftJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
        .leftJoin(accessPolicies, eq(accessPolicies.id, proxyHosts.accessPolicyId))
        .where(eq(proxyHosts.id, proxyHostId))
        .orderBy(asc(hostDomains.domain))
    const first = rows.at(0)
    if (!first) return null
    if (first.accessPolicyId !== null && first.accessPolicyMode === null) {
        throw new Error('Referenced access policy is missing.')
    }
    const basicAuthAccounts = await readBasicAuthAccounts(
        transaction,
        first.accessPolicyId === null ? [] : [first.accessPolicyId],
    )
    const accounts =
        first.accessPolicyId === null ? [] : (basicAuthAccounts.get(first.accessPolicyId) ?? [])
    return {
        id: first.id,
        domains: rows.flatMap((row) => (row.domain === null ? [] : [row.domain])),
        forwardScheme: first.forwardScheme,
        forwardHost: first.forwardHost,
        forwardPort: first.forwardPort,
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
        ...(first.accessPolicyId === null
            ? {}
            : {
                  accessPolicy: {
                      id: first.accessPolicyId,
                      mode: first.accessPolicyMode!,
                      combination: first.accessPolicyCombination,
                      ...((first.accessPolicyMode === 'authenticated' ||
                          first.accessPolicyMode === 'combined') &&
                      accounts.length > 0
                          ? { basicAuth: { accounts } }
                          : {}),
                  },
              }),
    }
}
