import { z } from 'zod'

import {
    MAX_PROXY_HOST_DOMAINS,
    PROXY_HOST_FORWARD_SCHEMES,
} from '../../../config/proxy-hosts.config'
import {
    normalizeForwardHost,
    normalizeProxyDomain,
    normalizeUpstreamTlsServerName,
} from './Helpers/proxyHostValidation'

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
        const serverName = normalizeUpstreamTlsServerName(value)
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
    domains: proxyHostDomainsSchema,
    forwardScheme: z.enum(PROXY_HOST_FORWARD_SCHEMES),
    forwardHost: proxyForwardHostSchema,
    forwardPort: proxyForwardPortSchema,
    enabled: z.boolean(),
    certificateId: z.uuid().nullable().optional(),
    forceHttps: z.boolean().optional(),
    verifyUpstreamTls: z.boolean().optional(),
    upstreamTlsServerName: proxyUpstreamTlsServerNameSchema.nullable().optional(),
    trustedCaId: z.uuidv7().nullable().optional(),
})

function validateUpstreamTlsInput(
    host: {
        forwardScheme: string
        forwardHost: string
        verifyUpstreamTls?: boolean
        upstreamTlsServerName?: string | null
        trustedCaId?: string | null
    },
    context: z.RefinementCtx,
): void {
    if (host.forwardScheme !== 'https') return
    if (host.verifyUpstreamTls === false && host.trustedCaId) {
        context.addIssue({
            code: 'custom',
            path: ['trustedCaId'],
            message: 'admin.proxyHosts.validation.trustedCaRequiresVerification',
        })
    }
    const isIp =
        z.ipv4().safeParse(host.forwardHost).success || z.ipv6().safeParse(host.forwardHost).success
    if (host.verifyUpstreamTls !== false && isIp && !host.upstreamTlsServerName) {
        context.addIssue({
            code: 'custom',
            path: ['upstreamTlsServerName'],
            message: 'admin.proxyHosts.validation.upstreamTlsIpNameRequired',
        })
    }
}

const createProxyHostFieldsSchema = proxyHostInputSchema.extend({
    verifyUpstreamTls: z.boolean().default(true),
    upstreamTlsServerName: proxyUpstreamTlsServerNameSchema.nullable().default(null),
    trustedCaId: z.uuidv7().nullable().default(null),
})
export const createProxyHostInputSchema =
    createProxyHostFieldsSchema.superRefine(validateUpstreamTlsInput)

export const proxyHostFormSchema = createProxyHostFieldsSchema
    .extend({
        forwardPort: z
            .string()
            .trim()
            .regex(/^\d{1,5}$/u, 'admin.proxyHosts.validation.port')
            .transform(Number)
            .pipe(proxyForwardPortSchema),
    })
    .superRefine(validateUpstreamTlsInput)

export const proxyHostIdInputSchema = z.object({ proxyHostId: z.uuid() })

// Updates merge omitted TLS fields with the persisted HTTPS host before cross-field validation.
export const updateProxyHostInputSchema = proxyHostInputSchema.extend(proxyHostIdInputSchema.shape)

export type CreateProxyHostInput = z.input<typeof createProxyHostInputSchema>
export type UpdateProxyHostInput = z.input<typeof updateProxyHostInputSchema>
