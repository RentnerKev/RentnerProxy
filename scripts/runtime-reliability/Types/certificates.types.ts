export type CertificateState = { activeCaFile: string; issuanceCaFile: string; activeId: string }

import type { z } from 'zod'
import type { metadataSchema } from '../certificates.validation.ts'

export type CertificateMetadata = z.output<typeof metadataSchema>
