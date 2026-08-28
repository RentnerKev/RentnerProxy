import { z } from 'zod'

import { addPasswordConfirmationIssue, newPasswordSchema } from '../Shared/validation'

export const passwordConfirmationInputSchema = z
    .object({
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)

export const tokenPasswordInputSchema = z
    .object({
        token: z.string().min(43).max(128),
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)
