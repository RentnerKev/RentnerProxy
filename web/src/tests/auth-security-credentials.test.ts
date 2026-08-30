import { describe, expect, test } from 'bun:test'
import * as OTPAuth from 'otpauth'

import {
    RECOVERY_CODE_COUNT,
    TOTP_ALGORITHM,
    TOTP_DIGITS,
    TOTP_ISSUER,
    TOTP_PERIOD_SECONDS,
} from '../config/auth-security.config'
import {
    createRecoveryCodeBatch,
    createTotpSecret,
    createTotpUri,
    getMatchedTotpCounter,
    hashRecoveryCode,
    normalizeRecoveryCode,
} from '../server/Auth/TwoFactor/two-factor-credentials.server'

function createTotp(secret: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
        algorithm: TOTP_ALGORITHM,
        digits: TOTP_DIGITS,
        issuer: TOTP_ISSUER,
        label: 'security-test@example.invalid',
        period: TOTP_PERIOD_SECONDS,
        secret,
    })
}

describe('TOTP credentials', () => {
    test('creates independent 160-bit secrets and a standards-based otpauth URI', () => {
        const first = createTotpSecret()
        const second = createTotpSecret()
        const uri = createTotpUri(first, 'security-test@example.invalid')

        expect(first).toMatch(/^[A-Z2-7]{32}$/)
        expect(second).toMatch(/^[A-Z2-7]{32}$/)
        expect(second).not.toBe(first)
        expect(uri).toStartWith('otpauth://totp/')
        expect(uri).toContain('issuer=RentnerProxy')
        expect(uri).toContain('digits=6')
        expect(uri).toContain('period=30')
        expect(uri).toContain(`secret=${first}`)
    })

    test('accepts the configured clock window and rejects invalid or distant codes', () => {
        const secret = createTotpSecret()
        const totp = createTotp(secret)
        const timestamp = Date.UTC(2026, 7, 29, 12, 0, 15)
        const currentToken = totp.generate({ timestamp })
        const previousToken = totp.generate({ timestamp: timestamp - TOTP_PERIOD_SECONDS * 1_000 })
        const nextToken = totp.generate({ timestamp: timestamp + TOTP_PERIOD_SECONDS * 1_000 })
        const distantToken = totp.generate({
            timestamp: timestamp + TOTP_PERIOD_SECONDS * 2_000,
        })
        const expectedCounter = totp.counter({ timestamp })

        expect(
            getMatchedTotpCounter(secret, 'security-test@example.invalid', currentToken, timestamp),
        ).toBe(expectedCounter)
        expect(
            getMatchedTotpCounter(
                secret,
                'security-test@example.invalid',
                previousToken,
                timestamp,
            ),
        ).toBe(expectedCounter - 1)
        expect(
            getMatchedTotpCounter(secret, 'security-test@example.invalid', nextToken, timestamp),
        ).toBe(expectedCounter + 1)
        expect(
            getMatchedTotpCounter(secret, 'security-test@example.invalid', distantToken, timestamp),
        ).toBeNull()
        expect(
            getMatchedTotpCounter(secret, 'security-test@example.invalid', 'not-a-code', timestamp),
        ).toBeNull()
    })
})

describe('recovery code credentials', () => {
    test('generates ten unique 128-bit codes and stores only deterministic SHA-256 hashes', async () => {
        const credentials = await createRecoveryCodeBatch()
        const plaintextCodes = credentials.map((credential) => credential.plaintext)
        const hashes = credentials.map((credential) => credential.hash)

        expect(credentials).toHaveLength(RECOVERY_CODE_COUNT)
        expect(new Set(plaintextCodes).size).toBe(RECOVERY_CODE_COUNT)
        expect(new Set(hashes).size).toBe(RECOVERY_CODE_COUNT)
        expect(
            plaintextCodes.every((code) => /^[A-F\d]{4}(?:-[A-F\d]{4}){7}$/.test(code)),
        ).toBeTrue()
        expect(hashes.every((hash) => /^[a-f\d]{64}$/.test(hash))).toBeTrue()

        await Promise.all(
            credentials.map(async (credential) => {
                const normalized = normalizeRecoveryCode(credential.plaintext)
                expect(normalized).not.toBeNull()
                expect(credential.hash).toBe(await hashRecoveryCode(normalized ?? ''))
                expect(credential.hash).not.toContain(normalized ?? '')
            }),
        )
    })

    test('normalizes harmless formatting without accepting weak or malformed values', () => {
        const normalized = '0123456789ABCDEF0123456789ABCDEF'
        const formatted = '0123-4567-89ab-cdef-0123-4567-89ab-cdef'

        expect(normalizeRecoveryCode(formatted)).toBe(normalized)
        expect(normalizeRecoveryCode(`  ${formatted}  `)).toBe(normalized)
        expect(normalizeRecoveryCode('ABC123')).toBeNull()
        expect(normalizeRecoveryCode(`${formatted}00`)).toBeNull()
        expect(normalizeRecoveryCode('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toBeNull()
    })
})
