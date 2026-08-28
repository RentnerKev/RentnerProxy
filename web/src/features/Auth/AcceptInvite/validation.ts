import { z } from 'zod'

import {
    addPasswordConfirmationIssue,
    displayNameSchema,
    newPasswordSchema,
} from '../Shared/validation'

export const acceptInviteFormSchema = z
    .object({
        displayName: displayNameSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)

export const acceptInviteInputSchema = z
    .object({
        token: z.string().min(43).max(128),
        displayName: displayNameSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)
