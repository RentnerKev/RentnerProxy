import '@tanstack/react-start/server-only'

import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

import { MFA_CHALLENGE_COOKIE_NAME, SESSION_COOKIE_NAME } from '../../../config/auth.config'
import { AuthDomainError } from '../Core/errors.server'
import { isValidOpaqueToken } from '../Core/tokens.server'

const sharedCookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
}

export function getSessionCookie(): string | null {
    return getCookie(SESSION_COOKIE_NAME) ?? null
}

export function setSessionCookie(token: string, expiresAt: Date): void {
    if (!isValidOpaqueToken(token)) {
        throw new AuthDomainError('invalid_input', 'Session token format is invalid.')
    }

    setCookie(SESSION_COOKIE_NAME, token, {
        ...sharedCookieOptions,
        expires: expiresAt,
    })
}

export function clearSessionCookie(): void {
    deleteCookie(SESSION_COOKIE_NAME, sharedCookieOptions)
}

export function getMfaChallengeCookie(): string | null {
    const value = getCookie(MFA_CHALLENGE_COOKIE_NAME)
    return value && isValidOpaqueToken(value) ? value : null
}

export function setMfaChallengeCookie(challengeId: string, expiresAt: Date): void {
    if (!isValidOpaqueToken(challengeId)) {
        throw new AuthDomainError('invalid_input', 'Challenge token format is invalid.')
    }

    setCookie(MFA_CHALLENGE_COOKIE_NAME, challengeId, {
        ...sharedCookieOptions,
        expires: expiresAt,
    })
}

export function clearMfaChallengeCookie(): void {
    deleteCookie(MFA_CHALLENGE_COOKIE_NAME, sharedCookieOptions)
}
