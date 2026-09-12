import { z } from 'zod'

import { normalizeProxyDomain } from '../ProxyHostManagement/Helpers/proxyHostValidation'

export const PROXY_ACCESS_LOGS_DEFAULT_LIMIT = 15
export const PROXY_ACCESS_LOGS_MAX_LIMIT = 200
export const PROXY_ACCESS_LOGS_MAX_OFFSET = 10_000
export const PROXY_ACCESS_LOGS_MAX_SEARCH_BYTES = 128
export const PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024

// oxlint-disable-next-line no-control-regex -- Access-log filters must reject C0/C1 controls.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u

function hasControlCharacter(value: string): boolean {
    return CONTROL_CHARACTER_PATTERN.test(value)
}

function byteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength
}

export const proxyAccessLogHostSchema = z
    .string()
    .trim()
    .min(1, 'admin.proxyAccessLogs.validation.host')
    .max(253, 'admin.proxyAccessLogs.validation.host')
    .transform((value, context) => {
        const normalized = normalizeProxyDomain(value)
        if (!normalized) {
            context.addIssue({
                code: 'custom',
                message: 'admin.proxyAccessLogs.validation.host',
            })
            return z.NEVER
        }
        return normalized
    })

export const proxyAccessLogsSearchSchema = z
    .string()
    .max(PROXY_ACCESS_LOGS_MAX_SEARCH_BYTES, 'admin.proxyAccessLogs.validation.search')
    .refine((value) => byteLength(value) <= PROXY_ACCESS_LOGS_MAX_SEARCH_BYTES, {
        message: 'admin.proxyAccessLogs.validation.search',
    })
    .refine((value) => !hasControlCharacter(value), {
        message: 'admin.proxyAccessLogs.validation.search',
    })

const snapshotSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/u)

export const proxyAccessLogsQuerySchema = z.strictObject({
    snapshot: snapshotSchema.optional(),
    host: proxyAccessLogHostSchema.optional(),
    status: z
        .number('admin.proxyAccessLogs.validation.status')
        .int('admin.proxyAccessLogs.validation.status')
        .min(100, 'admin.proxyAccessLogs.validation.status')
        .max(599, 'admin.proxyAccessLogs.validation.status')
        .optional(),
    search: proxyAccessLogsSearchSchema.optional(),
    limit: z
        .number('admin.proxyAccessLogs.validation.limit')
        .int('admin.proxyAccessLogs.validation.limit')
        .min(1, 'admin.proxyAccessLogs.validation.limit')
        .max(PROXY_ACCESS_LOGS_MAX_LIMIT, 'admin.proxyAccessLogs.validation.limit')
        .default(PROXY_ACCESS_LOGS_DEFAULT_LIMIT),
    offset: z
        .number('admin.proxyAccessLogs.validation.offset')
        .int('admin.proxyAccessLogs.validation.offset')
        .min(0, 'admin.proxyAccessLogs.validation.offset')
        .max(PROXY_ACCESS_LOGS_MAX_OFFSET, 'admin.proxyAccessLogs.validation.offset')
        .default(0),
})

const timestampSchema = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))

const safeNonNegativeNumberSchema = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)

const responseTextSchema = (max: number) =>
    z
        .string()
        .min(1)
        .max(max)
        .refine((value) => !hasControlCharacter(value))

const proxyAccessLogEntrySchema = z.strictObject({
    timestamp: timestampSchema,
    host: responseTextSchema(253),
    method: responseTextSchema(32),
    path: z
        .string()
        .min(1)
        .max(2_048)
        .refine((value) => !hasControlCharacter(value) && !value.includes('?')),
    status: z.number().int().min(100).max(599),
    durationMs: safeNonNegativeNumberSchema,
    clientIp: responseTextSchema(64),
    upstream: responseTextSchema(512).nullable(),
    bytes: safeNonNegativeNumberSchema,
    protocol: responseTextSchema(32),
})

export const proxyAccessLogsResultSchema = z
    .strictObject({
        entries: z.array(proxyAccessLogEntrySchema).max(PROXY_ACCESS_LOGS_MAX_LIMIT),
        limit: z.number().int().min(1).max(PROXY_ACCESS_LOGS_MAX_LIMIT),
        offset: z.number().int().min(0).max(PROXY_ACCESS_LOGS_MAX_OFFSET),
        total: z.number().int().min(0).max(PROXY_ACCESS_LOGS_MAX_OFFSET),
        hasMore: z.boolean(),
        truncated: z.boolean(),
        snapshot: snapshotSchema,
        snapshotExpiresAt: timestampSchema,
        snapshotReset: z.boolean(),
    })
    .superRefine((result, context) => {
        if (result.snapshotReset && result.offset !== 0) {
            context.addIssue({ code: 'custom', path: ['offset'] })
        }
        if (result.entries.length > result.limit) {
            context.addIssue({ code: 'custom', path: ['entries'] })
        }

        const endOffset = result.offset + result.entries.length
        if (result.entries.length > 0 && endOffset > result.total) {
            context.addIssue({ code: 'custom', path: ['total'] })
        }
        if (result.hasMore !== endOffset < result.total) {
            context.addIssue({ code: 'custom', path: ['hasMore'] })
        }
    })

export type ProxyAccessLogsQuery = z.input<typeof proxyAccessLogsQuerySchema>
