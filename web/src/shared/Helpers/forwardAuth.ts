import { z } from 'zod'

import { ACCESS_POLICY_FORWARD_AUTH_PROVIDERS } from '../../config/access-policies.config'

export const FORWARD_AUTH_PROVIDERS = ACCESS_POLICY_FORWARD_AUTH_PROVIDERS
export type ForwardAuthProvider = (typeof FORWARD_AUTH_PROVIDERS)[number]

export const FORWARD_AUTH_REQUEST_HEADERS = ['Authorization', 'Cookie'] as const
export type ForwardAuthRequestHeader = (typeof FORWARD_AUTH_REQUEST_HEADERS)[number]

export const DEFAULT_FORWARD_AUTH_TIMEOUT_SECONDS = 5
export const MAX_FORWARD_AUTH_TIMEOUT_SECONDS = 30
export const MAX_FORWARD_AUTH_RESPONSE_HEADERS = 16
export const MAX_FORWARD_AUTH_GATEWAY_PATH_PREFIX_LENGTH = 128
export const MAX_FORWARD_AUTH_ENDPOINT_LENGTH = 2_048

export function isValidForwardAuthGatewayPathPrefix(value: string): boolean {
    if (
        value.length < 2 ||
        value.length > MAX_FORWARD_AUTH_GATEWAY_PATH_PREFIX_LENGTH ||
        value === '/' ||
        !/^\/[A-Za-z0-9._/-]+\/$/u.test(value) ||
        value.includes('//')
    ) {
        return false
    }
    return value
        .slice(1, -1)
        .split('/')
        .every((segment) => segment !== '.' && segment !== '..')
}

export const forwardAuthGatewayPathPrefixSchema = z
    .string()
    .nullable()
    .default(null)
    .refine((value) => value === null || isValidForwardAuthGatewayPathPrefix(value), {
        message:
            'Forward Auth gateway path prefix must be a clean absolute path ending in a slash.',
    })

function compareAscii(left: string, right: string): number {
    const normalizedLeft = left.toLowerCase()
    const normalizedRight = right.toLowerCase()
    return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0
}

function canonicalizeHeaderName(value: string): string {
    return value
        .split('-')
        .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
        .join('-')
}

export function isCanonicalForwardAuthEndpoint(value: string): boolean {
    if (
        value.length === 0 ||
        value.length > MAX_FORWARD_AUTH_ENDPOINT_LENGTH ||
        value !== value.trim() ||
        [...value].some((character) => {
            const code = character.charCodeAt(0)
            return code <= 0x20 || code === 0x7f || '{}\\%'.includes(character)
        }) ||
        value.includes('?') ||
        value.includes('#')
    ) {
        return false
    }

    try {
        const parsed = new URL(value)
        const hostname = parsed.hostname
        const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']')
        const dnsHostname = isIpv6 ? '' : hostname
        const isDnsOrIpv4 =
            dnsHostname.length <= 253 &&
            dnsHostname
                .split('.')
                .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
        return (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            hostname.length > 0 &&
            (isIpv6 || isDnsOrIpv4) &&
            parsed.username.length === 0 &&
            parsed.password.length === 0 &&
            parsed.port !== '0' &&
            parsed.search.length === 0 &&
            parsed.hash.length === 0 &&
            parsed.href === value
        )
    } catch {
        return false
    }
}

export const forwardAuthEndpointSchema = z.string().refine(isCanonicalForwardAuthEndpoint, {
    message:
        'Forward Auth endpoint must be a canonical HTTP or HTTPS URL without credentials, query, fragment, or placeholders.',
})

const requestHeaderSchema = z.enum(FORWARD_AUTH_REQUEST_HEADERS)

export const forwardAuthRequestHeadersSchema = z
    .array(requestHeaderSchema)
    .default(['Cookie'])
    .superRefine((headers, context) => {
        if (new Set(headers).size !== headers.length) {
            context.addIssue({
                code: 'custom',
                message: 'Forward Auth request headers must be unique.',
            })
        }
    })
    .transform((headers) => headers.toSorted(compareAscii))

const FORWARD_AUTH_FORBIDDEN_RESPONSE_HEADERS = new Set(
    ['Host', 'Authorization', 'Cookie', 'Set-Cookie', 'Forwarded'].map((header) =>
        header.toLowerCase(),
    ),
)

export function isAllowedForwardAuthResponseHeader(value: string): boolean {
    if (
        !/^[A-Za-z][A-Za-z0-9-]{0,63}$/u.test(value) ||
        value.split('-').some((segment) => segment.length === 0)
    ) {
        return false
    }
    const lower = value.toLowerCase()
    return (
        !FORWARD_AUTH_FORBIDDEN_RESPONSE_HEADERS.has(lower) &&
        !lower.startsWith('sec-') &&
        !lower.startsWith('x-forwarded-') &&
        lower !== 'x-real-ip' &&
        ![
            'connection',
            'content-length',
            'content-type',
            'keep-alive',
            'location',
            'proxy',
            'proxy-authenticate',
            'proxy-authorization',
            'proxy-connection',
            'te',
            'trailer',
            'transfer-encoding',
            'upgrade',
            'via',
        ].includes(lower)
    )
}

export const forwardAuthResponseHeadersSchema = z
    .array(z.string().refine(isAllowedForwardAuthResponseHeader).transform(canonicalizeHeaderName))
    .max(MAX_FORWARD_AUTH_RESPONSE_HEADERS)
    .default([])
    .superRefine((headers, context) => {
        const normalized = headers.map((header) => header.toLowerCase())
        if (new Set(normalized).size !== normalized.length) {
            context.addIssue({
                code: 'custom',
                message: 'Forward Auth response headers must be unique.',
            })
        }
    })
    .transform((headers) => headers.toSorted(compareAscii))

export const forwardAuthInputSchema = z.strictObject({
    provider: z.enum(FORWARD_AUTH_PROVIDERS),
    endpoint: forwardAuthEndpointSchema,
    timeoutSeconds: z
        .int()
        .min(1)
        .max(MAX_FORWARD_AUTH_TIMEOUT_SECONDS)
        .default(DEFAULT_FORWARD_AUTH_TIMEOUT_SECONDS),
    gatewayPathPrefix: forwardAuthGatewayPathPrefixSchema,
    requestHeaders: forwardAuthRequestHeadersSchema,
    responseHeaders: forwardAuthResponseHeadersSchema,
})

export const forwardAuthRuntimeSchema = z.strictObject({
    endpoint: forwardAuthEndpointSchema,
    timeoutSeconds: z.int().min(1).max(MAX_FORWARD_AUTH_TIMEOUT_SECONDS),
    requestHeaders: z
        .array(requestHeaderSchema)
        .max(FORWARD_AUTH_REQUEST_HEADERS.length)
        .superRefine((headers, context) => validateSortedUniqueHeaders(headers, context)),
    responseHeaders: z
        .array(
            z
                .string()
                .refine(isAllowedForwardAuthResponseHeader)
                .refine((header) => canonicalizeHeaderName(header) === header),
        )
        .max(MAX_FORWARD_AUTH_RESPONSE_HEADERS)
        .superRefine((headers, context) => validateSortedUniqueHeaders(headers, context)),
    gatewayPathPrefix: forwardAuthGatewayPathPrefixSchema.optional(),
})

function validateSortedUniqueHeaders(headers: ReadonlyArray<string>, context: z.RefinementCtx) {
    const normalized = headers.map((header) => header.toLowerCase())
    if (
        new Set(normalized).size !== normalized.length ||
        headers.some((header, index) => index > 0 && compareAscii(headers[index - 1]!, header) >= 0)
    ) {
        context.addIssue({
            code: 'custom',
            message: 'Forward Auth headers must be sorted and unique.',
        })
    }
}

export type ForwardAuthConfiguration = z.output<typeof forwardAuthInputSchema>
export type ForwardAuthRuntimeConfiguration = z.output<typeof forwardAuthRuntimeSchema>

export function toForwardAuthRuntimeConfiguration(
    config: ForwardAuthConfiguration,
): ForwardAuthRuntimeConfiguration {
    return {
        endpoint: config.endpoint,
        timeoutSeconds: config.timeoutSeconds,
        requestHeaders: [...config.requestHeaders],
        responseHeaders: [...config.responseHeaders],
        ...(config.gatewayPathPrefix === null
            ? {}
            : { gatewayPathPrefix: config.gatewayPathPrefix }),
    }
}
