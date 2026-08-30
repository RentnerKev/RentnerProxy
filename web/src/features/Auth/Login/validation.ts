import { z } from 'zod'

import {
    authenticationResponseSchema,
    opaqueAuthChallengeSchema,
} from '../Shared/webauthn.validation'
import { credentialPasswordSchema, emailSchema } from '../Shared/validation'
import type { TwoFactorLoginMode } from './Types/login-security.types'

export const loginInputSchema = z.object({ email: emailSchema, password: credentialPasswordSchema })
export const getTwoFactorChallengeStatusInputSchema = z.object({})
export const completeTwoFactorLoginInputSchema = z
    .object({
        code: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        recoveryCode: z.string().trim().min(1).max(128).optional(),
    })
    .refine((value) => Boolean(value.code || value.recoveryCode), {
        message: 'A verification code is required.',
    })
export const twoFactorLoginFormSchema = z
    .object({
        mode: z.enum(['totp', 'recovery']),
        credential: z.string().max(128, 'Verification code is too long.'),
    })
    .superRefine((value, context) => {
        if (value.mode === 'totp' && !/^\d{6}$/.test(value.credential)) {
            context.addIssue({
                code: 'custom',
                path: ['credential'],
                message: 'Enter the six-digit code from your authenticator app.',
            })
        }
        if (value.mode === 'recovery' && !value.credential.trim()) {
            context.addIssue({
                code: 'custom',
                path: ['credential'],
                message: 'Enter one of your recovery codes.',
            })
        }
    })
export const beginPasskeyLoginInputSchema = z.object({})
export const finishPasskeyLoginInputSchema = z.object({
    challengeId: opaqueAuthChallengeSchema,
    response: authenticationResponseSchema,
})

export function normalizeTwoFactorCredential(mode: TwoFactorLoginMode, value: string): string {
    return mode === 'totp' ? value.replace(/\D/g, '').slice(0, 6) : value.slice(0, 128)
}

export function getTwoFactorCredentialError(
    mode: TwoFactorLoginMode,
    credential: string,
): string | undefined {
    const result = twoFactorLoginFormSchema.safeParse({ mode, credential })
    return result.success
        ? undefined
        : result.error.issues.find((issue) => issue.path.includes('credential'))?.message
}
