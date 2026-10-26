import { z } from 'zod'
import {
    MAX_DNS_CONNECTIONS,
    MAX_DNS_CONNECTION_ZONES,
    MAX_CLOUDFLARE_AVAILABLE_ZONES,
    MAX_DNS_CONNECTION_NAME_LENGTH,
    DNS_CONNECTION_ERROR_CODES,
} from '@/config/dns-connections.config.ts'
import { dnsConnectionReferenceSchema } from '@/features/Admin/DnsConnections/validation.ts'

const zoneId = z.string().regex(/^[a-f0-9]{32}$/u)
const safeText = z
    .string()
    .min(1)
    .max(253)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value))
const zone = z.strictObject({ id: zoneId, name: safeText })
const revision = z.number().int().min(1).max(4_294_967_295)
const zones = z
    .array(zone)
    .max(MAX_CLOUDFLARE_AVAILABLE_ZONES)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length)
export const dnsConnectionMetadataSchema = z
    .strictObject({
        id: z.uuidv7(),
        provider: z.literal('cloudflare'),
        ownership: z.literal('instance'),
        name: safeText
            .max(MAX_DNS_CONNECTION_NAME_LENGTH)
            .refine(
                (value) => value === value.trim() && value.length <= MAX_DNS_CONNECTION_NAME_LENGTH,
            ),
        createdByUserId: z.uuid(),
        revision,
        zones: zones.refine(
            (items) => items.length > 0 && items.length <= MAX_DNS_CONNECTION_ZONES,
        ),
        references: z
            .array(
                z.strictObject({ zoneId, consumer: dnsConnectionReferenceSchema.shape.consumer }),
            )
            .max(10_000),
        createdAt: z.iso.datetime({ offset: true }),
        updatedAt: z.iso.datetime({ offset: true }),
        verification: z
            .strictObject({
                status: z.enum(['untested', 'connected', 'disconnected', 'failed']),
                checkedAt: z.iso.datetime({ offset: true }).nullable(),
                zoneIds: z.array(zoneId).max(MAX_DNS_CONNECTION_ZONES),
                error: z.enum(DNS_CONNECTION_ERROR_CODES).nullable(),
            })
            .optional(),
    })
    .refine((value) => {
        const verification = value.verification
        if (!verification) return true
        if (new Set(verification.zoneIds).size !== verification.zoneIds.length) return false
        if (verification.status !== 'connected') return verification.zoneIds.length === 0
        return (
            verification.checkedAt !== null &&
            verification.error === null &&
            verification.zoneIds.length === value.zones.length &&
            verification.zoneIds.every((id) => value.zones.some((item) => item.id === id))
        )
    })
    .refine((value) => Date.parse(value.createdAt) <= Date.parse(value.updatedAt))
    .refine((value) =>
        value.references.every((reference) =>
            value.zones.some((item) => item.id === reference.zoneId),
        ),
    )
    .refine(
        (value) =>
            new Set(
                value.references.map(
                    (reference) =>
                        `${reference.zoneId}:${reference.consumer.type}:${reference.consumer.id}`,
                ),
            ).size === value.references.length,
    )
export const dnsConnectionsSchema = z
    .strictObject({ connections: z.array(dnsConnectionMetadataSchema).max(MAX_DNS_CONNECTIONS) })
    .refine(
        (value) =>
            new Set(value.connections.map((item) => item.id)).size === value.connections.length,
    )
export const dnsConnectionTestResultSchema = z
    .strictObject({
        zones,
        selectedZoneIds: z.array(zoneId).max(MAX_DNS_CONNECTION_ZONES),
        checkedAt: z.iso.datetime({ offset: true }),
        dnsWriteVerified: z.literal(false),
    })
    .refine(
        (value) =>
            new Set(value.selectedZoneIds).size === value.selectedZoneIds.length &&
            value.selectedZoneIds.every((id) => value.zones.some((item) => item.id === id)),
    )
export const validatedDnsConnectionReferenceSchema = z.strictObject({
    reference: dnsConnectionReferenceSchema,
    revision,
    zone,
})
export const dnsConnectionControllerErrorSchema = z.strictObject({
    error: z.enum(DNS_CONNECTION_ERROR_CODES),
})
