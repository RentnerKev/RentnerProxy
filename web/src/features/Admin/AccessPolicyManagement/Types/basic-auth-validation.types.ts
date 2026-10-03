import type { z } from 'zod'

import type {
    basicAuthAccountsPolicyInputSchema,
    createBasicAuthAccountInputSchema,
    updateBasicAuthAccountInputSchema,
    deleteBasicAuthAccountInputSchema,
} from '../basic-auth.validation.ts'

export type BasicAuthAccountsPolicyInput = z.input<typeof basicAuthAccountsPolicyInputSchema>

export type CreateBasicAuthAccountInput = z.input<typeof createBasicAuthAccountInputSchema>

export type UpdateBasicAuthAccountInput = z.input<typeof updateBasicAuthAccountInputSchema>

export type DeleteBasicAuthAccountInput = z.input<typeof deleteBasicAuthAccountInputSchema>
