import { beforeEach, expect, mock, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
const boundary = createMiddlewareHarness()
let cookie: string | null = null
const clear = mock(() => {
    cookie = null
    boundary.calls.push({ name: 'clearCookie', arguments: [] })
})
const session = mock((...values: unknown[]) =>
    boundary.calls.push({ name: 'sessionCookie', arguments: values }),
)
const challengeCookie = mock((id: string, expires: unknown) => {
    cookie = id
    boundary.calls.push({ name: 'challengeCookie', arguments: [id, expires] })
})
mock.module('@/server/Auth/Access/cookies.server.ts', () => ({
    clearMfaChallengeCookie: clear,
    getMfaChallengeCookie: () => cookie,
    setMfaChallengeCookie: challengeCookie,
    setSessionCookie: session,
}))
boundary.mockServices('@/server/Auth/Login/login.service.ts', ['loginService'])
boundary.mockServices('@/server/Auth/Passkey/passkey.service.ts', [
    'beginDiscoverablePasskeyAuthenticationService',
    'finishDiscoverablePasskeyAuthenticationService',
])
boundary.mockServices('@/server/Auth/TwoFactor/two-factor.service.ts', [
    'completeLoginMfaWithRecoveryCodeService',
    'completeLoginMfaWithTotpService',
    'getTwoFactorStatusService',
])
boundary.mockServices('@/server/Valkey/auth-challenges.service.ts', ['getAuthChallenge'])
boundary.mockServices(
    '@/server/Auth/transport.server.ts',
    ['enforceSensitiveLimit', 'enforceAnonymousSensitiveLimit', 'enforceLoginMfaLimit'],
    {
        AUTH_UNAVAILABLE_MESSAGE: 'public-unavailable',
        GENERIC_LOGIN_MESSAGE: 'generic-login',
        actionFailure: (error: unknown, fallback: string) => {
            boundary.calls.push({ name: 'actionFailure', arguments: [error, fallback] })
            return { success: false, message: fallback }
        },
        throwPublicQueryError: (error: unknown): never => {
            boundary.calls.push({ name: 'publicError', arguments: [error] })
            throw new Error('public-query-unavailable')
        },
    },
)
const handlers = await import('@/features/Auth/Login/middleware.ts')
const challenge = 'A'.repeat(43)
const expiresAt = new Date('2030-01-01T00:00:00Z')
const authenticated = { success: true, session: { token: 'fixture-session', expiresAt } }
const credentials = { email: 'fixture@example.com', password: 'fixture-password' }
const assertion = {
    id: 'YQ',
    rawId: 'YQ',
    type: 'public-key',
    clientExtensionResults: {},
    response: { authenticatorData: 'YQ', clientDataJSON: 'YQ', signature: 'YQ' },
}
beforeEach(() => {
    boundary.reset()
    cookie = null
    clear.mockClear()
    session.mockClear()
    challengeCookie.mockClear()
})

test('login validates before side effects, clears old MFA state and selects either MFA challenge or session cookies', async () => {
    await expect(
        boundary.invoke(handlers.loginHandler, { email: 'invalid', password: '' }),
    ).rejects.toThrow()
    expect(boundary.calls).toHaveLength(0)
    boundary.values.set('loginService', { success: false, message: 'private account status' })
    expect(await boundary.invoke(handlers.loginHandler, credentials)).toEqual({
        success: false,
        message: 'generic-login',
    })
    expect(boundary.argumentsFor('enforceSensitiveLimit')).toEqual([['login', credentials.email]])
    expect(boundary.argumentsFor('loginService')).toEqual([[credentials]])
    expect(boundary.calls[0]?.name).toBe('clearCookie')
    expect(session).not.toHaveBeenCalled()
    boundary.values.set('loginService', {
        success: true,
        requiresTwoFactor: true,
        challenge: { id: challenge, expiresAt },
    })
    expect(await boundary.invoke(handlers.loginHandler, credentials)).toMatchObject({
        success: false,
        requiresTwoFactor: true,
    })
    expect(challengeCookie).toHaveBeenCalledWith(challenge, expiresAt)
    expect(session).not.toHaveBeenCalled()
    boundary.values.set('loginService', authenticated)
    expect(await boundary.invoke(handlers.loginHandler, credentials)).toEqual({
        success: true,
        message: 'Signed in.',
    })
    expect(session).toHaveBeenCalledWith('fixture-session', expiresAt)
    expect(cookie).toBeNull()
})

test('login rate-limit and backend failures never mint session cookies or expose internal errors', async () => {
    const failure = new Error('private backend address')
    boundary.failures.set('enforceSensitiveLimit', failure)
    expect(await boundary.invoke(handlers.loginHandler, credentials)).toEqual({
        success: false,
        message: 'public-unavailable',
    })
    expect(boundary.argumentsFor('loginService')).toHaveLength(0)
    expect(session).not.toHaveBeenCalled()
    expect(boundary.argumentsFor('actionFailure')).toEqual([[failure, 'public-unavailable']])
})

test('MFA challenge status clears stale or disabled challenges and advertises only available methods', async () => {
    expect(await boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).toEqual({
        valid: false,
        methods: [],
    })
    expect(boundary.argumentsFor('getAuthChallenge')).toHaveLength(0)
    cookie = challenge
    boundary.values.set('getAuthChallenge', null)
    expect(await boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).toEqual({
        valid: false,
        methods: [],
    })
    expect(cookie).toBeNull()
    cookie = challenge
    boundary.values.set('getAuthChallenge', { userId: 'fixture-user' })
    boundary.values.set('getTwoFactorStatusService', {
        totpEnabled: false,
        recoveryCodesRemaining: 0,
    })
    expect(await boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).toEqual({
        valid: false,
        methods: [],
    })
    expect(cookie).toBeNull()
    cookie = challenge
    boundary.values.set('getTwoFactorStatusService', {
        totpEnabled: true,
        recoveryCodesRemaining: 0,
    })
    expect(await boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).toEqual({
        valid: true,
        methods: ['totp'],
    })
    boundary.values.set('getTwoFactorStatusService', {
        totpEnabled: true,
        recoveryCodesRemaining: 2,
    })
    expect(await boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).toEqual({
        valid: true,
        methods: ['totp', 'recovery'],
    })
    boundary.failures.set('getAuthChallenge', new Error('private store error'))
    await expect(boundary.invoke(handlers.getTwoFactorChallengeStatusHandler, {})).rejects.toThrow(
        'public-query-unavailable',
    )
})

test('MFA completion requires a current challenge, limits by user and dispatches exactly the selected proof', async () => {
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, { code: '123456' }),
    ).toMatchObject({ success: false, restartLogin: true })
    cookie = challenge
    boundary.values.set('getAuthChallenge', null)
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, { code: '123456' }),
    ).toMatchObject({ success: false, restartLogin: true })
    expect(cookie).toBeNull()
    cookie = challenge
    boundary.values.set('getAuthChallenge', { userId: 'fixture-user' })
    boundary.values.set('completeLoginMfaWithTotpService', { success: false, code: 'invalid_code' })
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, { code: '123456' }),
    ).toEqual({ success: false, message: 'Authentication failed.' })
    expect(boundary.argumentsFor('enforceLoginMfaLimit')).toEqual([['fixture-user']])
    expect(boundary.argumentsFor('completeLoginMfaWithTotpService')).toEqual([
        [{ challengeId: challenge, token: '123456' }],
    ])
    boundary.values.set('completeLoginMfaWithRecoveryCodeService', {
        success: false,
        code: 'challenge_expired',
    })
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, {
            recoveryCode: ' recovery-fixture ',
        }),
    ).toMatchObject({ restartLogin: true })
    expect(boundary.argumentsFor('completeLoginMfaWithRecoveryCodeService')).toEqual([
        [{ challengeId: challenge, recoveryCode: 'recovery-fixture' }],
    ])
    expect(cookie).toBeNull()
    cookie = challenge
    boundary.values.set('completeLoginMfaWithTotpService', authenticated)
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, { code: '123456' }),
    ).toEqual({ success: true, message: 'Signed in.' })
    expect(session).toHaveBeenCalledWith('fixture-session', expiresAt)
    expect(cookie).toBeNull()
    cookie = challenge
    boundary.failures.set('enforceLoginMfaLimit', new Error('limit unavailable'))
    expect(
        await boundary.invoke(handlers.completeTwoFactorLoginHandler, { recoveryCode: 'fixture' }),
    ).toEqual({ success: false, message: 'public-unavailable' })
})

test('passkey login binds flow and assertion, rate-limits both ceremonies and never sets cookies for rejected proofs', async () => {
    boundary.values.set('beginDiscoverablePasskeyAuthenticationService', {
        flowId: challenge,
        options: { challenge: 'fixture-options' },
    })
    expect(await boundary.invoke(handlers.beginPasskeyLoginHandler, {})).toMatchObject({
        success: true,
        challengeId: challenge,
        options: { challenge: 'fixture-options' },
    })
    expect(boundary.argumentsFor('enforceAnonymousSensitiveLimit')).toEqual([
        ['login', 'passkey-login'],
    ])
    await expect(
        boundary.invoke(handlers.finishPasskeyLoginHandler, {
            challengeId: 'invalid',
            response: assertion,
        }),
    ).rejects.toThrow()
    expect(boundary.argumentsFor('finishDiscoverablePasskeyAuthenticationService')).toHaveLength(0)
    boundary.values.set('finishDiscoverablePasskeyAuthenticationService', { success: false })
    expect(
        await boundary.invoke(handlers.finishPasskeyLoginHandler, {
            challengeId: challenge,
            response: assertion,
        }),
    ).toEqual({ success: false, message: 'Authentication failed.' })
    expect(session).not.toHaveBeenCalled()
    boundary.values.set('finishDiscoverablePasskeyAuthenticationService', authenticated)
    expect(
        await boundary.invoke(handlers.finishPasskeyLoginHandler, {
            challengeId: challenge,
            response: assertion,
        }),
    ).toMatchObject({ success: true })
    expect(boundary.argumentsFor('finishDiscoverablePasskeyAuthenticationService').at(-1)).toEqual([
        { flowId: challenge, response: assertion },
    ])
    expect(boundary.argumentsFor('enforceSensitiveLimit').at(-1)).toEqual(['login', 'YQ'])
    expect(session).toHaveBeenCalledWith('fixture-session', expiresAt)
    boundary.failures.set(
        'beginDiscoverablePasskeyAuthenticationService',
        new Error('private details'),
    )
    expect(await boundary.invoke(handlers.beginPasskeyLoginHandler, {})).toEqual({
        success: false,
        message: 'Passkey sign-in is temporarily unavailable.',
    })
    boundary.failures.set(
        'finishDiscoverablePasskeyAuthenticationService',
        new Error('private details'),
    )
    expect(
        await boundary.invoke(handlers.finishPasskeyLoginHandler, {
            challengeId: challenge,
            response: assertion,
        }),
    ).toEqual({ success: false, message: 'public-unavailable' })
})
