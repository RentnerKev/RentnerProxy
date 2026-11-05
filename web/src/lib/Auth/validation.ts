import { z } from 'zod'
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@/config/auth.config.ts'
import { hasMinimumNewPasswordLength, PASSWORD_TOO_LONG_MESSAGE } from './passwordPolicy.ts'

export const emailSchema = z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .max(254, 'Email address is too long.')
    .email('Enter a valid email address.')
    .transform((email) => email.toLowerCase())

export const displayNameSchema = z
    .string()
    .trim()
    .min(2, 'Display name must contain at least 2 characters.')
    .max(100, 'Display name must contain at most 100 characters.')

function enforcePasswordCodeUnitLimit(password: string, context: z.RefinementCtx) {
    if (password.length > PASSWORD_MAX_LENGTH) {
        context.addIssue({
            code: 'too_big',
            origin: 'string',
            maximum: PASSWORD_MAX_LENGTH,
            inclusive: true,
            message: PASSWORD_TOO_LONG_MESSAGE,
        })
    }
}

export const credentialPasswordSchema = z
    .string()
    .min(1, 'Enter your password.')
    .superRefine(enforcePasswordCodeUnitLimit)

export const newPasswordSchema = z
    .string()
    .superRefine((password, context) => {
        if (!hasMinimumNewPasswordLength(password)) {
            context.addIssue({
                code: 'too_small',
                origin: 'string',
                minimum: PASSWORD_MIN_LENGTH,
                inclusive: true,
                message: `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`,
            })
        }
    })
    .superRefine(enforcePasswordCodeUnitLimit)

export function addPasswordConfirmationIssue(
    values: { readonly password: string; readonly confirmPassword: string },
    context: z.RefinementCtx,
) {
    if (values.password !== values.confirmPassword) {
        context.addIssue({
            code: 'custom',
            path: ['confirmPassword'],
            message: 'Passwords do not match.',
        })
    }
}

export function getValidationMessage<T>(schema: z.ZodType<T>, value: unknown): string | undefined {
    const result = schema.safeParse(value)
    return result.success ? undefined : result.error.issues.at(0)?.message
}

export function getPasswordConfirmationMessage(
    password: string,
    confirmPassword: string,
): string | undefined {
    return password === confirmPassword ? undefined : 'Passwords do not match.'
}
