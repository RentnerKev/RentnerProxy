import { z } from 'zod'

import { MAX_TRUSTED_CA_PEM_BYTES } from '@/config/trusted-cas.config.ts'

const name = z
    .string()
    .trim()
    .min(1, 'admin.trustedCas.validation.name')
    .max(120, 'admin.trustedCas.validation.name')
    .refine(
        (value) =>
            Array.from(value).every((character) => {
                const code = character.codePointAt(0) ?? 0
                return code >= 32 && code !== 127
            }),
        'admin.trustedCas.validation.name',
    )

const pem = z.string().superRefine((value, context) => {
    if (
        value.length > MAX_TRUSTED_CA_PEM_BYTES ||
        new TextEncoder().encode(value).byteLength > MAX_TRUSTED_CA_PEM_BYTES
    ) {
        context.addIssue({ code: 'custom', message: 'admin.trustedCas.validation.pemLimit' })
        return
    }

    let inCertificate = false
    let certificates = 0
    let valid = true
    for (const rawLine of value.split('\n')) {
        const line = rawLine.trim()
        if (line === '-----BEGIN CERTIFICATE-----' && !inCertificate) {
            inCertificate = true
        } else if (line === '-----END CERTIFICATE-----' && inCertificate) {
            inCertificate = false
            certificates += 1
        } else if (line !== '' && (!inCertificate || !/^[A-Za-z0-9+/=]+$/u.test(line))) {
            valid = false
            break
        }
    }
    if (!valid || inCertificate || certificates === 0) {
        context.addIssue({ code: 'custom', message: 'admin.trustedCas.validation.pem' })
    }
})

export const trustedCaIdInputSchema = z.strictObject({ trustedCaId: z.uuidv7() })
export const createTrustedCaInputSchema = z.strictObject({ name, pem })
export const replaceTrustedCaInputSchema = createTrustedCaInputSchema.extend(
    trustedCaIdInputSchema.shape,
)
