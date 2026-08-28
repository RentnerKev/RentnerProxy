import { z } from 'zod'

import {
    addPasswordConfirmationIssue,
    credentialPasswordSchema,
    newPasswordSchema,
} from '../Shared/validation'

export const changePasswordInputSchema = z
    .object({
        currentPassword: credentialPasswordSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)
