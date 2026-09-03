import { z } from 'zod'

import {
    MAX_REDIRECT_DESTINATION_LENGTH,
    MAX_REDIRECT_HOST_DOMAINS,
} from '../../../config/redirect-hosts.config'
import type { RedirectHostStatusCode } from '../../../config/redirect-hosts.config'
import {
    normalizeForwardHost,
    normalizeProxyDomain,
} from '../ProxyHostManagement/Helpers/proxyHostValidation'

// oxlint-disable-next-line no-control-regex -- Redirect targets must reject decoded C0/C1 controls.
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u
const invalidPercentEscapePattern = /%(?![0-9a-f]{2})/iu
const rawDestinationCharacterPattern = /[$"'\\{}]/gu

function encodeRawDestinationCharacters(value: string): string {
    const encoded: Record<string, string> = {
        $: '%24',
        '"': '%22',
        "'": '%27',
        '\\': '%5C',
        '{': '%7B',
        '}': '%7D',
    }
    return value.replace(rawDestinationCharacterPattern, (character) => encoded[character]!)
}

export function normalizeRedirectDestination(
    value: string,
    preserveRequestUri: boolean,
): string | null {
    if (controlCharacterPattern.test(value)) return null
    const input = value.trim()
    if (
        !input ||
        input.length > MAX_REDIRECT_DESTINATION_LENGTH ||
        invalidPercentEscapePattern.test(input)
    ) {
        return null
    }

    if (input.includes('\\')) return null
    let parsed: URL
    try {
        parsed = new URL(encodeRawDestinationCharacters(input))
    } catch {
        return null
    }

    if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
    ) {
        return null
    }
    const parsedHostname =
        parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
            ? parsed.hostname.slice(1, -1)
            : parsed.hostname
    const canonicalHostname = normalizeForwardHost(parsedHostname)
    if (!canonicalHostname) return null
    parsed.hostname = canonicalHostname

    try {
        if (controlCharacterPattern.test(decodeURIComponent(parsed.toString()))) return null
    } catch {
        return null
    }

    if (preserveRequestUri) {
        if (parsed.search || parsed.hash) return null
        const pathname = parsed.pathname.replace(/\/+$/u, '')
        const base = parsed.origin + (pathname === '/' ? '' : pathname)
        return base.length <= MAX_REDIRECT_DESTINATION_LENGTH ? base : null
    }

    const normalized = parsed.toString()
    return normalized.length <= MAX_REDIRECT_DESTINATION_LENGTH ? normalized : null
}

export const redirectDomainSchema = z
    .string()
    .max(1_024, 'admin.redirectHosts.validation.domain')
    .transform((value, context) => {
        const domain = normalizeProxyDomain(value)
        if (domain === null) {
            context.addIssue({ code: 'custom', message: 'admin.redirectHosts.validation.domain' })
            return z.NEVER
        }
        return domain
    })

export const redirectHostDomainsSchema = z
    .array(redirectDomainSchema)
    .min(1, 'admin.redirectHosts.validation.domainsRequired')
    .max(MAX_REDIRECT_HOST_DOMAINS, 'admin.redirectHosts.validation.domainsLimit')
    .superRefine((domains, context) => {
        const seen = new Set<string>()
        for (const [index, domain] of domains.entries()) {
            if (seen.has(domain)) {
                context.addIssue({
                    code: 'custom',
                    message: 'admin.redirectHosts.validation.duplicateDomain',
                    path: [index],
                })
            }
            seen.add(domain)
        }
    })

export const redirectDestinationSchema = z
    .string()
    .max(MAX_REDIRECT_DESTINATION_LENGTH, 'admin.redirectHosts.validation.destination')

export const redirectStatusCodeSchema = z.union([
    z.literal(301),
    z.literal(302),
    z.literal(307),
    z.literal(308),
])

const redirectHostFieldsSchema = z.object({
    domains: redirectHostDomainsSchema,
    destination: redirectDestinationSchema,
    statusCode: redirectStatusCodeSchema,
    preserveRequestUri: z.boolean(),
    enabled: z.boolean(),
    certificateId: z.uuid().nullable().optional(),
})

const normalizeInput = <T extends { destination: string; preserveRequestUri: boolean }>(
    input: T,
    context: z.RefinementCtx,
): T => {
    const destination = normalizeRedirectDestination(input.destination, input.preserveRequestUri)
    if (destination === null) {
        context.addIssue({
            code: 'custom',
            path: ['destination'],
            message: 'admin.redirectHosts.validation.destination',
        })
        return input
    }
    return { ...input, destination } as T
}

export const createRedirectHostInputSchema = redirectHostFieldsSchema.transform(normalizeInput)
const redirectHostFormFieldsSchema = redirectHostFieldsSchema.extend({
    certificateId: z.uuid().nullable(),
})
export const redirectHostFormSchema = redirectHostFormFieldsSchema
    .extend({
        statusCode: z
            .string()
            .regex(/^(?:301|302|307|308)$/u)
            .transform((value): RedirectHostStatusCode => Number(value) as RedirectHostStatusCode),
    })
    .transform(normalizeInput)
export const redirectHostIdInputSchema = z.object({ redirectHostId: z.uuid() })
export const updateRedirectHostInputSchema = redirectHostFieldsSchema
    .extend(redirectHostIdInputSchema.shape)
    .transform(normalizeInput)

export type CreateRedirectHostInput = z.output<typeof createRedirectHostInputSchema>
export type UpdateRedirectHostInput = z.output<typeof updateRedirectHostInputSchema>
export type RedirectHostFormValues = z.input<typeof redirectHostFormSchema>
