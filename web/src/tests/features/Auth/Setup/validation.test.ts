import { describe, expect, test } from 'bun:test'

import { setupInputSchema } from '@/features/Auth/Setup/validation.ts'
import { acceptInviteInputSchema } from '@/features/Auth/AcceptInvite/validation.ts'
import { tokenPasswordInputSchema } from '@/features/Auth/PasswordReset/validation.ts'
import { changePasswordInputSchema } from '@/features/UserSettings/validation.ts'
import { loginInputSchema } from '@/features/Auth/Login/validation.ts'
import { credentialPasswordSchema, emailSchema, newPasswordSchema } from '@/lib/Auth/validation.ts'

describe('authentication validation', () => {
    test('normalizes email comparison casing and surrounding whitespace', () => {
        expect(emailSchema.parse('  Owner@Example.COM ')).toBe('owner@example.com')
    })

    test('requires twelve characters for new account passwords and preserves legacy login credentials', () => {
        for (const password of ['', 'x', 'x'.repeat(11), 'x'.repeat(257)]) {
            expect(newPasswordSchema.safeParse(password).success).toBeFalse()
            const input = {
                displayName: 'Owner',
                email: 'owner@example.test',
                password,
                confirmPassword: password,
                token: 'a'.repeat(43),
            }
            for (const schema of [
                setupInputSchema,
                acceptInviteInputSchema,
                tokenPasswordInputSchema,
                changePasswordInputSchema,
            ]) {
                expect(schema.safeParse(input).success).toBeFalse()
            }
        }
        for (const password of ['x'.repeat(12), 'x'.repeat(256)]) {
            expect(newPasswordSchema.safeParse(password).success).toBeTrue()
        }
        expect(credentialPasswordSchema.parse('x')).toBe('x')
        expect(
            loginInputSchema.safeParse({ email: 'owner@example.test', password: 'x' }).success,
        ).toBeTrue()
    })

    test('does not trim or otherwise mutate passwords', () => {
        const password = '  spaces stay here  '

        expect(newPasswordSchema.parse(password)).toBe(password)
    })

    test('keeps the password limit in UTF-16 code units for astral characters', () => {
        const atLimit = '😀'.repeat(128)
        const overLimit = '😀'.repeat(129)

        expect(atLimit.length).toBe(256)
        expect(overLimit.length).toBe(258)

        for (const schema of [credentialPasswordSchema, newPasswordSchema]) {
            expect(schema.safeParse(atLimit).success).toBeTrue()

            const result = schema.safeParse(overLimit)
            expect(result.success).toBeFalse()
            if (!result.success) {
                expect(result.error.issues[0]).toMatchObject({
                    code: 'too_big',
                    origin: 'string',
                    maximum: 256,
                    inclusive: true,
                    message: 'Password must contain at most 256 characters.',
                })
            }
        }
    })

    test('associates confirmation mismatch with the confirmation field', () => {
        const result = setupInputSchema.safeParse({
            displayName: 'First Owner',
            email: 'owner@example.com',
            password: 'a secure phrase',
            confirmPassword: 'a different phrase',
        })

        expect(result.success).toBeFalse()

        if (!result.success) {
            expect(result.error.issues[0]?.path).toEqual(['confirmPassword'])
        }
    })
})
