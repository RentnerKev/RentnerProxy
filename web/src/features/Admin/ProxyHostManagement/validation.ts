import { z } from 'zod'
import {
    MAX_PROXY_UPSTREAM_MEMBERS,
    PROXY_UPSTREAM_POLICIES,
} from '@/config/upstream-pools.config.ts'
import {
    proxyUpstreamMemberSchema,
    proxyUpstreamPoolSchema,
    upstreamTlsRequiresServerName,
    validateUniqueUpstreamMembers,
} from '@/lib/ProxyRuntime/upstreamPool.ts'
import type { ProxyUpstreamPool } from '@/lib/ProxyRuntime/Types/upstream-pool.types.ts'
export { proxyUpstreamPoolSchema } from '@/lib/ProxyRuntime/upstreamPool.ts'
import { browserCacheSettingsSchema } from './config-validation.ts'
import { responseCacheSchema } from '@/lib/ResponseCache/responseCache.ts'
import { hostTagIdsSchema } from '@/lib/HostTags/hostTags.ts'

import { MAX_PROXY_HOST_DOMAINS, PROXY_HOST_FORWARD_SCHEMES } from '@/config/proxy-hosts.config.ts'
import {
    normalizeForwardHost,
    normalizeProxyDomain,
} from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

export const proxyDomainSchema = z
    .string()
    .max(1_024, 'admin.proxyHosts.validation.domain')
    .transform((value, context) => {
        const domain = normalizeProxyDomain(value)

        if (domain === null) {
            context.addIssue({ code: 'custom', message: 'admin.proxyHosts.validation.domain' })
            return z.NEVER
        }

        return domain
    })

export const proxyHostDomainsSchema = z
    .array(proxyDomainSchema)
    .min(1, 'admin.proxyHosts.validation.domainsRequired')
    .max(MAX_PROXY_HOST_DOMAINS, 'admin.proxyHosts.validation.domainsLimit')
    .superRefine((domains, context) => {
        const seen = new Set<string>()

        for (const [index, domain] of domains.entries()) {
            if (seen.has(domain)) {
                context.addIssue({
                    code: 'custom',
                    message: 'admin.proxyHosts.validation.duplicateDomain',
                    path: [index],
                })
            }

            seen.add(domain)
        }
    })

export const proxyForwardHostSchema = z
    .string()
    .max(1_024, 'admin.proxyHosts.validation.forwardHost')
    .transform((value, context) => {
        const host = normalizeForwardHost(value)

        if (host === null) {
            context.addIssue({ code: 'custom', message: 'admin.proxyHosts.validation.forwardHost' })
            return z.NEVER
        }

        return host
    })

export const proxyForwardPortSchema = z
    .number('admin.proxyHosts.validation.port')
    .int('admin.proxyHosts.validation.port')
    .min(1, 'admin.proxyHosts.validation.port')
    .max(65_535, 'admin.proxyHosts.validation.port')

export const proxyUpstreamTlsServerNameSchema = z
    .string()
    .max(1_024, 'admin.proxyHosts.validation.upstreamTlsServerName')
    .transform((value, context) => {
        if (!value.trim()) return null
        const serverName = normalizeProxyDomain(value)
        if (serverName === null) {
            context.addIssue({
                code: 'custom',
                message: 'admin.proxyHosts.validation.upstreamTlsServerName',
            })
            return z.NEVER
        }
        return serverName
    })

const proxyHostInputSchema = z.object({
    responseCompression: z.enum(['auto', 'off']).nullable().optional(),
    browserCache: browserCacheSettingsSchema.optional(),
    tagIds: hostTagIdsSchema.optional(),
    responseCache: responseCacheSchema.nullable().optional(),
    domains: proxyHostDomainsSchema,
    forwardScheme: z.enum(PROXY_HOST_FORWARD_SCHEMES),
    forwardHost: proxyForwardHostSchema,
    forwardPort: proxyForwardPortSchema,
    upstreamPool: proxyUpstreamPoolSchema.nullable().optional(),
    enabled: z.boolean(),
    certificateId: z.uuid().nullable().optional(),
    forceHttps: z.boolean().optional(),
    verifyUpstreamTls: z.boolean().optional(),
    upstreamTlsServerName: proxyUpstreamTlsServerNameSchema.nullable().optional(),
    trustedCaId: z.uuidv7().nullable().optional(),
    accessPolicyId: z.uuidv7().nullable().optional(),
})

function validateUpstreamTlsInput(
    host: {
        forwardScheme: string
        forwardHost: string
        forwardPort: number
        upstreamPool?: ProxyUpstreamPool | null | undefined
        verifyUpstreamTls?: boolean
        upstreamTlsServerName?: string | null
        trustedCaId?: string | null
    },
    context: z.RefinementCtx,
): void {
    validateUpstreamPoolPrimary(host, context)
    if (host.forwardScheme !== 'https') return
    if (host.verifyUpstreamTls === false && host.trustedCaId) {
        context.addIssue({
            code: 'custom',
            path: ['trustedCaId'],
            message: 'admin.proxyHosts.validation.trustedCaRequiresVerification',
        })
    }
    const requiresName = upstreamTlsRequiresServerName(
        host.upstreamPool?.members.map((member) => member.host) ?? [host.forwardHost],
    )
    if (host.verifyUpstreamTls !== false && requiresName && !host.upstreamTlsServerName) {
        context.addIssue({
            code: 'custom',
            path: ['upstreamTlsServerName'],
            message: 'admin.proxyHosts.validation.upstreamTlsIpNameRequired',
        })
    }
}

export function validateUpstreamPoolPrimary(
    host: {
        forwardHost: string
        forwardPort: number
        upstreamPool?: ProxyUpstreamPool | null | undefined
    },
    context: z.RefinementCtx,
): void {
    const first = host.upstreamPool?.members[0]
    if (first && (first.host !== host.forwardHost || first.port !== host.forwardPort)) {
        context.addIssue({
            code: 'custom',
            path: ['upstreamPool'],
            message: 'admin.proxyHosts.validation.upstreamPoolPrimary',
        })
    }
}

const formPortSchema = z
    .string()
    .trim()
    .regex(/^\d{1,5}$/u, 'admin.proxyHosts.validation.port')
    .transform(Number)
    .pipe(proxyForwardPortSchema)
const formUpstreamPoolSchema = z
    .strictObject({
        policy: z.enum(PROXY_UPSTREAM_POLICIES),
        members: z
            .array(proxyUpstreamMemberSchema.extend({ port: formPortSchema }))
            .min(1, 'admin.proxyHosts.validation.upstreamMembersRequired')
            .max(MAX_PROXY_UPSTREAM_MEMBERS, 'admin.proxyHosts.validation.upstreamMembersLimit'),
    })
    .superRefine(validateUniqueUpstreamMembers)

const createProxyHostFieldsSchema = proxyHostInputSchema.extend({
    verifyUpstreamTls: z.boolean().default(true),
    upstreamTlsServerName: proxyUpstreamTlsServerNameSchema.nullable().default(null),
    trustedCaId: z.uuidv7().nullable().default(null),
})
export const createProxyHostInputSchema =
    createProxyHostFieldsSchema.superRefine(validateUpstreamTlsInput)

export const proxyHostFormSchema = createProxyHostFieldsSchema
    .extend({
        forwardPort: formPortSchema,
        upstreamPool: formUpstreamPoolSchema.nullable().optional(),
    })
    .superRefine(validateUpstreamTlsInput)

export const proxyHostIdInputSchema = z.object({ proxyHostId: z.uuid() })

export const updateProxyHostInputSchema = proxyHostInputSchema
    .extend(proxyHostIdInputSchema.shape)
    .superRefine(validateUpstreamPoolPrimary)
