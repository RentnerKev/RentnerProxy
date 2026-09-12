// oxlint-disable-next-line import/no-unassigned-import -- Keeps runtime hashing behind the server boundary.
import '@tanstack/react-start/server-only'

import { z } from 'zod'
import {
    ACCESS_POLICY_COMBINATIONS,
    ACCESS_POLICY_MODES,
    MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY,
    MAX_ACCESS_POLICY_IP_RULES,
} from '../../config/access-policies.config'
import {
    ACCESS_POLICY_IP_RULE_ACTIONS,
    canonicalIpNetwork,
} from '../../shared/Helpers/ipAccessRules'

import {
    normalizeProxyHttpSettings,
    proxyHostHttpSettingsSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'

import {
    proxyForwardHostSchema,
    proxyForwardPortSchema,
    proxyHostDomainsSchema,
    proxyUpstreamTlsServerNameSchema,
} from '../../features/Admin/ProxyHostManagement/validation'
import {
    normalizeRedirectDestination,
    redirectStatusCodeSchema,
} from '../../features/Admin/RedirectHostManagement/validation'
import type {
    ProxyHttpSettings,
    ProxyRuntimeStatus,
    ProxyRuntimeSyncStatus,
} from '../../shared/Types/proxy-runtime.types'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
    ProxyRuntimeTrustedCa,
    RedirectRuntimeHost,
} from './Types/proxy-runtime.types'
import { createTrustedCaInputSchema } from '../../features/Admin/TrustedCaManagement/validation'

export const MAX_RUNTIME_PROXY_HOSTS = 1_000
export const MAX_RUNTIME_DOMAINS = 50_000
export const MAX_RUNTIME_PAYLOAD_BYTES = 16 * 1_024 * 1_024
export const PROXY_RUNTIME_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u

const runtimeUpstreamTlsSchema = z.strictObject({
    verify: z.boolean(),
    serverName: proxyUpstreamTlsServerNameSchema.nullable().default(null),
    trustedCaId: z.uuidv7().nullable().default(null),
})
function isCanonicalBasicAuthHash(value: string): boolean {
    const match =
        /^\$argon2id\$v=19\$m=47104,t=1,p=1\$([A-Za-z0-9+/]{43})\$([A-Za-z0-9+/]{43})$/u.exec(value)
    if (!match) return false
    return [match[1]!, match[2]!].every((part) => {
        const decoded = Buffer.from(part, 'base64')
        return decoded.byteLength === 32 && decoded.toString('base64').replace(/=+$/u, '') === part
    })
}
const runtimeIpNetworkSchema = z.string().superRefine((value, context) => {
    if (canonicalIpNetwork(value) !== value) {
        context.addIssue({ code: 'custom', message: 'IP rules must use canonical networks.' })
    }
})
const runtimeIpRulesSchema = z
    .strictObject({
        defaultAction: z.enum(ACCESS_POLICY_IP_RULE_ACTIONS),
        allow: z.array(runtimeIpNetworkSchema).max(MAX_ACCESS_POLICY_IP_RULES),
        deny: z.array(runtimeIpNetworkSchema).max(MAX_ACCESS_POLICY_IP_RULES),
    })
    .superRefine((rules, context) => {
        for (const field of ['allow', 'deny'] as const) {
            if (new Set(rules[field]).size !== rules[field].length) {
                context.addIssue({
                    code: 'custom',
                    path: [field],
                    message: 'IP rules cannot contain duplicate networks.',
                })
            }
        }
    })
const runtimeTrustedCaSchema = z.strictObject({
    id: z.uuidv7(),
    pem: createTrustedCaInputSchema.shape.pem,
    fingerprintSha256: z.string().regex(PROXY_RUNTIME_REVISION_PATTERN),
})
const runtimeAccessPolicySchema = z
    .strictObject({
        id: z.uuidv7().transform((id) => id.toLowerCase()),
        mode: z.enum(ACCESS_POLICY_MODES),
        combination: z.enum(ACCESS_POLICY_COMBINATIONS).nullable(),
        basicAuth: z
            .strictObject({
                accounts: z
                    .array(
                        z.strictObject({
                            username: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/u),
                            passwordHash: z.string().refine(isCanonicalBasicAuthHash),
                        }),
                    )
                    .min(1)
                    .max(MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY),
            })
            .optional(),
        ipRules: runtimeIpRulesSchema.optional(),
    })
    .superRefine((policy, context) => {
        if ((policy.mode === 'combined') !== (policy.combination !== null)) {
            context.addIssue({ code: 'custom', message: 'Invalid access policy combination.' })
        }
        if (policy.basicAuth !== undefined) {
            const usernames = new Set<string>()
            for (const [index, account] of policy.basicAuth.accounts.entries()) {
                if (usernames.has(account.username)) {
                    context.addIssue({
                        code: 'custom',
                        path: ['basicAuth', 'accounts', index, 'username'],
                        message: 'Duplicate Basic Auth username.',
                    })
                }
                usernames.add(account.username)
            }
        }
    })

const runtimeHostSchema = z
    .strictObject({
        id: z.uuid(),
        domains: proxyHostDomainsSchema,
        enabled: z.boolean().default(true),
        forwardScheme: z.enum(['http', 'https']),
        forwardHost: proxyForwardHostSchema,
        forwardPort: proxyForwardPortSchema,
        httpSettings: proxyHostHttpSettingsSchema.optional(),
        certificateId: z.uuidv7().nullish(),
        forceHttps: z.boolean().default(false),
        upstreamTls: runtimeUpstreamTlsSchema.optional(),
        accessPolicy: runtimeAccessPolicySchema.optional(),
    })
    .refine(
        (host) => !host.forceHttps || !!host.certificateId,
        'Force HTTPS requires a certificate.',
    )
    .superRefine((host, context) => {
        if (host.forwardScheme === 'http') {
            if (host.upstreamTls !== undefined)
                context.addIssue({
                    code: 'custom',
                    message: 'HTTP hosts cannot contain upstream TLS settings.',
                })
            return
        }
        const tls = host.upstreamTls ?? { verify: true, serverName: null, trustedCaId: null }
        if (!tls.verify && tls.trustedCaId !== null)
            context.addIssue({
                code: 'custom',
                message: 'Custom trust requires certificate verification.',
            })
        if (
            tls.verify &&
            tls.serverName === null &&
            (z.ipv4().safeParse(host.forwardHost).success ||
                z.ipv6().safeParse(host.forwardHost).success)
        )
            context.addIssue({
                code: 'custom',
                message: 'Verified IP upstreams require a DNS TLS server name.',
            })
    })

const runtimeRedirectHostSchema = z.object({
    id: z.uuid(),
    domains: proxyHostDomainsSchema,
    destination: z.string(),
    statusCode: redirectStatusCodeSchema,
    preserveRequestUri: z.boolean(),
    certificateId: z.uuidv7().nullish(),
})

function compareAscii(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

// Property order and omission of empty host settings preserve the Rust hash contract.
export function createProxyRuntimeSnapshot(
    hosts: ReadonlyArray<ProxyRuntimeHost & { readonly enabled: boolean }>,
    httpSettings: ProxyHttpSettings = {},
    trustedCas: ReadonlyArray<ProxyRuntimeTrustedCa> = [],
    redirects: ReadonlyArray<RedirectRuntimeHost & { readonly enabled: boolean }> = [],
): ProxyRuntimeSnapshot {
    const enabledHosts = hosts.filter((host) => host.enabled)
    const enabledRedirects = redirects.filter((host) => host.enabled)

    if (enabledHosts.length + enabledRedirects.length > MAX_RUNTIME_PROXY_HOSTS) {
        throw new Error('Proxy runtime host limit exceeded.')
    }

    const ids = new Set<string>()
    const domains = new Set<string>()
    const accessPolicies = new Map<string, string>()
    let totalDomains = 0
    const proxyHosts = enabledHosts
        .map((input): ProxyRuntimeHost => {
            const host = runtimeHostSchema.parse(input)
            const id = host.id.toLowerCase()

            let normalizedAccessPolicy = host.accessPolicy
                ? runtimeAccessPolicySchema.parse(host.accessPolicy)
                : undefined
            if (normalizedAccessPolicy?.basicAuth) {
                normalizedAccessPolicy = {
                    ...normalizedAccessPolicy,
                    basicAuth: {
                        accounts: normalizedAccessPolicy.basicAuth.accounts.toSorted(
                            (left, right) => compareAscii(left.username, right.username),
                        ),
                    },
                }
            }
            if (normalizedAccessPolicy?.ipRules) {
                normalizedAccessPolicy = {
                    ...normalizedAccessPolicy,
                    ipRules: {
                        defaultAction: normalizedAccessPolicy.ipRules.defaultAction,
                        allow: normalizedAccessPolicy.ipRules.allow.toSorted(compareAscii),
                        deny: normalizedAccessPolicy.ipRules.deny.toSorted(compareAscii),
                    },
                }
            }
            if (normalizedAccessPolicy) {
                const configuration = JSON.stringify(normalizedAccessPolicy)
                const existing = accessPolicies.get(normalizedAccessPolicy.id)
                if (existing !== undefined && existing !== configuration) {
                    throw new Error('Proxy runtime snapshot contains inconsistent access policies.')
                }
                accessPolicies.set(normalizedAccessPolicy.id, configuration)
            }

            if (ids.has(id) || host.domains.some((domain) => domains.has(domain))) {
                throw new Error('Proxy runtime snapshot contains duplicate hosts or domains.')
            }

            ids.add(id)
            for (const domain of host.domains) domains.add(domain)
            totalDomains += host.domains.length
            if (totalDomains > MAX_RUNTIME_DOMAINS) {
                throw new Error('Proxy runtime domain limit exceeded.')
            }

            const hostSettings = normalizeProxyHttpSettings(host.httpSettings ?? {})
            return Object.assign(
                {
                    id,
                    domains: host.domains.toSorted(compareAscii),
                    forwardScheme: host.forwardScheme,
                    forwardHost: host.forwardHost,
                    forwardPort: host.forwardPort,
                },
                Object.keys(hostSettings).length === 0 ? {} : { httpSettings: hostSettings },
                host.certificateId ? { certificateId: host.certificateId.toLowerCase() } : {},
                host.forceHttps ? { forceHttps: true } : {},
                host.forwardScheme === 'https'
                    ? {
                          upstreamTls: {
                              verify: host.upstreamTls?.verify ?? true,
                              serverName: host.upstreamTls?.serverName ?? null,
                              trustedCaId: host.upstreamTls?.trustedCaId?.toLowerCase() ?? null,
                          },
                      }
                    : {},
                normalizedAccessPolicy ? { accessPolicy: normalizedAccessPolicy } : {},
            )
        })
        .toSorted((left, right) => compareAscii(left.id, right.id))
    const redirectHosts = enabledRedirects
        .map((input): RedirectRuntimeHost => {
            const host = runtimeRedirectHostSchema.parse(input)
            const id = host.id.toLowerCase()
            const destination = normalizeRedirectDestination(
                host.destination,
                host.preserveRequestUri,
            )

            if (destination === null || destination !== host.destination) {
                throw new Error('Proxy runtime snapshot contains an invalid redirect destination.')
            }
            if (ids.has(id) || host.domains.some((domain) => domains.has(domain))) {
                throw new Error('Proxy runtime snapshot contains duplicate hosts or domains.')
            }

            ids.add(id)
            for (const domain of host.domains) domains.add(domain)
            totalDomains += host.domains.length
            if (totalDomains > MAX_RUNTIME_DOMAINS) {
                throw new Error('Proxy runtime domain limit exceeded.')
            }

            return Object.assign(
                {
                    id,
                    domains: host.domains.toSorted(compareAscii),
                    destination,
                    statusCode: host.statusCode,
                    preserveRequestUri: host.preserveRequestUri,
                },
                host.certificateId ? { certificateId: host.certificateId.toLowerCase() } : {},
            )
        })
        .toSorted((left, right) => compareAscii(left.id, right.id))
    const normalizedSettings = normalizeProxyHttpSettings(httpSettings)
    const referencedCaIds = new Set(
        proxyHosts.flatMap((host) =>
            host.upstreamTls?.trustedCaId ? [host.upstreamTls.trustedCaId] : [],
        ),
    )
    const availableCas = new Map<string, ProxyRuntimeTrustedCa>()
    for (const ca of trustedCas) {
        const id = z.uuidv7().parse(ca.id).toLowerCase()
        if (availableCas.has(id)) throw new Error('Duplicate trusted CA identity.')
        availableCas.set(id, ca)
    }
    const referencedCas = [...referencedCaIds].toSorted(compareAscii).map((id) => {
        const ca = availableCas.get(id)
        if (!ca) throw new Error('Referenced trusted CA is missing.')
        const parsed = runtimeTrustedCaSchema.parse(ca)
        // PEM and fingerprint were canonicalized together by the Controller before persistence.
        return { id, pem: parsed.pem, fingerprintSha256: parsed.fingerprintSha256 }
    })
    const snapshot = {
        version: 7,
        proxyHosts,
        redirectHosts,
        httpSettings: normalizedSettings,
        trustedCas: referencedCas,
    } as const
    const canonical = JSON.stringify(snapshot)

    if (Buffer.byteLength(canonical) + 100 > MAX_RUNTIME_PAYLOAD_BYTES) {
        throw new Error('Proxy runtime snapshot is too large.')
    }

    const revision = 'sha256:' + new Bun.CryptoHasher('sha256').update(canonical).digest('hex')
    return { ...snapshot, revision }
}

export function compareProxyRuntimeStatus(
    desiredRevision: string,
    runtime: ProxyRuntimeStatus | null,
): ProxyRuntimeSyncStatus {
    const status = runtime ?? {
        available: false,
        running: false,
        activeRevision: null,
        lastApplyAt: null,
    }

    return {
        ...status,
        desiredRevision,
        state:
            !status.available || !status.running
                ? 'unavailable'
                : status.activeRevision === desiredRevision
                  ? 'synced'
                  : 'pending',
    }
}
