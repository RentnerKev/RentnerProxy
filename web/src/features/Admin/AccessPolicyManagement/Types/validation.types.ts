import type { z } from 'zod'

import type { createAccessPolicyInputSchema, updateAccessPolicyInputSchema } from '../validation.ts'

export type CreateAccessPolicyInput = z.input<typeof createAccessPolicyInputSchema>

export type UpdateAccessPolicyInput = z.input<typeof updateAccessPolicyInputSchema>
