import { describe, expect, test } from 'bun:test'

import { setupInputSchema } from '../features/Auth/Setup/validation'
import { emailSchema, newPasswordSchema } from '../features/Auth/Shared/validation'

describe('authentication validation', () => {
    test('normalizes email comparison casing and surrounding whitespace', () => {
        expect(emailSchema.parse('  Owner@Example.COM ')).toBe('owner@example.com')
    })

    test('accepts any non-empty password without strength rules', () => {
        expect(newPasswordSchema.safeParse('x').success).toBeTrue()
        expect(newPasswordSchema.safeParse(' ').success).toBeTrue()
        expect(newPasswordSchema.safeParse('').success).toBeFalse()
    })

    test('does not trim or otherwise mutate passwords', () => {
        const password = '  spaces stay here  '

        expect(newPasswordSchema.parse(password)).toBe(password)
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
