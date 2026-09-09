import { describe, expect, test } from 'bun:test'

import { setupInputSchema } from '../features/Auth/Setup/validation'
import {
    credentialPasswordSchema,
    emailSchema,
    newPasswordSchema,
} from '../features/Auth/Shared/validation'

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
            managementOrigin: 'https://admin.example.com',
            password: 'a secure phrase',
            confirmPassword: 'a different phrase',
        })

        expect(result.success).toBeFalse()

        if (!result.success) {
            expect(result.error.issues[0]?.path).toEqual(['confirmPassword'])
        }
    })
})
