import { z } from 'zod'
import {
    ACME_CHALLENGE_TYPES,
    ACME_ENVIRONMENTS,
    MAX_CERTIFICATE_DOMAINS,
    MAX_CERTIFICATE_NAME_LENGTH,
    MAX_CERTIFICATE_PEM_LENGTH,
    MAX_PRIVATE_KEY_PEM_LENGTH,
} from '../../../config/certificates.config'
import { isPublicAcmeDomain, normalizeCertificateDomain } from './Helpers/certificateValidation'

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

const certificateDomainsSchema = z
    .array(
        z
            .string()
            .max(1_024, 'admin.certificates.validation.publicDomain')
            .transform((value, context) => {
                const domain = normalizeCertificateDomain(value)
                if (!domain) {
                    context.addIssue({
                        code: 'custom',
                        message: 'admin.certificates.validation.publicDomain',
                    })
                    return z.NEVER
                }
                return domain
            }),
    )
    .min(1, 'admin.certificates.validation.publicDomain')
    .max(MAX_CERTIFICATE_DOMAINS, 'admin.certificates.validation.publicDomain')
    .superRefine((domains, context) => {
        const seen = new Set<string>()
        for (const [index, domain] of domains.entries()) {
            if (seen.has(domain)) {
                context.addIssue({
                    code: 'custom',
                    path: [index],
                    message: 'admin.certificates.validation.duplicateDomain',
                })
            }
            seen.add(domain)
        }
    })

const dnsApiTokenSchema = z
    .string()
    .min(1, 'admin.certificates.validation.dnsApiToken')
    .max(512, 'admin.certificates.validation.dnsApiToken')
    .regex(/^[\x21-\x7e]+$/u, 'admin.certificates.validation.dnsApiToken')
const dnsProviderSchema = z.strictObject({
    type: z.literal('cloudflare'),
    zoneId: z.string().regex(/^[a-f0-9]{32}$/u, 'admin.certificates.validation.dnsZoneId'),
    apiToken: dnsApiTokenSchema,
})

export const requestCertificateInputSchema = z
    .strictObject({
        name,
        domains: certificateDomainsSchema,
        environment: z.enum(ACME_ENVIRONMENTS).default('staging'),
        challengeType: z.enum(ACME_CHALLENGE_TYPES).default('http-01'),
        dnsProvider: dnsProviderSchema.optional(),
        contactEmail: z
            .union([z.email('admin.certificates.validation.email').max(254), z.literal('')])
            .optional(),
        acceptTerms: z.literal(true, 'admin.certificates.validation.terms'),
    })
    .superRefine((request, context) => {
        const allowWildcard = request.challengeType === 'dns-01'
        const hasWildcard = request.domains.some((domain) => domain.startsWith('*.'))
        if (hasWildcard && !allowWildcard) {
            context.addIssue({
                code: 'custom',
                path: ['domains'],
                message: 'admin.certificates.validation.wildcardRequiresDns01',
            })
        } else if (!request.domains.every((domain) => isPublicAcmeDomain(domain, allowWildcard))) {
            context.addIssue({
                code: 'custom',
                path: ['domains'],
                message: 'admin.certificates.validation.publicDomain',
            })
        }
        if (request.challengeType === 'dns-01' && !request.dnsProvider) {
            context.addIssue({
                code: 'custom',
                path: ['dnsProvider'],
                message: 'admin.certificates.validation.dnsProviderRequired',
            })
        }
        if (request.challengeType === 'http-01' && request.dnsProvider) {
            context.addIssue({
                code: 'custom',
                path: ['dnsProvider'],
                message: 'admin.certificates.validation.dnsProviderHttp',
            })
        }
    })

export interface CertificateRequestFormValues {
    readonly name: string
    readonly domains: string[]
    readonly environment: string
    readonly challengeType: string
    readonly dnsZoneId: string
    readonly dnsApiToken: string
    readonly contactEmail: string
    readonly acceptTerms: boolean
}

export function certificateRequestInputFromForm(
    value: CertificateRequestFormValues,
): Record<string, unknown> {
    const { dnsZoneId, dnsApiToken, ...requestValues } = value
    return {
        ...requestValues,
        ...(value.challengeType === 'dns-01'
            ? {
                  dnsProvider: {
                      type: 'cloudflare',
                      zoneId: dnsZoneId,
                      apiToken: dnsApiToken,
                  },
              }
            : {}),
    }
}

function formIssuePath(path: readonly PropertyKey[]): PropertyKey[] {
    if (path[0] !== 'dnsProvider') return [...path]
    if (path[1] === 'zoneId') return ['dnsZoneId']
    if (path[1] === 'apiToken') return ['dnsApiToken']
    return ['dnsZoneId']
}

export const certificateRequestFormSchema = z
    .strictObject({
        name: z.string(),
        domains: z.array(z.string()),
        environment: z.string(),
        challengeType: z.string(),
        dnsZoneId: z.string(),
        dnsApiToken: z.string(),
        contactEmail: z.string(),
        acceptTerms: z.boolean(),
    })
    .superRefine((value, context) => {
        const result = requestCertificateInputSchema.safeParse(
            certificateRequestInputFromForm(value),
        )
        if (result.success) return
        for (const issue of result.error.issues) {
            context.addIssue({
                code: 'custom',
                path: formIssuePath(issue.path),
                message: issue.message,
            })
        }
    })
export type ImportCertificateInput = z.input<typeof importCertificateInputSchema>
export type ReplaceCertificateInput = z.input<typeof replaceCertificateInputSchema>
export type RequestCertificateInput = z.input<typeof requestCertificateInputSchema>
