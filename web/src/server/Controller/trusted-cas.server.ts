import type { ControllerTrustedCaMetadata } from './Types/trusted-cas.types.ts'
import { metadataSchema } from './trusted-cas.validation.ts'
import '@tanstack/react-start/server-only'

import { z } from 'zod'

import { MAX_TRUSTED_CA_PEM_BYTES } from '@/config/trusted-cas.config.ts'
import { TrustedCaDomainError } from '@/server/Admin/TrustedCaManagement/trusted-cas.errors.ts'
import { CONTROLLER_APPLY_TIMEOUT_MS } from '../../config/controller.config.ts'
import { controllerRequest } from './transport.server.ts'

const errorSchema = z.object({
    error: z.enum(['invalid_trusted_ca', 'invalid_configuration', 'payload_too_large']),
})

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
