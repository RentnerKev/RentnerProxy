import { z } from 'zod'

import { AVAILABLE_LANGUAGES } from '../../config/language.config'
import { PROFILE_IMAGE_MAX_DATA_URL_LENGTH } from '../../config/profile-image.config'
import { USER_THEME_MODES } from '../../config/theme.config'
import { credentialPasswordSchema, newPasswordSchema } from '../Auth/Shared/validation'
import {
    authenticationResponseSchema,
    opaqueAuthChallengeSchema,
    registrationResponseSchema,
} from '../Auth/Shared/webauthn.validation'

export const updateLanguageInputSchema = z.object({
    language: z.enum(AVAILABLE_LANGUAGES),
})

export const updateThemeModeInputSchema = z.object({
    themeMode: z.enum(USER_THEME_MODES),
})

export const changePasswordInputSchema = z
    .object({
        currentPassword: credentialPasswordSchema,
        password: newPasswordSchema,
        confirmPassword: z.string(),
    })
    .superRefine(function (values, context) {
        if (values.password !== values.confirmPassword) {
            context.addIssue({
                code: 'custom',
                path: ['confirmPassword'],
                message: 'account.validation.passwordsDoNotMatch',
            })
        }
    })
export const updateProfileImageInputSchema = z.object({
    imageDataUrl: z
        .string()
        .max(PROFILE_IMAGE_MAX_DATA_URL_LENGTH)
        .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
})

export const emptySecurityInputSchema = z.object({})
export const beginPasskeyReauthenticationInputSchema = emptySecurityInputSchema
export const reauthenticatePasswordInputSchema = z.object({
    credential: z.string().min(1).max(256),
})
export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'account.validation.authenticatorCode')
export const totpSetupFormSchema = z.object({ code: totpCodeSchema })
export const confirmTotpSetupInputSchema = z.object({
    challengeId: opaqueAuthChallengeSchema,
    code: totpCodeSchema,
})
export const disableTotpInputSchema = emptySecurityInputSchema
export const renamePasskeyInputSchema = z.object({
    passkeyId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
})
export const removePasskeyInputSchema = z.object({
    passkeyId: z.string().uuid(),
})
export const finishPasskeyRegistrationInputSchema = z.object({
    challengeId: opaqueAuthChallengeSchema,
    name: z.string().trim().min(1).max(100).optional(),
    response: registrationResponseSchema,
})
export const finishPasskeyReauthenticationInputSchema = z.object({
    challengeId: opaqueAuthChallengeSchema,
    response: authenticationResponseSchema,
})
