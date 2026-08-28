import { z } from 'zod'

import { credentialPasswordSchema, emailSchema } from '../Shared/validation'

export const loginInputSchema = z.object({
    email: emailSchema,
    password: credentialPasswordSchema,
})
