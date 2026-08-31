// oxlint-disable-next-line import/no-unassigned-import -- Keeps runtime hashing behind the server boundary.
import '@tanstack/react-start/server-only'

import { z } from 'zod'

import {
    normalizeProxyHttpSettings,
    proxyAdvancedConfigSchema,
    proxyHttpSettingsSchema,
} from '../../features/Admin/ProxyHostManagement/config-validation'

import {
    proxyForwardHostSchema,
    proxyForwardPortSchema,
    proxyHostDomainsSchema,
    proxyUpstreamTlsServerNameSchema,
} from '../../features/Admin/ProxyHostManagement/validation'
import type {
    ProxyHttpSettings,
    ProxyRuntimeStatus,
    ProxyRuntimeSyncStatus,
} from '../../shared/Types/proxy-runtime.types'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
    ProxyRuntimeTrustedCa,
} from './Types/proxy-runtime.types'
import { createTrustedCaInputSchema } from '../../features/Admin/TrustedCaManagement/validation'

export const MAX_RUNTIME_PROXY_HOSTS = 1_000
export const MAX_RUNTIME_PAYLOAD_BYTES = 16 * 1_024 * 1_024
export const PROXY_RUNTIME_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u

const runtimeUpstreamTlsSchema = z.strictObject({
    verify: z.boolean(),
    serverName: proxyUpstreamTlsServerNameSchema.nullable().default(null),
    trustedCaId: z.uuidv7().nullable().default(null),
})
const runtimeTrustedCaSchema = z.strictObject({
    id: z.uuidv7(),
    pem: createTrustedCaInputSchema.shape.pem,
    fingerprintSha256: z.string().regex(PROXY_RUNTIME_REVISION_PATTERN),
})

const runtimeHostSchema = z
    .object({
        id: z.uuid(),
        domains: proxyHostDomainsSchema,
        forwardScheme: z.enum(['http', 'https']),
        forwardHost: proxyForwardHostSchema,
        forwardPort: proxyForwardPortSchema,
        httpSettings: proxyHttpSettingsSchema.optional(),
        advancedConfig: proxyAdvancedConfigSchema.default(''),
        certificateId: z.uuid().nullish(),
        forceHttps: z.boolean().default(false),
        upstreamTls: runtimeUpstreamTlsSchema.optional(),
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

function compareAscii(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

// Property order and omission of empty host settings preserve the Rust hash contract.
export function createProxyRuntimeSnapshot(
    hosts: ReadonlyArray<ProxyRuntimeHost & { readonly enabled: boolean }>,
    httpSettings: ProxyHttpSettings = {},
    trustedCas: ReadonlyArray<ProxyRuntimeTrustedCa> = [],
): ProxyRuntimeSnapshot {
    const enabledHosts = hosts.filter((host) => host.enabled)

    if (enabledHosts.length > MAX_RUNTIME_PROXY_HOSTS) {
        throw new Error('Proxy runtime host limit exceeded.')
    }

    const ids = new Set<string>()
    const domains = new Set<string>()
    const proxyHosts = enabledHosts
        .map((input): ProxyRuntimeHost => {
            const host = runtimeHostSchema.parse(input)
            const id = host.id.toLowerCase()

            if (ids.has(id) || host.domains.some((domain) => domains.has(domain))) {
                throw new Error('Proxy runtime snapshot contains duplicate hosts or domains.')
            }

            ids.add(id)
            for (const domain of host.domains) domains.add(domain)

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
                host.advancedConfig === '' ? {} : { advancedConfig: host.advancedConfig },
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
            )
        })
        .toSorted((left, right) => compareAscii(left.id, right.id))
    const normalizedSettings = normalizeProxyHttpSettings(httpSettings)
    const hasHostSettings = proxyHosts.some(
        (host) => host.httpSettings !== undefined || host.advancedConfig !== undefined,
    )
    const hasCertificates = proxyHosts.some((host) => host.certificateId !== undefined)
    const hasUpstreamTls = proxyHosts.some((host) => host.upstreamTls !== undefined)
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
    const snapshot = hasUpstreamTls
        ? ({
              version: 5,
              proxyHosts,
              httpSettings: normalizedSettings,
              trustedCas: referencedCas,
          } as const)
        : hasCertificates
          ? ({ version: 4, proxyHosts, httpSettings: normalizedSettings } as const)
          : hasHostSettings
            ? ({ version: 3, proxyHosts, httpSettings: normalizedSettings } as const)
            : Object.keys(normalizedSettings).length === 0
              ? ({ version: 1, proxyHosts } as const)
              : ({ version: 2, proxyHosts, httpSettings: normalizedSettings } as const)
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
