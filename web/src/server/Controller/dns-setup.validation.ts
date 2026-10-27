import { z } from 'zod'
import { MAX_CERTIFICATE_DOMAINS } from '@/config/certificates.config.ts'
import {
    dnsProviderIdSchema,
    dnsZoneIdSchema,
    dnsZoneNameSchema,
} from '@/lib/DnsConnections/validation.ts'
import {
    isPublicAcmeDomain,
    normalizeCertificateDomain,
} from '@/lib/Admin/CertificateManagement/certificateValidation.ts'

const timestamp = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
const domain = z
    .string()
    .max(253)
    .refine(
        (value) => normalizeCertificateDomain(value) === value && isPublicAcmeDomain(value, true),
    )
const identifiers = z
    .array(domain)
    .min(1)
    .max(MAX_CERTIFICATE_DOMAINS)
    .refine((values) => new Set(values).size === values.length)
const absoluteName = z
    .string()
    .max(254)
    .refine(
        (value) => value.endsWith('.') && dnsZoneNameSchema.safeParse(value.slice(0, -1)).success,
    )
const record = z
    .strictObject({
        identifiers,
        originalOwner: dnsZoneNameSchema,
        instruction: z.strictObject({
            type: z.enum(['TXT', 'CNAME', 'NS']),
            owner: dnsZoneNameSchema,
            values: z.array(absoluteName).max(16),
        }),
        status: z.enum([
            'ready',
            'missing',
            'conflicting',
            'lookup_failed',
            'nameservers_unavailable',
        ]),
        observedTarget: dnsZoneNameSchema.nullable(),
    })
    .refine(
        (value) =>
            value.instruction.owner === value.originalOwner &&
            value.identifiers.every(
                (identifier) =>
                    `_acme-challenge.${identifier.replace(/^\*\./u, '')}` === value.originalOwner,
            ),
    )

export const dnsSetupResultSchema = z.strictObject({
    connectionId: z.uuidv7(),
    connectionRevision: z.number().int().min(1).max(4_294_967_295),
    zoneId: dnsZoneIdSchema,
    zoneName: dnsZoneNameSchema,
    provider: dnsProviderIdSchema,
    dnsMode: z.enum(['provider', 'delegated']),
    checkedAt: timestamp,
    results: z.array(record).min(1).max(MAX_CERTIFICATE_DOMAINS),
})

export const manualDnsCheckResultSchema = z
    .strictObject({
        certificateId: z.uuidv7(),
        operationId: z.uuidv7(),
        challengeSetId: z.uuidv7(),
        checkedAt: timestamp,
        expiresAt: timestamp,
        status: z.enum(['ready', 'pending', 'expired', 'lookup_failed']),
        records: z
            .array(
                z.strictObject({
                    owner: dnsZoneNameSchema,
                    identifiers,
                    status: z.enum(['ready', 'pending', 'lookup_failed']),
                }),
            )
            .min(1)
            .max(MAX_CERTIFICATE_DOMAINS),
    })
    .refine(
        (value) =>
            new Set(value.records.map((item) => item.owner)).size === value.records.length &&
            value.records.every((item) =>
                item.identifiers.every(
                    (identifier) =>
                        `_acme-challenge.${identifier.replace(/^\*\./u, '')}` === item.owner,
                ),
            ),
    )
