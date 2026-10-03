import type { z } from 'zod'

import type { createRedirectHostInputSchema, updateRedirectHostInputSchema } from '../validation.ts'

export type CreateRedirectHostInput = z.output<typeof createRedirectHostInputSchema>

export type UpdateRedirectHostInput = z.output<typeof updateRedirectHostInputSchema>
