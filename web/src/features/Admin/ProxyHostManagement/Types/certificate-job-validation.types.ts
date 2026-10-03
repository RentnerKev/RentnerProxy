import type { z } from 'zod'

import type {
    hostCertificateRequestSchema,
    requestProxyHostCertificateInputSchema,
} from '../certificate-job-validation.ts'

export type HostCertificateRequest = z.input<typeof hostCertificateRequestSchema>

export type RequestProxyHostCertificateInput = z.input<
    typeof requestProxyHostCertificateInputSchema
>
