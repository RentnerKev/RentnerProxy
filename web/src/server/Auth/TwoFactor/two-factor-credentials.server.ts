import '@tanstack/react-start/server-only'

import * as OTPAuth from 'otpauth'

import {
    RECOVERY_CODE_BYTES,
    RECOVERY_CODE_COUNT,
    TOTP_ALGORITHM,
    TOTP_DIGITS,
    TOTP_ISSUER,
    TOTP_PERIOD_SECONDS,
    TOTP_SECRET_BYTES,
    TOTP_VALIDATION_WINDOW,
} from '../../../config/auth-security.config'

export interface RecoveryCodeCredential {
    readonly hash: string
    readonly plaintext: string
}

function parseTotpSecret(value: string): OTPAuth.Secret {
    let secret: OTPAuth.Secret

    try {
        secret = OTPAuth.Secret.fromBase32(value)
    } catch {
        throw new Error('Invalid TOTP secret.')
    }

    if (secret.bytes.byteLength < TOTP_SECRET_BYTES) {
        throw new Error('Invalid TOTP secret.')
    }

    return secret
}

function createTotp(secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
        algorithm: TOTP_ALGORITHM,
        digits: TOTP_DIGITS,
        issuer: TOTP_ISSUER,
        label,
        period: TOTP_PERIOD_SECONDS,
        secret: parseTotpSecret(secret),
    })
}

export function createTotpSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES))
    return new OTPAuth.Secret({ buffer: bytes.buffer }).base32
}

export function createTotpUri(secret: string, label: string): string {
    return createTotp(secret, label).toString()
}

export function getMatchedTotpCounter(
    secret: string,
    label: string,
    token: string,
    timestamp = Date.now(),
): number | null {
    if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(token)) {
        return null
    }

    const totp = createTotp(secret, label)
    const delta = totp.validate({ timestamp, token, window: TOTP_VALIDATION_WINDOW })

    return delta === null ? null : totp.counter({ timestamp }) + delta
}

function createRecoveryCode(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES)))
        .toString('hex')
        .toUpperCase()
}

function formatRecoveryCode(value: string): string {
    return value.match(/.{1,4}/g)?.join('-') ?? value
}

export function normalizeRecoveryCode(value: string): string | null {
    const normalized = value.trim().toUpperCase().replace(/[\s-]/g, '')
    return /^[A-F\d]{32}$/.test(normalized) ? normalized : null
}

export async function hashRecoveryCode(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Buffer.from(digest).toString('hex')
}

export async function createRecoveryCodeBatch(): Promise<Array<RecoveryCodeCredential>> {
    return Promise.all(
        Array.from({ length: RECOVERY_CODE_COUNT }, async () => {
            const rawCode = createRecoveryCode()
            return { hash: await hashRecoveryCode(rawCode), plaintext: formatRecoveryCode(rawCode) }
        }),
    )
}
