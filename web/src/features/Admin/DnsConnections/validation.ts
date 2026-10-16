import { z } from 'zod'
import {
    MAX_CLOUDFLARE_API_TOKEN_LENGTH,
    MAX_DNS_CONNECTION_NAME_LENGTH,
    MAX_DNS_CONNECTION_ZONES,
} from '@/config/dns-connections.config.ts'

const connectionId = z.uuidv7().regex(/^[a-f0-9-]+$/u)
const revision = z.number().int().min(1).max(4_294_967_295)
const zoneId = z.string().regex(/^[a-f0-9]{32}$/u, 'admin.dnsConnections.validation.zone')
const apiToken = z
    .string()
    .min(1, 'admin.dnsConnections.validation.token')
    .max(MAX_CLOUDFLARE_API_TOKEN_LENGTH, 'admin.dnsConnections.validation.token')
    .regex(/^[\x21-\x7e]+$/u, 'admin.dnsConnections.validation.token')
const zoneIds = z
    .array(zoneId)
    .max(MAX_DNS_CONNECTION_ZONES, 'admin.dnsConnections.validation.zones')
    .refine((values) => new Set(values).size === values.length, {
        message: 'admin.dnsConnections.validation.zones',
    })

export const saveDnsConnectionSchema = z
    .strictObject({
        connectionId: connectionId.optional(),
        expectedRevision: z.number().int().min(0).max(4_294_967_295),
        name: z
            .string()
            .trim()
            .min(1, 'admin.dnsConnections.validation.name')
            .max(MAX_DNS_CONNECTION_NAME_LENGTH, 'admin.dnsConnections.validation.name')
            .refine(
                (value) =>
                    value.length <= MAX_DNS_CONNECTION_NAME_LENGTH &&
                    !/[\p{Cc}\p{Cf}]/u.test(value),
                {
                    message: 'admin.dnsConnections.validation.name',
                },
            ),
        apiToken: apiToken.optional(),
        zoneIds: zoneIds.min(1, 'admin.dnsConnections.validation.zones'),
    })
    .superRefine((value, context) => {
        if (
            (!value.connectionId && value.expectedRevision !== 0) ||
            (value.connectionId && value.expectedRevision === 0)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['expectedRevision'],
                message: 'admin.dnsConnections.errors.connection_conflict',
            })
        }
        if (!value.connectionId && !value.apiToken) {
            context.addIssue({
                code: 'custom',
                path: ['apiToken'],
                message: 'admin.dnsConnections.validation.token',
            })
        }
    })

export const testDnsConnectionSchema = z
    .strictObject({
        connectionId: connectionId.optional(),
        apiToken: apiToken.optional(),
        zoneIds: zoneIds.optional(),
    })
    .refine((value) => value.connectionId !== undefined || value.apiToken !== undefined, {
        path: ['apiToken'],
        message: 'admin.dnsConnections.validation.token',
    })

export const deleteDnsConnectionSchema = z.strictObject({
    connectionId,
    expectedRevision: revision,
})

export const dnsConnectionReferenceSchema = z.strictObject({
    connectionId,
    zoneId,
    consumer: z.strictObject({ type: z.enum(['dns01', 'ddns']), id: z.uuidv7() }),
})
