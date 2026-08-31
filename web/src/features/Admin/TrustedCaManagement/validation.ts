import { z } from 'zod'

import { MAX_TRUSTED_CA_PEM_BYTES } from '../../../config/trusted-cas.config'

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

const pem = z
    .string()
    .min(1, 'admin.trustedCas.validation.pem')
    .refine(
        (value) => new TextEncoder().encode(value).byteLength <= MAX_TRUSTED_CA_PEM_BYTES,
        'admin.trustedCas.validation.pemLimit',
    )
    .refine(
        (value) => !/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u.test(value),
        'admin.trustedCas.validation.pem',
    )
    .refine((value) => {
        const certificates = value.match(
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu,
        )
        return (
            certificates !== null &&
            certificates.join('').replaceAll('\r', '').replaceAll('\n', '') !== '' &&
            value
                .replaceAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu, '')
                .trim() === ''
        )
    }, 'admin.trustedCas.validation.pem')

export const trustedCaIdInputSchema = z.strictObject({ trustedCaId: z.uuidv7() })
export const createTrustedCaInputSchema = z.strictObject({ name, pem })
export const replaceTrustedCaInputSchema = createTrustedCaInputSchema.extend(
    trustedCaIdInputSchema.shape,
)

export type CreateTrustedCaInput = z.input<typeof createTrustedCaInputSchema>
export type ReplaceTrustedCaInput = z.input<typeof replaceTrustedCaInputSchema>
