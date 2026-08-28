import { z } from 'zod'

import {
    addPasswordConfirmationIssue,
    displayNameSchema,
    emailSchema,
    newPasswordSchema,
} from '../Shared/validation'

export const setupInputSchema = z
    .object({
        displayName: displayNameSchema,
        email: emailSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)
