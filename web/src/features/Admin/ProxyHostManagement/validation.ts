import { z } from 'zod'

import {
    MAX_PROXY_HOST_DOMAINS,
    PROXY_HOST_FORWARD_SCHEMES,
} from '../../../config/proxy-hosts.config'
import { normalizeForwardHost, normalizeProxyDomain } from './Helpers/proxyHostValidation'

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

export const createProxyHostInputSchema = z.object({
    domains: proxyHostDomainsSchema,
    forwardScheme: z.enum(PROXY_HOST_FORWARD_SCHEMES),
    forwardHost: proxyForwardHostSchema,
    forwardPort: proxyForwardPortSchema,
    enabled: z.boolean(),
})

export const proxyHostFormSchema = createProxyHostInputSchema.extend({
    forwardPort: z
        .string()
        .trim()
        .regex(/^\d{1,5}$/u, 'admin.proxyHosts.validation.port')
        .transform(Number)
        .pipe(proxyForwardPortSchema),
})

export const proxyHostIdInputSchema = z.object({ proxyHostId: z.uuid() })

export const updateProxyHostInputSchema = createProxyHostInputSchema.extend(
    proxyHostIdInputSchema.shape,
)

export type CreateProxyHostInput = z.input<typeof createProxyHostInputSchema>
export type UpdateProxyHostInput = z.input<typeof updateProxyHostInputSchema>
