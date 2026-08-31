import '@tanstack/react-start/server-only'

import { z } from 'zod'
import {
    ACME_ENVIRONMENTS,
    CERTIFICATE_ERROR_CODES,
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
        issuedAt: timestamp.nullable(),
        expiresAt: timestamp.nullable(),
        issuer: z.string().max(512).nullable(),
        fingerprint: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/u)
            .nullable(),
        lastErrorCode: z.enum(CERTIFICATE_ERROR_CODES).nullable(),
        updatedAt: timestamp,
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
    })

export type ControllerCertificateMetadata = z.infer<typeof certificateMetadataSchema>
const errorSchema = z.object({ error: z.enum(CERTIFICATE_ERROR_CODES) })
const RESPONSE_LIMIT = 8 * 1_024 * 1_024

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
        ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
        acceptTerms: input.acceptTerms,
    })
    return parseMetadata(
        await controllerRequest(`${certificatePath(certificateId)}/issue`, {
            privileged: true,
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
