import type { ControllerCertificateMetadata } from './Types/certificates.types.ts'
import {
    certificateMetadataSchema,
    certificateEventCursorSchema,
    certificateEventPageSchema,
    CERTIFICATE_EVENT_MAX_PAGE_SIZE,
} from './certificates.validation.ts'
import '@tanstack/react-start/server-only'

import { z } from 'zod'
import { DEFAULT_ACME_ENVIRONMENT, CERTIFICATE_ERROR_CODES } from '@/config/certificates.config.ts'
import type {
    ImportCertificateInput,
    RequestCertificateInput,
} from '@/features/Admin/CertificateManagement/Types/validation.types.ts'
import type { CertificateEventPage } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import { controllerRequest } from './transport.server.ts'
import { CONTROLLER_APPLY_TIMEOUT_MS } from '../../config/controller.config.ts'

const errorSchema = z.object({ error: z.enum(CERTIFICATE_ERROR_CODES) })
const RESPONSE_LIMIT = 8 * 1_024 * 1_024
const CERTIFICATE_EVENTS_RESPONSE_LIMIT = 512 * 1_024

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
            confidential: true,
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            method: 'POST',
            body,
            responseLimit: RESPONSE_LIMIT,
            acceptErrorResponse: true,
        }),
        certificateId.toLowerCase(),
    )
}

/** Requests certificate issuance from the controller using the shared ACME defaults. */
export async function issueControllerCertificate(
    certificateId: string,
    input: RequestCertificateInput,
): Promise<ControllerCertificateMetadata> {
    const body = JSON.stringify({
        domains: input.domains,
        environment: input.environment ?? DEFAULT_ACME_ENVIRONMENT,
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
