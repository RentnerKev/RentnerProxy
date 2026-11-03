import type { z } from 'zod'
import type { oidcFeedbackCodeSchema } from '../validation.ts'

export type OidcFeedbackCode = z.infer<typeof oidcFeedbackCodeSchema>
