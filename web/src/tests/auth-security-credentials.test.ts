import { describe, expect, test } from 'bun:test'
import * as OTPAuth from 'otpauth'

import {
    RECOVERY_CODE_COUNT,
    TOTP_ALGORITHM,
    TOTP_DIGITS,
    TOTP_ISSUER,
    TOTP_PERIOD_SECONDS,
    TOTP_SECRET_BYTES,
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
    test('creates independent 256-bit secrets and an explicit SHA256 otpauth URI', () => {
        const first = createTotpSecret()
        const second = createTotpSecret()
        const uri = new URL(createTotpUri(first, 'security-test@example.invalid'))

        expect(TOTP_ALGORITHM).toBe('SHA256')
        expect(TOTP_SECRET_BYTES).toBe(32)
        expect(first).toMatch(/^[A-Z2-7]{52}$/)
        expect(second).toMatch(/^[A-Z2-7]{52}$/)
        expect(second).not.toBe(first)
        expect(OTPAuth.Secret.fromBase32(first).bytes).toHaveLength(TOTP_SECRET_BYTES)
        expect(OTPAuth.Secret.fromBase32(second).bytes).toHaveLength(TOTP_SECRET_BYTES)
        expect(uri.protocol).toBe('otpauth:')
        expect(uri.hostname).toBe('totp')
        expect(decodeURIComponent(uri.pathname)).toBe('/RentnerProxy:security-test@example.invalid')
        expect(uri.searchParams.get('issuer')).toBe(TOTP_ISSUER)
        expect(uri.searchParams.get('algorithm')).toBe('SHA256')
        expect(uri.searchParams.get('digits')).toBe(String(TOTP_DIGITS))
        expect(uri.searchParams.get('period')).toBe(String(TOTP_PERIOD_SECONDS))
        expect(uri.searchParams.get('secret')).toBe(first)
    })

    test('matches the RFC 6238 SHA256 vectors', () => {
        const secret = OTPAuth.Secret.fromUTF8('12345678901234567890123456789012')
        const rfcTotp = new OTPAuth.TOTP({
            algorithm: 'SHA256',
            digits: 8,
            period: TOTP_PERIOD_SECONDS,
            secret,
        })
        const vectors = [
            [59, '46119246'],
            [1_111_111_109, '68084774'],
            [1_111_111_111, '67062674'],
            [1_234_567_890, '91819424'],
            [2_000_000_000, '90698825'],
            [20_000_000_000, '77737706'],
        ] as const

        for (const [timestampSeconds, token] of vectors) {
            expect(rfcTotp.generate({ timestamp: timestampSeconds * 1_000 })).toBe(token)
        }
        expect(
            getMatchedTotpCounter(secret.base32, 'security-test@example.invalid', '119246', 59_000),
        ).toBe(1)
    })

    test('rejects a precomputed HMAC-SHA-1 code and undersized secrets', () => {
        const secret = OTPAuth.Secret.fromUTF8('12345678901234567890123456789012')
        const legacyTokenForTimestamp = '599872'
        const shortSecret = OTPAuth.Secret.fromUTF8('too-short').base32

        expect(
            getMatchedTotpCounter(
                secret.base32,
                'security-test@example.invalid',
                legacyTokenForTimestamp,
                59_000,
            ),
        ).toBeNull()

        let errorMessage = ''
        try {
            createTotpUri(shortSecret, 'security-test@example.invalid')
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error)
        }
        expect(errorMessage).toBe('Invalid TOTP secret.')
        expect(errorMessage).not.toContain(shortSecret)
    })

    test('accepts the configured clock window and rejects expired or malformed codes', () => {
        const secret = OTPAuth.Secret.fromUTF8('12345678901234567890123456789012').base32
        const totp = createTotp(secret)
        const timestamp = Date.UTC(2026, 7, 29, 12, 0, 15)
        const currentToken = totp.generate({ timestamp })
        const previousToken = totp.generate({ timestamp: timestamp - TOTP_PERIOD_SECONDS * 1_000 })
        const nextToken = totp.generate({ timestamp: timestamp + TOTP_PERIOD_SECONDS * 1_000 })
        const expiredToken = totp.generate({
            timestamp: timestamp - TOTP_PERIOD_SECONDS * 2_000,
        })
        const futureToken = totp.generate({
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
            getMatchedTotpCounter(secret, 'security-test@example.invalid', expiredToken, timestamp),
        ).toBeNull()
        expect(
            getMatchedTotpCounter(secret, 'security-test@example.invalid', futureToken, timestamp),
        ).toBeNull()
        for (const malformedToken of ['', '12345', '1234567', '12 345', 'ABCDEF', '１２３４５６']) {
            expect(
                getMatchedTotpCounter(
                    secret,
                    'security-test@example.invalid',
                    malformedToken,
                    timestamp,
                ),
            ).toBeNull()
        }
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
