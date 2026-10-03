import { z } from 'zod'
import { MAX_TRUSTED_CA_PEM_BYTES } from '@/config/trusted-cas.config.ts'

const timestampSchema = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))

export const metadataSchema = z.object({
    pem: z.string().min(1).max(MAX_TRUSTED_CA_PEM_BYTES),
    fingerprintSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    subject: z.string().min(1).max(512),
    issuer: z.string().min(1).max(512),
    notBefore: timestampSchema,
    notAfter: timestampSchema,
})
