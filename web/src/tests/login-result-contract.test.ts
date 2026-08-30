import { describe, expect, test } from 'bun:test'

import type { LoginResult } from '../server/Auth/Core/Types/auth-service.types'

describe('login MFA result contract', () => {
    test('keeps the pre-MFA result free of a user and session', () => {
        const result: LoginResult = {
            challenge: {
                expiresAt: new Date('2026-08-29T12:00:00.000Z'),
                id: 'A'.repeat(43),
            },
            requiresTwoFactor: true,
            success: true,
        }

        expect(result.requiresTwoFactor).toBeTrue()
        expect('session' in result).toBeFalse()
        expect('user' in result).toBeFalse()
    })
})
