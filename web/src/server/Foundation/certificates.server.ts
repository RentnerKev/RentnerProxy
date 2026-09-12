import '@tanstack/react-start/server-only'

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
} from '../../config/certificates.config'
import type {
    ImportCertificateInput,
    RequestCertificateInput,
} from '../../features/Admin/CertificateManagement/validation'
import { normalizeCertificateDomain } from '../../features/Admin/CertificateManagement/Helpers/certificateValidation'
import type { CertificateEventPage } from '../../shared/Types/certificates.types'
import { CertificateDomainError } from '../Admin/CertificateManagement/certificates.errors'
import { controllerRequest, CONTROLLER_APPLY_TIMEOUT_MS } from './controller.server'

const timestamp = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
const certificateMetadataSchema = z
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

export type ControllerCertificateMetadata = z.infer<typeof certificateMetadataSchema>
const errorSchema = z.object({ error: z.enum(CERTIFICATE_ERROR_CODES) })
const RESPONSE_LIMIT = 8 * 1_024 * 1_024
const CERTIFICATE_EVENTS_RESPONSE_LIMIT = 512 * 1_024
const CERTIFICATE_EVENT_MAX_PAGE_SIZE = 200
const CERTIFICATE_EVENT_CURSOR_MAX_BYTES = 57
const MAX_EVENT_SEQUENCE = 18_446_744_073_709_551_615n
const certificateEventIdSchema = z.uuidv7().refine((value) => value === value.toLowerCase())

const certificateEventCursorSchema = z
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
const certificateEventPageSchema = z
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

function assertNoControllerError(payload: unknown): void {
    const error = errorSchema.safeParse(payload)
    if (error.success) throw new CertificateDomainError(error.data.error)
}

function parseMetadata(payload: unknown, certificateId: string): ControllerCertificateMetadata {
    assertNoControllerError(payload)
    const result = certificateMetadataSchema.safeParse(payload)
    if (!result.success || result.data.id !== certificateId) {
        throw new CertificateDomainError('controller_unavailable')
    }
    return result.data
}

function certificatePath(certificateId: string): `/internal/v1/certificates/${string}` {
    const id = z.uuid().safeParse(certificateId)
    if (!id.success) throw new CertificateDomainError('invalid_input')
    return `/internal/v1/certificates/${id.data.toLowerCase()}`
}

export async function getControllerCertificates(): Promise<ControllerCertificateMetadata[]> {
    const payload = await controllerRequest('/internal/v1/certificates', {
        privileged: true,
        timeoutMs: 2_000,
        responseLimit: RESPONSE_LIMIT,
        acceptErrorResponse: true,
    })
    assertNoControllerError(payload)
    const parsed = z
        .object({ certificates: z.array(certificateMetadataSchema).max(10_000) })
        .safeParse(payload)
    if (!parsed.success) throw new CertificateDomainError('controller_unavailable')
    return parsed.data.certificates
}

export async function getControllerCertificateEvents(
    after?: string | null,
    limit = 100,
): Promise<CertificateEventPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > CERTIFICATE_EVENT_MAX_PAGE_SIZE) {
        throw new CertificateDomainError('invalid_input')
    }
    if (
        after !== undefined &&
        after !== null &&
        !certificateEventCursorSchema.safeParse(after).success
    ) {
        throw new CertificateDomainError('invalid_input')
    }
    const searchParams = new URLSearchParams({ limit: String(limit) })
    if (after !== undefined && after !== null) searchParams.set('after', after)
    const path =
        `/internal/v1/certificates/events?${searchParams.toString()}` as `/internal/v1/certificates/events${string}`
    const payload = await controllerRequest(path, {
        privileged: true,
        timeoutMs: 5_000,
        responseLimit: CERTIFICATE_EVENTS_RESPONSE_LIMIT,
        acceptErrorResponse: true,
    })
    assertNoControllerError(payload)
    const parsed = certificateEventPageSchema.safeParse(payload)
    if (!parsed.success || parsed.data.events.length > limit)
        throw new CertificateDomainError('controller_unavailable')
    return parsed.data
}

export async function getControllerCertificate(
    certificateId: string,
): Promise<ControllerCertificateMetadata> {
    return parseMetadata(
        await controllerRequest(certificatePath(certificateId), {
            privileged: true,
            timeoutMs: 2_000,
            responseLimit: RESPONSE_LIMIT,
            acceptErrorResponse: true,
        }),
        certificateId.toLowerCase(),
    )
}

export async function importControllerCertificate(
    certificateId: string,
    input: Pick<ImportCertificateInput, 'certificatePem' | 'privateKeyPem' | 'chainPem'>,
    requiredDomains: readonly string[],
): Promise<ControllerCertificateMetadata> {
    const body = JSON.stringify({
        certificatePem: input.certificatePem,
        privateKeyPem: input.privateKeyPem,
        ...(input.chainPem ? { chainPem: input.chainPem } : {}),
        requiredDomains,
    })
    return parseMetadata(
        await controllerRequest(`${certificatePath(certificateId)}/import`, {
            privileged: true,
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            method: 'POST',
            body,
            responseLimit: RESPONSE_LIMIT,
            acceptErrorResponse: true,
        }),
        certificateId.toLowerCase(),
    )
}

export async function issueControllerCertificate(
    certificateId: string,
    input: RequestCertificateInput,
): Promise<ControllerCertificateMetadata> {
    const body = JSON.stringify({
        domains: input.domains,
        environment: input.environment ?? 'staging',
        challengeType: input.challengeType ?? 'http-01',
        ...(input.dnsProvider ? { dnsProvider: input.dnsProvider } : {}),
        ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
        acceptTerms: input.acceptTerms,
    })
    return parseMetadata(
        await controllerRequest(`${certificatePath(certificateId)}/issue`, {
            privileged: true,
            confidential: input.challengeType === 'dns-01' || input.dnsProvider !== undefined,
            timeoutMs: 5_000,
            method: 'POST',
            body,
            responseLimit: RESPONSE_LIMIT,
            acceptErrorResponse: true,
        }),
        certificateId.toLowerCase(),
    )
}

export async function renewControllerCertificate(
    certificateId: string,
): Promise<ControllerCertificateMetadata> {
    return parseMetadata(
        await controllerRequest(`${certificatePath(certificateId)}/renew`, {
            privileged: true,
            timeoutMs: 5_000,
            method: 'POST',
            body: '{}',
            responseLimit: RESPONSE_LIMIT,
            acceptErrorResponse: true,
        }),
        certificateId.toLowerCase(),
    )
}

export async function deleteControllerCertificate(certificateId: string): Promise<void> {
    const payload = await controllerRequest(certificatePath(certificateId), {
        privileged: true,
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        method: 'DELETE',
        responseLimit: RESPONSE_LIMIT,
        acceptErrorResponse: true,
    })
    const error = errorSchema.safeParse(payload)
    if (error.success && error.data.error === 'certificate_not_found') return
    assertNoControllerError(payload)
    if (!z.object({ deleted: z.literal(true) }).safeParse(payload).success) {
        throw new CertificateDomainError('controller_unavailable')
    }
}
