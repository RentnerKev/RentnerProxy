import type { z } from 'zod'
import type { certificateMetadataSchema } from '../certificates.validation.ts'

export type ControllerCertificateMetadata = z.infer<typeof certificateMetadataSchema>
