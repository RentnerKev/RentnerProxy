import { z } from 'zod'

import {
    addPasswordConfirmationIssue,
    displayNameSchema,
    emailSchema,
    newPasswordSchema,
} from '../Shared/validation'
import { parseTrustedManagementOrigin } from '../../../config/management-origin.config'

export const managementOriginSchema = z
    .string()
    .trim()
    .max(2048, 'Management address is too long.')
    .refine((value) => parseTrustedManagementOrigin(value) !== null, {
        message: 'Enter an HTTPS address (HTTP is allowed only for localhost).',
    })
    .transform((value) => parseTrustedManagementOrigin(value)!)

export const setupInputSchema = z
    .object({
        displayName: displayNameSchema,
        email: emailSchema,
        managementOrigin: managementOriginSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(addPasswordConfirmationIssue)
