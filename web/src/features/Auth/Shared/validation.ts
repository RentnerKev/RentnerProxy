import { z } from 'zod'

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

export const credentialPasswordSchema = z
    .string()
    .min(1, 'Enter your password.')
    .max(256, 'Password must contain at most 256 characters.')

export const newPasswordSchema = z
    .string()
    .min(12, 'Password must contain at least 12 characters.')
    .max(256, 'Password must contain at most 256 characters.')

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
