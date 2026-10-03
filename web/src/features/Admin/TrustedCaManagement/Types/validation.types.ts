import type { z } from 'zod'

import type { createTrustedCaInputSchema, replaceTrustedCaInputSchema } from '../validation.ts'

export type CreateTrustedCaInput = z.input<typeof createTrustedCaInputSchema>

export type ReplaceTrustedCaInput = z.input<typeof replaceTrustedCaInputSchema>
