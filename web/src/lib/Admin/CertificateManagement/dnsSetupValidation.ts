import { z } from 'zod'
import { ACME_ENVIRONMENTS, MAX_CERTIFICATE_DOMAINS } from '@/config/certificates.config.ts'
import { dnsZoneIdSchema, dnsZoneNameSchema } from '@/lib/DnsConnections/validation.ts'
import { isPublicAcmeDomain, normalizeCertificateDomain } from './certificateValidation.ts'

export const dnsSetupDomainSchema = z
    .string()
    .trim()
    .max(253)
    .transform((value) => normalizeCertificateDomain(value) ?? '')
    .refine((value) => isPublicAcmeDomain(value, true))

export const dnsSetupInputSchema = z
    .strictObject({
        domains: z.array(dnsSetupDomainSchema).min(1).max(MAX_CERTIFICATE_DOMAINS),
        environment: z.enum(ACME_ENVIRONMENTS),
        dnsMode: z.enum(['provider', 'delegated']),
        connectionId: z.uuidv7().transform((value) => value.toLowerCase()),
        expectedRevision: z.number().int().min(1).max(4_294_967_295),
        zoneId: dnsZoneIdSchema,
        delegation: z
            .discriminatedUnion('type', [
                z.strictObject({
                    type: z.literal('cname'),
                    targetOwner: z
                        .string()
                        .trim()
                        .toLowerCase()
                        .transform((value) => value.replace(/\.$/u, ''))
                        .pipe(dnsZoneNameSchema),
                }),
                z.strictObject({ type: z.literal('ns') }),
            ])
            .optional(),
    })
    .superRefine((value, context) => {
        if (new Set(value.domains).size !== value.domains.length)
            context.addIssue({ code: 'custom', path: ['domains'], message: 'Duplicate domain.' })
        if ((value.dnsMode === 'delegated') !== Boolean(value.delegation))
            context.addIssue({ code: 'custom', path: ['delegation'], message: 'Invalid DNS mode.' })
    })

export const manualDnsCheckInputSchema = z.strictObject({
    certificateId: z.uuidv7().transform((value) => value.toLowerCase()),
    operationId: z.uuidv7().transform((value) => value.toLowerCase()),
    challengeSetId: z.uuidv7().transform((value) => value.toLowerCase()),
})
