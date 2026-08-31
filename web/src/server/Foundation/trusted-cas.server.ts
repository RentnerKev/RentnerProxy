import '@tanstack/react-start/server-only'

import { z } from 'zod'

import { MAX_TRUSTED_CA_PEM_BYTES } from '../../config/trusted-cas.config'
import { TrustedCaDomainError } from '../Admin/TrustedCaManagement/trusted-cas.errors'
import { CONTROLLER_APPLY_TIMEOUT_MS, controllerRequest } from './controller.server'

const timestampSchema = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
const metadataSchema = z.object({
    pem: z.string().min(1).max(MAX_TRUSTED_CA_PEM_BYTES),
    fingerprintSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    subject: z.string().min(1).max(512),
    issuer: z.string().min(1).max(512),
    notBefore: timestampSchema,
    notAfter: timestampSchema,
})
const errorSchema = z.object({
    error: z.enum(['invalid_trusted_ca', 'invalid_configuration', 'payload_too_large']),
})

export type ControllerTrustedCaMetadata = z.infer<typeof metadataSchema>

export async function validateControllerTrustedCa(
    pem: string,
): Promise<ControllerTrustedCaMetadata> {
    if (Buffer.byteLength(pem, 'utf8') > MAX_TRUSTED_CA_PEM_BYTES)
        throw new TrustedCaDomainError('invalid_input')
    const payload = await controllerRequest('/internal/v1/trusted-cas/validate', {
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        method: 'POST',
        privileged: true,
        body: JSON.stringify({ pem }),
        responseLimit: MAX_TRUSTED_CA_PEM_BYTES + 8_192,
        acceptErrorResponse: true,
    })
    if (errorSchema.safeParse(payload).success) throw new TrustedCaDomainError('invalid_input')
    const parsed = metadataSchema.safeParse(payload)
    if (!parsed.success || Date.parse(parsed.data.notBefore) >= Date.parse(parsed.data.notAfter))
        throw new TrustedCaDomainError('controller_unavailable')
    return parsed.data
}
