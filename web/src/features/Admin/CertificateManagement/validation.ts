import { z } from 'zod'
import {
    ACME_ENVIRONMENTS,
    MAX_CERTIFICATE_DOMAINS,
    MAX_CERTIFICATE_NAME_LENGTH,
    MAX_CERTIFICATE_PEM_LENGTH,
    MAX_PRIVATE_KEY_PEM_LENGTH,
} from '../../../config/certificates.config'
import { proxyHostDomainsSchema } from '../ProxyHostManagement/validation'
import { isPublicAcmeDomain } from './Helpers/certificateValidation'

const name = z
    .string()
    .trim()
    .min(1, 'admin.certificates.validation.name')
    .max(MAX_CERTIFICATE_NAME_LENGTH, 'admin.certificates.validation.name')
    .refine(
        (value) =>
            Array.from(value).every((character) => {
                const code = character.codePointAt(0) ?? 0
                return code >= 32 && code !== 127
            }),
        'admin.certificates.validation.name',
    )
const certificatePem = z
    .string()
    .min(1, 'admin.certificates.validation.certificatePem')
    .max(MAX_CERTIFICATE_PEM_LENGTH, 'admin.certificates.validation.pemLimit')
const privateKeyPem = z
    .string()
    .min(1, 'admin.certificates.validation.privateKeyPem')
    .max(MAX_PRIVATE_KEY_PEM_LENGTH, 'admin.certificates.validation.pemLimit')
const chainPem = z
    .string()
    .max(MAX_CERTIFICATE_PEM_LENGTH, 'admin.certificates.validation.pemLimit')
    .optional()

export const certificateIdInputSchema = z.strictObject({ certificateId: z.uuid() })
export const importCertificateInputSchema = z.strictObject({
    name,
    certificatePem,
    privateKeyPem,
    chainPem,
})
export const replaceCertificateInputSchema = importCertificateInputSchema.extend(
    certificateIdInputSchema.shape,
)
export const requestCertificateInputSchema = z.strictObject({
    name,
    domains: proxyHostDomainsSchema
        .max(MAX_CERTIFICATE_DOMAINS)
        .refine(
            (domains) => domains.every(isPublicAcmeDomain),
            'admin.certificates.validation.publicDomain',
        ),
    environment: z.enum(ACME_ENVIRONMENTS).default('staging'),
    contactEmail: z
        .union([z.email('admin.certificates.validation.email').max(254), z.literal('')])
        .optional(),
    acceptTerms: z.literal(true, 'admin.certificates.validation.terms'),
})
export type ImportCertificateInput = z.input<typeof importCertificateInputSchema>
export type ReplaceCertificateInput = z.input<typeof replaceCertificateInputSchema>
export type RequestCertificateInput = z.input<typeof requestCertificateInputSchema>
