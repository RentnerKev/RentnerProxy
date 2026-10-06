import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    passwordResetTokens,
    sessions,
    userRecoveryCodes,
    userTotpFactors,
    users,
} from '@/db/schema.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type {
    AuthChallenge,
    LoginMfaChallenge,
} from '@/server/Valkey/Types/auth-challenges.types.ts'
import type {
    AuthenticationTestDatabase,
    AuthenticationTestFactor,
    AuthenticationTestQuery,
    AuthenticationTestRow,
    AuthenticationTestUser,
} from './Types/login-state-test.types.ts'

const userId = '0198f2f0-0000-7000-8000-000000000001'
const currentPassword = 'current test password'
const nextPassword = 'next test password'
const cookieToken = 'A'.repeat(43)
const currentHash = await Bun.password.hash(currentPassword, { algorithm: 'argon2id' })
let user: AuthenticationTestUser
let storedSessions: AuthenticationTestRow[] = []
let factor: AuthenticationTestFactor | null = null
let recoveryUsed = false
let hasAppAccess = true
let sessionCookie: string | null = null
const challenges = new Map<string, LoginMfaChallenge>()
const events: string[] = []
let transactionPause: { entered: () => void; resume: Promise<void> } | null = null
let decryptionPause: { entered: () => void; resume: Promise<void> } | null = null

const access: AuthenticatedUser = {
    displayName: 'Test User',
    email: 'unit@example.test',
    id: userId,
    language: 'en',
    permissions: [PERMISSIONS.APP_ACCESS, PERMISSIONS.ACCOUNT_UPDATE],
    profileImageVersion: null,
    roles: [],
    themeMode: 'light',
}

function rows(table: unknown): AuthenticationTestRow[] {
    if (table === users) return [structuredClone(user)]
    if (table === sessions) return structuredClone(storedSessions)
    if (table === passwordResetTokens) return [{ id: 'reset-1', userId, consumedAt: null }]
    if (table === userTotpFactors) return factor ? [structuredClone(factor)] : []
    if (table === userRecoveryCodes) return recoveryUsed ? [] : [{ id: 'recovery-1' }]
    return []
}

function query(promise: Promise<AuthenticationTestRow[]>, table: unknown): AuthenticationTestQuery {
    const result: AuthenticationTestQuery = Object.assign(promise, {
        for: (mode: string) => {
            if (table === users) events.push(`user-lock:${mode}`)
            if (table === sessions) events.push(`session-lock:${mode}`)
            return result
        },
        innerJoin: () => result,
        limit: () => result,
        returning: () => result,
        where: () => result,
    })
    return result
}

// This fixture models committed state and service ordering, not PostgreSQL locking or SQL predicates.
const database: AuthenticationTestDatabase = {
    select: () => ({ from: (table) => query(Promise.resolve(rows(table)), table) }),
    transaction: async (callback) => {
        const pause = transactionPause
        transactionPause = null
        if (pause) {
            pause.entered()
            await pause.resume
        }
        return callback(database)
    },
    insert: (table) => ({
        values: (value) => ({
            returning: async () => {
                if (table !== sessions)
                    throw new Error('Unexpected insert in authentication fixture.')
                const row = { ...value, id: `session-${storedSessions.length + 1}` }
                storedSessions.push(row)
                events.push('session-created')
                return [row]
            },
        }),
    }),
    update: (table) => ({
        set: (value) => ({
            where: () =>
                query(
                    Promise.resolve().then(() => {
                        if (table === users) {
                            Object.assign(user, value)
                            events.push('password-updated')
                            return [{ id: userId }]
                        }
                        if (table === userTotpFactors) {
                            if (
                                !factor ||
                                typeof value.lastUsedCounter !== 'number' ||
                                factor.lastUsedCounter >= value.lastUsedCounter
                            )
                                return []
                            Object.assign(factor, value)
                            events.push('totp-used')
                            return [{ id: factor.id }]
                        }
                        if (table === userRecoveryCodes) {
                            if (recoveryUsed) return []
                            recoveryUsed = true
                            events.push('recovery-used')
                            return [{ id: 'recovery-1' }]
                        }
                        return [{ id: 'reset-1' }]
                    }),
                    table,
                ),
        }),
    }),
    delete: (table) => ({
        where: () =>
            query(
                Promise.resolve().then(() => {
                    if (table === sessions) {
                        storedSessions = []
                        events.push('sessions-revoked')
                    }
                    if (table === userTotpFactors && factor) {
                        const deleted = factor
                        factor = null
                        events.push('factor-deleted')
                        return [deleted]
                    }
                    if (table === userRecoveryCodes) recoveryUsed = true
                    return []
                }),
                table,
            ),
    }),
}

mock.module('@tanstack/react-start/server-only', () => ({}))
mock.module('@/server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => database }))
mock.module('@/server/Auth/Access/cookies.server.ts', () => ({
    getSessionCookie: () => sessionCookie,
}))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    resolveActiveUserAccessInTransaction: async () =>
        hasAppAccess ? access : { ...access, permissions: [] },
    requirePermissionInTransaction: async () => undefined,
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requireRecentAuthenticationForSession: async () => undefined,
    requireSessionPermission: async () => undefined,
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async () => undefined,
    recordAuditEventBestEffortService: async () => undefined,
}))
mock.module('@/server/Mail/mail.service.ts', () => ({
    sendPasswordResetEmailService: () => {
        throw new Error('Mail must not run in unit tests.')
    },
}))
mock.module('@/server/Valkey/rate-limiter.service.ts', () => ({
    enforcePasswordChangeRateLimit: async () => undefined,
}))
mock.module('@/server/Auth/Core/encryption.server.ts', () => ({
    decodeBase64Url: () => new Uint8Array(1),
    decryptSecret: async () => {
        const pause = decryptionPause
        decryptionPause = null
        if (pause) {
            pause.entered()
            await pause.resume
        }
        return 'synthetic-totp-secret'
    },
    encryptSecret: async () => ({ ciphertext: new Uint8Array(1), iv: new Uint8Array(1) }),
}))
mock.module('@/server/Auth/TwoFactor/two-factor-credentials.server.ts', () => ({
    getMatchedTotpCounter: () => 1,
    createRecoveryCodeBatch: async () => [],
    createTotpSecret: () => '',
    createTotpUri: () => '',
    hashRecoveryCode: async () => 'test-recovery-hash',
    normalizeRecoveryCode: (code: string) => (code === 'valid-recovery' ? code : null),
}))
mock.module('@/server/Valkey/auth-challenges.service.ts', () => ({
    createAuthChallenge: async (challenge: AuthChallenge) => {
        if (challenge.kind !== 'login-mfa') throw new Error('Unexpected challenge kind.')
        const id = `challenge-${challenges.size + 1}`
        challenges.set(id, challenge)
        return { id, expiresAt: new Date(Date.now() + 300_000) }
    },
    acquireCodeChallengeVerification: async (_kind: string, id: string) => {
        const challenge = challenges.get(id)
        return challenge ? { id, lockToken: 'test-lock', challenge } : null
    },
    consumeCodeChallengeVerification: async ({ id }: { id: string }) => {
        const challenge = challenges.get(id) ?? null
        challenges.delete(id)
        return challenge
    },
    failCodeChallengeVerification: async () => 'invalid',
    releaseCodeChallengeVerification: async () => undefined,
}))

const { loginService } = await import('@/server/Auth/Login/login.service.ts')
const { consumePasswordResetService } =
    await import('@/server/Auth/PasswordReset/password-reset.service.ts')
const { changeCurrentPasswordService } = await import('@/server/Auth/Account/account.service.ts')
const { createSessionInTransaction } = await import('@/server/Auth/Access/sessions.service.ts')
const { getAuthDatabase } = await import('@/server/Auth/Core/database.server.ts')
const {
    completeLoginMfaWithTotpService,
    completeLoginMfaWithRecoveryCodeService,
    disableTotpService,
    regenerateRecoveryCodesService,
} = await import('@/server/Auth/TwoFactor/two-factor.service.ts')

function enabledFactor(id = 'factor-1'): AuthenticationTestFactor {
    return {
        id,
        userId,
        lastUsedCounter: 0,
        secretCiphertext: new Uint8Array(1),
        secretIv: new Uint8Array(1),
    }
}

function currentSession(): CurrentSession {
    return {
        id: 'existing-session',
        user: access,
        expiresAt: new Date(Date.now() + 600_000),
        reauthenticatedAt: new Date(),
    }
}

function pauseNextTransaction() {
    const entered = Promise.withResolvers<void>()
    const resumed = Promise.withResolvers<void>()
    transactionPause = { entered: entered.resolve, resume: resumed.promise }
    return { entered: entered.promise, resume: resumed.resolve }
}

async function issueChallenge(password = currentPassword) {
    const login = await loginService({ email: user.email, password })
    if (!login.success || !login.requiresTwoFactor) throw new Error('MFA challenge was not issued.')
    return login.challenge.id
}

async function rotatePassword(method: 'reset' | 'change') {
    if (method === 'reset') {
        expect(
            await consumePasswordResetService({ token: cookieToken, password: nextPassword }),
        ).toMatchObject({ success: true })
    } else {
        sessionCookie = cookieToken
        expect(
            await changeCurrentPasswordService({ currentPassword, password: nextPassword }),
        ).toEqual({ success: true })
        sessionCookie = null
    }
    expect(await Bun.password.verify(currentPassword, user.passwordHash ?? '')).toBeFalse()
    expect(events).toContain('sessions-revoked')
}

beforeEach(() => {
    user = { id: userId, email: access.email, status: 'active', passwordHash: currentHash }
    storedSessions = [
        {
            id: 'existing-session',
            userId,
            expiresAt: new Date(Date.now() + 600_000),
            reauthenticatedAt: new Date(),
        },
    ]
    factor = null
    recoveryUsed = false
    hasAppAccess = true
    sessionCookie = null
    challenges.clear()
    events.length = 0
    transactionPause = null
    decryptionPause = null
})

describe('password authentication state', () => {
    test('issues a session for the current password', async () => {
        const login = await loginService({ email: user.email, password: currentPassword })
        expect(login).toMatchObject({ success: true, requiresTwoFactor: false })
        expect(events.indexOf('user-lock:update')).toBeLessThan(events.indexOf('session-created'))
    })

    for (const method of ['reset', 'change'] as const) {
        test(`rechecks a pending password login after password ${method}`, async () => {
            const pause = pauseNextTransaction()
            const pending = loginService({ email: user.email, password: currentPassword })
            await pause.entered
            await rotatePassword(method)
            pause.resume()
            expect(await pending).toEqual({ success: false, code: 'invalid_credentials' })
            expect(events).not.toContain('session-created')
            expect(await loginService({ email: user.email, password: nextPassword })).toMatchObject(
                { success: true, requiresTwoFactor: false },
            )
        })

        for (const secondFactor of ['totp', 'recovery'] as const) {
            test(`rechecks ${secondFactor} challenge credentials after password ${method}`, async () => {
                factor = enabledFactor()
                const challengeId = await issueChallenge()
                expect(challenges.get(challengeId)).toMatchObject({
                    factorId: factor.id,
                    passwordFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
                })
                expect(JSON.stringify(challenges.get(challengeId))).not.toContain(currentHash)
                await rotatePassword(method)
                events.length = 0
                const completed =
                    secondFactor === 'totp'
                        ? await completeLoginMfaWithTotpService({ challengeId, token: '123456' })
                        : await completeLoginMfaWithRecoveryCodeService({
                              challengeId,
                              recoveryCode: 'valid-recovery',
                          })
                expect(completed).toEqual({ success: false, code: 'authentication_failed' })
                expect(events).not.toContain('session-created')
                expect(events).not.toContain('totp-used')
                expect(events).not.toContain('recovery-used')
                const freshChallengeId = await issueChallenge(nextPassword)
                const freshCompletion =
                    secondFactor === 'totp'
                        ? await completeLoginMfaWithTotpService({
                              challengeId: freshChallengeId,
                              token: '123456',
                          })
                        : await completeLoginMfaWithRecoveryCodeService({
                              challengeId: freshChallengeId,
                              recoveryCode: 'valid-recovery',
                          })
                expect(freshCompletion).toMatchObject({ success: true })
            })
        }
    }

    for (const state of ['disabled', 'permission-removed'] as const) {
        test(`keeps ${state} users from completing a pending password login`, async () => {
            const pause = pauseNextTransaction()
            const pending = loginService({ email: user.email, password: currentPassword })
            await pause.entered
            if (state === 'disabled') user.status = 'disabled'
            else hasAppAccess = false
            pause.resume()
            expect(await pending).toEqual({ success: false, code: 'invalid_credentials' })
            expect(events).not.toContain('session-created')
        })
    }

    test('observes a newly enabled factor before issuing a password session', async () => {
        const pause = pauseNextTransaction()
        const pending = loginService({ email: user.email, password: currentPassword })
        await pause.entered
        factor = enabledFactor()
        pause.resume()
        expect(await pending).toMatchObject({ success: true, requiresTwoFactor: true })
        expect(events).not.toContain('session-created')
    })

    for (const secondFactor of ['totp', 'recovery'] as const) {
        test(`completes current ${secondFactor} credentials once`, async () => {
            factor = enabledFactor()
            const challengeId = await issueChallenge()
            const complete = () =>
                secondFactor === 'totp'
                    ? completeLoginMfaWithTotpService({ challengeId, token: '123456' })
                    : completeLoginMfaWithRecoveryCodeService({
                          challengeId,
                          recoveryCode: 'valid-recovery',
                      })
            expect(await complete()).toMatchObject({ success: true })
            expect(await complete()).toEqual({ success: false, code: 'challenge_expired' })
            if (secondFactor === 'totp') {
                const replayId = await issueChallenge()
                expect(
                    await completeLoginMfaWithTotpService({
                        challengeId: replayId,
                        token: '123456',
                    }),
                ).toEqual({ success: false, code: 'authentication_failed' })
            }
        })

        test(`rejects ${secondFactor} completion when the bound factor was replaced`, async () => {
            factor = enabledFactor()
            const challengeId = await issueChallenge()
            factor = enabledFactor('factor-2')
            events.length = 0
            const completed =
                secondFactor === 'totp'
                    ? await completeLoginMfaWithTotpService({ challengeId, token: '123456' })
                    : await completeLoginMfaWithRecoveryCodeService({
                          challengeId,
                          recoveryCode: 'valid-recovery',
                      })
            expect(completed).toEqual({ success: false, code: 'authentication_failed' })
            expect(events).not.toContain('session-created')
            expect(events).not.toContain('recovery-used')
        })
    }

    test('rechecks the factor after TOTP verification has started', async () => {
        factor = enabledFactor()
        const challengeId = await issueChallenge()
        const entered = Promise.withResolvers<void>()
        const resumed = Promise.withResolvers<void>()
        decryptionPause = { entered: entered.resolve, resume: resumed.promise }
        const pending = completeLoginMfaWithTotpService({ challengeId, token: '123456' })
        await entered.promise
        factor = enabledFactor('factor-2')
        resumed.resolve()
        expect(await pending).toEqual({ success: false, code: 'authentication_failed' })
        expect(factor.lastUsedCounter).toBe(0)
    })

    test('serializes factor disable before checking the recent session and revoking sessions', async () => {
        factor = enabledFactor()
        const challengeId = await issueChallenge()
        events.length = 0
        expect(await disableTotpService(currentSession())).toBeTrue()
        expect(events.indexOf('user-lock:update')).toBeLessThan(
            events.indexOf('session-lock:update'),
        )
        expect(events.indexOf('session-lock:update')).toBeLessThan(events.indexOf('factor-deleted'))
        expect(
            await completeLoginMfaWithRecoveryCodeService({
                challengeId,
                recoveryCode: 'valid-recovery',
            }),
        ).toEqual({ success: false, code: 'authentication_failed' })
    })

    test('serializes recovery-code rotation before checking the recent session', async () => {
        factor = enabledFactor()
        expect(await regenerateRecoveryCodesService(currentSession())).toMatchObject({
            success: true,
        })
        expect(events.indexOf('user-lock:update')).toBeLessThan(
            events.indexOf('session-lock:update'),
        )
    })

    test('still requires recent authentication inside factor changes', async () => {
        factor = enabledFactor()
        storedSessions[0] = { ...storedSessions[0], reauthenticatedAt: new Date(0) }
        await expect(disableTotpService(currentSession())).rejects.toMatchObject({
            code: 'reauthentication_required',
        })
        expect(factor).not.toBeNull()
        expect(events).not.toContain('factor-deleted')
    })

    test('keeps independent passkey session issuance available without a password', async () => {
        user.passwordHash = null
        const session = await getAuthDatabase().transaction((transaction) =>
            createSessionInTransaction(transaction, userId, 'passkey'),
        )
        expect(session.id).toBeDefined()
        expect(session.reauthenticatedAt).toBeInstanceOf(Date)
    })
})
