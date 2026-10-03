import type { z } from 'zod'
import type { metadataSchema } from '../trusted-cas.validation.ts'

export type ControllerTrustedCaMetadata = z.infer<typeof metadataSchema>
