import { z } from 'zod'
import {
    ACME_CHALLENGE_TYPES,
    ACME_ENVIRONMENTS,
    CERTIFICATE_EVENT_KINDS,
    CERTIFICATE_ERROR_CODES,
    CERTIFICATE_OPERATION_KINDS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_SOURCES,
    CERTIFICATE_STORED_STATUSES,
    MAX_CERTIFICATE_DOMAINS,
} from '@/config/certificates.config.ts'
import { normalizeCertificateDomain } from '@/lib/Admin/CertificateManagement/certificateValidation.ts'

const timestamp = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))

export const certificateMetadataSchema = z
    .object({
        id: z.uuid(),
        source: z.enum(CERTIFICATE_SOURCES),
        environment: z.enum(ACME_ENVIRONMENTS).nullable(),
        domains: z
            .array(
                z
                    .string()
                    .max(253)
                    .refine((domain) => normalizeCertificateDomain(domain) === domain),
            )
            .max(MAX_CERTIFICATE_DOMAINS),
        status: z.enum(CERTIFICATE_STORED_STATUSES),
        operation: z.enum(CERTIFICATE_OPERATIONS),
        currentOperation: z
            .object({
                id: z.uuid(),
                kind: z.enum(CERTIFICATE_OPERATION_KINDS),
                stage: z.enum(CERTIFICATE_OPERATION_STAGES),
                startedAt: timestamp,
                updatedAt: timestamp,
            })
            .nullable()
            .optional(),
        challengeType: z.enum(ACME_CHALLENGE_TYPES).nullable().optional(),
        issuedAt: timestamp.nullable(),
        expiresAt: timestamp.nullable(),
        issuer: z.string().max(512).nullable(),
        fingerprint: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/u)
            .nullable(),
        candidate: z
            .object({
                fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
                issuedAt: timestamp,
                expiresAt: timestamp,
                lastErrorCode: z.enum(CERTIFICATE_ERROR_CODES).nullable(),
                nextAttemptAt: timestamp.nullable(),
            })
            .nullable()
            .optional(),
        dnsCleanupPending: z.boolean().optional(),
        lastErrorCode: z.enum(CERTIFICATE_ERROR_CODES).nullable(),
        updatedAt: timestamp,

        nextAttemptAt: timestamp.nullable().optional(),
        attemptCount: z.number().int().nonnegative().optional(),
        lastAttemptAt: timestamp.nullable().optional(),
        lastSuccessAt: timestamp.nullable().optional(),
        nextRenewalAt: timestamp.nullable().optional(),
        lastActivatedAt: timestamp.nullable().optional(),
        lastErrorAt: timestamp.nullable().optional(),
    })
    .superRefine((certificate, context) => {
        if (
            (certificate.source === 'manual' && certificate.environment !== null) ||
            (certificate.source === 'acme' && certificate.environment === null) ||
            (certificate.status === 'valid' &&
                (!certificate.issuedAt ||
                    !certificate.expiresAt ||
                    !certificate.fingerprint ||
                    certificate.domains.length === 0 ||
                    Date.parse(certificate.issuedAt) >= Date.parse(certificate.expiresAt)))
        )
            context.addIssue({ code: 'custom', message: 'Invalid certificate metadata.' })
        if (
            certificate.candidate &&
            Date.parse(certificate.candidate.issuedAt) >=
                Date.parse(certificate.candidate.expiresAt)
        )
            context.addIssue({ code: 'custom', message: 'Invalid candidate metadata.' })
    })

export const CERTIFICATE_EVENT_MAX_PAGE_SIZE = 200

const CERTIFICATE_EVENT_CURSOR_MAX_BYTES = 57

const MAX_EVENT_SEQUENCE = 18_446_744_073_709_551_615n

const certificateEventIdSchema = z.uuidv7().refine((value) => value === value.toLowerCase())

export const certificateEventCursorSchema = z
    .string()
    .max(CERTIFICATE_EVENT_CURSOR_MAX_BYTES)
    .refine((value) => {
        const separator = value.indexOf(':')
        if (separator <= 0 || separator !== value.lastIndexOf(':')) return false
        const storeId = value.slice(0, separator)
        const sequence = value.slice(separator + 1)
        if (
            storeId !== storeId.toLowerCase() ||
            !certificateEventIdSchema.safeParse(storeId).success ||
            !/^\d{1,20}$/u.test(sequence)
        )
            return false
        try {
            return BigInt(sequence) <= MAX_EVENT_SEQUENCE
        } catch {
            return false
        }
    })

const certificateEventSchema = z.object({
    id: certificateEventIdSchema,
    operationId: certificateEventIdSchema,
    certificateId: certificateEventIdSchema,
    kind: z.enum(CERTIFICATE_EVENT_KINDS),
    stage: z.enum(CERTIFICATE_OPERATION_STAGES),
    occurredAt: timestamp,
    errorCode: z.enum(CERTIFICATE_ERROR_CODES).nullable(),
})

export const certificateEventPageSchema = z
    .object({
        events: z.array(certificateEventSchema).max(CERTIFICATE_EVENT_MAX_PAGE_SIZE),
        nextCursor: certificateEventCursorSchema,
        hasMore: z.boolean(),
        resetRequired: z.boolean(),
    })
    .superRefine((page, context) => {
        const ids = new Set<string>()
        for (const [index, event] of page.events.entries()) {
            if (ids.has(event.id)) {
                context.addIssue({
                    code: 'custom',
                    path: ['events', index, 'id'],
                    message: 'Event IDs must be unique within a page.',
                })
            }
            ids.add(event.id)
        }
    })
