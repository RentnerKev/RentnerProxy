import { z } from 'zod'

import { PROFILE_IMAGE_MAX_DATA_URL_LENGTH } from '../../../config/profile-image.config'
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

export const updateProfileImageInputSchema = z.object({
    imageDataUrl: z
        .string()
        .max(PROFILE_IMAGE_MAX_DATA_URL_LENGTH)
        .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
})
