import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { createServerFn } from '@tanstack/react-start'

import {
    clearMfaChallengeCookie,
    getMfaChallengeCookie,
    setMfaChallengeCookie,
    setSessionCookie,
} from '../../../server/Auth/Access/cookies.server'
import { loginService } from '../../../server/Auth/Login/login.service'
import {
    beginDiscoverablePasskeyAuthenticationService,
    finishDiscoverablePasskeyAuthenticationService,
} from '../../../server/Auth/Passkey/passkey.service'
import {
    completeLoginMfaWithRecoveryCodeService,
    completeLoginMfaWithTotpService,
    getTwoFactorStatusService,
} from '../../../server/Auth/TwoFactor/two-factor.service'
import { getAuthChallenge } from '../../../server/redis/auth-challenges.service'
import {
    actionFailure,
    AUTH_UNAVAILABLE_MESSAGE,
    enforceAnonymousSensitiveLimit,
    enforceSensitiveLimit,
    GENERIC_LOGIN_MESSAGE,
    type AuthActionResult,
    throwPublicQueryError,
} from '../serverHelpers'
import {
    beginPasskeyLoginInputSchema,
    completeTwoFactorLoginInputSchema,
    finishPasskeyLoginInputSchema,
    getTwoFactorChallengeStatusInputSchema,
    loginInputSchema,
} from './validation'

type TwoFactorLoginActionResult = AuthActionResult & {
    readonly restartLogin?: boolean
}

export const loginHandler = createServerFn({ method: 'POST' })
    .validator(loginInputSchema)
    .handler(async ({ data }) => {
        clearMfaChallengeCookie()
        try {
            await enforceSensitiveLimit('login', data.email)
            const result = await loginService(data)
            if (!result.success) return { success: false as const, message: GENERIC_LOGIN_MESSAGE }
            if (result.requiresTwoFactor) {
                setMfaChallengeCookie(result.challenge.id, result.challenge.expiresAt)
                return {
                    success: false as const,
                    message: 'Additional verification required.',
                    requiresTwoFactor: true as const,
                }
            }
            setSessionCookie(result.session.token, result.session.expiresAt)
            return { success: true as const, message: 'Signed in.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })

export const getTwoFactorChallengeStatusHandler = createServerFn({ method: 'GET' })
    .validator(getTwoFactorChallengeStatusInputSchema)
    .handler(async () => {
        try {
            const challengeId = getMfaChallengeCookie()
            if (!challengeId) return { methods: [] as const, valid: false as const }
            const challenge = await getAuthChallenge('login-mfa', challengeId)
            if (!challenge) {
                clearMfaChallengeCookie()
                return { methods: [] as const, valid: false as const }
            }
            const status = await getTwoFactorStatusService(challenge.userId)
            if (!status.totpEnabled) {
                clearMfaChallengeCookie()
                return { methods: [] as const, valid: false as const }
            }
            return {
                methods:
                    status.recoveryCodesRemaining > 0
                        ? (['totp', 'recovery'] as const)
                        : (['totp'] as const),
                valid: true as const,
            }
        } catch (error) {
            throwPublicQueryError(error)
        }
    })

export const completeTwoFactorLoginHandler = createServerFn({ method: 'POST' })
    .validator(completeTwoFactorLoginInputSchema)
    .handler(async ({ data }): Promise<TwoFactorLoginActionResult> => {
        const challengeId = getMfaChallengeCookie()
        if (!challengeId) {
            return {
                success: false,
                message: 'Authentication request expired. Sign in again.',
                restartLogin: true,
            }
        }
        try {
            const challenge = await getAuthChallenge('login-mfa', challengeId)
            if (!challenge) {
                clearMfaChallengeCookie()
                return {
                    success: false,
                    message: 'Authentication request expired. Sign in again.',
                    restartLogin: true,
                }
            }
            await enforceSensitiveLimit('login', challenge.userId)
            const result = data.code
                ? await completeLoginMfaWithTotpService({ challengeId, token: data.code })
                : await completeLoginMfaWithRecoveryCodeService({
                      challengeId,
                      recoveryCode: data.recoveryCode ?? '',
                  })
            if (!result.success) {
                if (result.code === 'challenge_expired') {
                    clearMfaChallengeCookie()
                    return {
                        success: false,
                        message: 'Authentication failed. Sign in again.',
                        restartLogin: true,
                    }
                }
                return { success: false, message: 'Authentication failed.' }
            }
            clearMfaChallengeCookie()
            setSessionCookie(result.session.token, result.session.expiresAt)
            return { success: true, message: 'Signed in.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })

export const beginPasskeyLoginHandler = createServerFn({ method: 'POST' })
    .validator(beginPasskeyLoginInputSchema)
    .handler(async () => {
        try {
            await enforceAnonymousSensitiveLimit('login', 'passkey-login')
            const result = await beginDiscoverablePasskeyAuthenticationService()
            return {
                challengeId: result.flowId,
                message: 'Passkey challenge ready.',
                options: result.options,
                success: true as const,
            }
        } catch (error) {
            return actionFailure(error, 'Passkey sign-in is temporarily unavailable.')
        }
    })

export const finishPasskeyLoginHandler = createServerFn({ method: 'POST' })
    .validator(finishPasskeyLoginInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await enforceSensitiveLimit('login', data.response.id)
            const result = await finishDiscoverablePasskeyAuthenticationService({
                flowId: data.challengeId,
                response: data.response as unknown as AuthenticationResponseJSON,
            })
            if (!result.success) return { success: false, message: 'Authentication failed.' }
            clearMfaChallengeCookie()
            setSessionCookie(result.session.token, result.session.expiresAt)
            return { success: true, message: 'Signed in.' }
        } catch (error) {
            return actionFailure(error, AUTH_UNAVAILABLE_MESSAGE)
        }
    })
