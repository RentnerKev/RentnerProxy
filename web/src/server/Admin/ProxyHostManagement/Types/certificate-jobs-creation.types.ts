import type { z } from 'zod'

import type {
    createProxyHostWithCertificateInputSchema,
    updateProxyHostWithCertificateInputSchema,
} from '@/features/Admin/ProxyHostManagement/certificate-job-validation.ts'

import type { requestCertificateInputSchema } from '@/features/Admin/CertificateManagement/validation.ts'

export type CreateJobInput = z.output<typeof createProxyHostWithCertificateInputSchema>

export type UpdateJobInput = z.output<typeof updateProxyHostWithCertificateInputSchema>

export type ParsedRequest = z.output<typeof requestCertificateInputSchema>
