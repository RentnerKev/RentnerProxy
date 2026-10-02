import { z } from 'zod'
import { requestCertificateInputSchema } from '@/features/Admin/CertificateManagement/validation.ts'
import { createProxyHostInputSchema, updateProxyHostInputSchema } from './validation.ts'

const requestFields = requestCertificateInputSchema.shape
export const hostCertificateRequestSchema = z.strictObject({
    name: requestFields.name,
    environment: requestFields.environment,
    challengeType: requestFields.challengeType,
    dnsProvider: requestFields.dnsProvider,
    contactEmail: requestFields.contactEmail,
    acceptTerms: requestFields.acceptTerms,
})

const idempotencyKey = z.uuid().transform((value) => value.toLowerCase())
export const createProxyHostWithCertificateInputSchema = z.strictObject({
    idempotencyKey,
    host: createProxyHostInputSchema,
    request: hostCertificateRequestSchema,
})
export const updateProxyHostWithCertificateInputSchema = z.strictObject({
    idempotencyKey,
    host: updateProxyHostInputSchema,
    request: hostCertificateRequestSchema,
})
export const requestProxyHostCertificateInputSchema = z.strictObject({
    idempotencyKey,
    proxyHostId: z.uuid(),
    expectedUpdatedAt: z.iso.datetime(),
    request: hostCertificateRequestSchema,
})
export const certificateJobIdInputSchema = z.strictObject({ jobId: z.uuidv7() })

export type HostCertificateRequest = z.input<typeof hostCertificateRequestSchema>
export type RequestProxyHostCertificateInput = z.input<
    typeof requestProxyHostCertificateInputSchema
>
