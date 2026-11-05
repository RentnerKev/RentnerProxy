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
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { OidcIdentityProof } from '@/server/Auth/Oidc/Types/oidc.types.ts'
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
const loginAudits: AuditEventInput[] = []
let transactionCommits = 0
let removeAccessOnSync = false
let transactionPause: { entered: () => void; resume: Promise<void> } | null = null
let decryptionPause: { entered: () => void; resume: Promise<void> } | null = null
const oidcProof: OidcIdentityProof = {
    providerId: '0198f2f0-0000-7000-8000-000000000002',
    providerRevision: 1,
    issuer: 'https://identity.example.test',
    subject: 'opaque-subject',
    userId,
    expiresAt: Date.now() + 300_000,
}
let oidcProvider: {
    enabled: boolean
    revision: number
    issuer: string
    bindings: { subject: string; userId: string; generation?: number }[]
} | null = null

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
    // Cleanup SQL/locking is exercised by the dedicated PostgreSQL sessions fixture.
    execute: async () => {},
    select: () => ({ from: (table) => query(Promise.resolve(rows(table)), table) }),
    transaction: async (callback) => {
        const pause = transactionPause
        transactionPause = null
        if (pause) {
            pause.entered()
            await pause.resume
        }
        const result = await callback(database)
        transactionCommits += 1
        return result
    },
    insert: (table) => ({
        values: (value) => ({
            returning: async () => {
                if (table !== sessions)
                    throw new Error('Unexpected insert in authentication fixture.')
                const row = {
                    lastSeenAt: new Date(),
                    ...value,
                    id: `session-${storedSessions.length + 1}`,
                }
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
mock.module('@/server/Auth/Oidc/oidc-providers.service.ts', () => ({
    lockOidcProviderInTransaction: async (_transaction: unknown, providerId: string) => {
        events.push('provider-lock')
        return providerId === oidcProof.providerId ? oidcProvider : null
    },
}))
mock.module('@/server/Auth/Oidc/oidc-accounts.service.ts', () => ({
    lockOidcAccountPolicyInTransaction: async () => undefined,
    synchronizeOidcAccountInTransaction: async () => {
        if (removeAccessOnSync) {
            hasAppAccess = false
            storedSessions = []
            events.push('sessions-revoked')
        }
    },
}))
mock.module('@/server/Auth/Oidc/oidc-settings.server.ts', () => ({
    readStoredOidcSettings: async () => ({
        version: 1,
        revision: oidcProvider?.revision ?? 0,
        providers: oidcProvider ? [{ ...oidcProvider, id: oidcProof.providerId }] : [],
    }),
}))
mock.module('@/server/Auth/Access/cookies.server.ts', () => ({
    getSessionCookie: () => sessionCookie,
}))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    resolveActiveUserAccessInTransaction: async () =>
        hasAppAccess ? access : { ...access, permissions: [] },
    requirePermissionInTransaction: async () => undefined,
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requireActiveSessionForSession: async () => undefined,
    requireSessionPermission: async () => undefined,
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async (_transaction: unknown, event: AuditEventInput) => {
        loginAudits.push(event)
    },
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
const { requireOidcAuthenticationInTransaction } =
    await import('@/server/Auth/Oidc/oidc-authentication.server.ts')
const {
    completeLoginMfaWithTotpService,
    completeLoginMfaWithRecoveryCodeService,
    disableTotpService,
    regenerateRecoveryCodesService,
    createOidcLoginMfaChallengeService,
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
        expect(await changeCurrentPasswordService({ password: nextPassword })).toEqual({
            success: true,
        })
        sessionCookie = null
    }
    expect(await Bun.password.verify(currentPassword, user.passwordHash ?? '')).toBeFalse()
    expect(events).toContain('sessions-revoked')
}

beforeEach(() => {
    user = {
        id: userId,
        email: access.email,
        status: 'active',
        passwordHash: currentHash,
        oidcProviderId: null,
    }
    storedSessions = [
        {
            id: 'existing-session',
            userId,
            expiresAt: new Date(Date.now() + 600_000),
            reauthenticatedAt: new Date(),
            lastSeenAt: new Date(),
            oidcProof: null,
            oidcProviderId: null,
        },
    ]
    factor = null
    recoveryUsed = false
    hasAppAccess = true
    sessionCookie = null
    challenges.clear()
    events.length = 0
    loginAudits.length = 0
    transactionCommits = 0
    removeAccessOnSync = false
    transactionPause = null
    decryptionPause = null
    oidcProvider = {
        enabled: true,
        revision: 1,
        issuer: oidcProof.issuer,
        bindings: [{ subject: oidcProof.subject, userId }],
    }
})

describe('password authentication state', () => {
    test.each([11, 257])(
        'rejects a new password of %s code units without changing credentials or sessions',
        async (length) => {
            sessionCookie = cookieToken
            const originalSessions = structuredClone(storedSessions)
            await expect(
                changeCurrentPasswordService({ password: 'x'.repeat(length) }),
            ).rejects.toMatchObject({
                code: 'password_policy',
            })
            expect(user.passwordHash).toBe(currentHash)
            expect(storedSessions).toEqual(originalSessions)
            expect(events).not.toContain('password-updated')
        },
    )

    test('issues a session for an existing short password without applying the new-password policy', async () => {
        user.passwordHash = await Bun.password.hash('x', { algorithm: 'argon2id' })
        expect(await loginService({ email: user.email, password: 'x' })).toMatchObject({
            success: true,
        })
        expect(storedSessions.length).toBeGreaterThan(0)
    })

    test('changes a local password from an older active session without supplying the old password', async () => {
        sessionCookie = cookieToken
        storedSessions[0] = { ...storedSessions[0], reauthenticatedAt: new Date(0) }
        expect(await changeCurrentPasswordService({ password: nextPassword })).toEqual({
            success: true,
        })
        expect(await Bun.password.verify(nextPassword, user.passwordHash ?? '')).toBeTrue()
        expect(events).toContain('sessions-revoked')
        expect(loginAudits).toContainEqual(
            expect.objectContaining({ action: 'update', resource: 'password', result: 'success' }),
        )
    })

    test('keeps externally managed passwordless credentials outside local password changes', async () => {
        sessionCookie = cookieToken
        user.passwordHash = null
        await expect(
            changeCurrentPasswordService({ password: nextPassword }),
        ).rejects.toMatchObject({ code: 'authentication_required' })
        expect(user.passwordHash).toBeNull()
        expect(events).not.toContain('password-updated')
    })

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
                    firstFactor: {
                        kind: 'password',
                        passwordFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
                    },
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

    for (const secondFactor of ['totp', 'recovery'] as const) {
        test(`rejects ${secondFactor} completion after the user becomes inactive`, async () => {
            factor = enabledFactor()
            const challengeId = await issueChallenge()
            user.status = 'disabled'
            events.length = 0
            const result =
                secondFactor === 'totp'
                    ? await completeLoginMfaWithTotpService({ challengeId, token: '123456' })
                    : await completeLoginMfaWithRecoveryCodeService({
                          challengeId,
                          recoveryCode: 'valid-recovery',
                      })
            expect(result).toEqual({ success: false, code: 'authentication_failed' })
            expect(events).not.toContain('session-created')
            expect(events).not.toContain('totp-used')
            expect(events).not.toContain('recovery-used')
        })

        test(`admits only one concurrent ${secondFactor} proof across distinct challenges`, async () => {
            factor = enabledFactor()
            const first = await issueChallenge()
            const second = await issueChallenge()
            const results = await Promise.all(
                [first, second].map((challengeId) =>
                    secondFactor === 'totp'
                        ? completeLoginMfaWithTotpService({ challengeId, token: '123456' })
                        : completeLoginMfaWithRecoveryCodeService({
                              challengeId,
                              recoveryCode: 'valid-recovery',
                          }),
                ),
            )
            expect(results.filter((result) => result.success)).toHaveLength(1)
            expect(results.filter((result) => !result.success)).toHaveLength(1)
            expect(events.filter((event) => event === 'session-created')).toHaveLength(1)
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

    test('serializes factor disable before checking the active session and revoking sessions', async () => {
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

    test('serializes recovery-code rotation before checking the active session', async () => {
        factor = enabledFactor()
        expect(await regenerateRecoveryCodesService(currentSession())).toMatchObject({
            success: true,
        })
        expect(events.indexOf('user-lock:update')).toBeLessThan(
            events.indexOf('session-lock:update'),
        )
    })

    test('accepts older authentication inside factor changes', async () => {
        factor = enabledFactor()
        storedSessions[0] = { ...storedSessions[0], reauthenticatedAt: new Date(0) }
        expect(await disableTotpService(currentSession())).toBeTrue()
        expect(factor).toBeNull()
        expect(events).toContain('factor-deleted')
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

describe('OIDC authentication state and local assurance', () => {
    test('retains compatibility timestamp when issuing an OIDC session', async () => {
        const session = await getAuthDatabase().transaction((transaction) =>
            createSessionInTransaction(transaction, userId, 'oidc', undefined, oidcProof),
        )
        expect(session.reauthenticatedAt.getTime()).toBe(0)
    })

    test('accepts an active OIDC session without local reauthentication', async () => {
        storedSessions = []
        const session = await getAuthDatabase().transaction((transaction) =>
            createSessionInTransaction(transaction, userId, 'oidc', new Date(0), oidcProof),
        )
        expect(session.reauthenticatedAt.getTime()).toBe(0)
        expect(storedSessions.at(-1)?.reauthenticatedAt).toEqual(new Date(0))
        factor = enabledFactor()
        expect(await disableTotpService({ ...currentSession(), id: session.id })).toBeTrue()
    })

    for (const secondFactor of ['totp', 'recovery'] as const) {
        test(`completes OIDC with local ${secondFactor} and fresh assurance once`, async () => {
            factor = enabledFactor()
            const issued = await createOidcLoginMfaChallengeService({
                ...oidcProof,
                factorId: factor.id,
            })
            const complete = () =>
                secondFactor === 'totp'
                    ? completeLoginMfaWithTotpService({ challengeId: issued.id, token: '123456' })
                    : completeLoginMfaWithRecoveryCodeService({
                          challengeId: issued.id,
                          recoveryCode: 'valid-recovery',
                      })
            expect(await complete()).toMatchObject({ success: true })
            expect(storedSessions.at(-1)?.oidcProof).toEqual({ ...oidcProof, bindingGeneration: 0 })
            expect(loginAudits.at(-1)?.metadata).toEqual({
                authenticationMethod: 'oidc',
                localAuthenticationMethod: secondFactor === 'totp' ? 'totp' : 'recovery-code',
            })
            expect(events.indexOf('provider-lock')).toBeLessThan(events.indexOf('user-lock:update'))
            expect(events.indexOf('user-lock:update')).toBeLessThan(
                events.indexOf('session-created'),
            )
            expect(Number(storedSessions.at(-1)?.reauthenticatedAt)).toBeGreaterThan(
                Date.now() - 5_000,
            )
            expect(await complete()).toEqual({ success: false, code: 'challenge_expired' })
        })
    }

    test('commits synchronized grant removal and session revocation when MFA loses access', async () => {
        factor = enabledFactor()
        const issued = await createOidcLoginMfaChallengeService({
            ...oidcProof,
            factorId: factor.id,
        })
        removeAccessOnSync = true
        expect(
            await completeLoginMfaWithRecoveryCodeService({
                challengeId: issued.id,
                recoveryCode: 'valid-recovery',
            }),
        ).toEqual({ success: false, code: 'authentication_failed' })
        expect(storedSessions).toHaveLength(0)
        expect(transactionCommits).toBe(1)
        expect(events).toContain('sessions-revoked')
        expect(events).not.toContain('recovery-used')
    })

    for (const change of [
        'disabled',
        'revision',
        'issuer',
        'binding',
        'binding-generation',
        'removed',
        'user-disabled',
        'permission-removed',
    ] as const) {
        test(`rejects pending OIDC MFA after ${change}`, async () => {
            factor = enabledFactor()
            const issued = await createOidcLoginMfaChallengeService({
                ...oidcProof,
                factorId: factor.id,
            })
            if (!oidcProvider) throw new Error('Missing test provider.')
            if (change === 'disabled') oidcProvider.enabled = false
            if (change === 'revision') oidcProvider.revision += 1
            if (change === 'issuer') oidcProvider.issuer = 'https://another.example.test'
            if (change === 'binding')
                oidcProvider.bindings[0] = { subject: oidcProof.subject, userId: 'another-user' }
            if (change === 'binding-generation')
                oidcProvider.bindings[0] = { subject: oidcProof.subject, userId, generation: 1 }
            if (change === 'removed') oidcProvider = null
            if (change === 'user-disabled') user.status = 'disabled'
            if (change === 'permission-removed') hasAppAccess = false
            expect(
                await completeLoginMfaWithRecoveryCodeService({
                    challengeId: issued.id,
                    recoveryCode: 'valid-recovery',
                }),
            ).toEqual({
                success: false,
                code: 'authentication_failed',
            })
            expect(events).not.toContain('session-created')
            expect(events).not.toContain('recovery-used')
        })
    }

    test('rechecks provider state after local TOTP verification has started', async () => {
        factor = enabledFactor()
        const issued = await createOidcLoginMfaChallengeService({
            ...oidcProof,
            factorId: factor.id,
        })
        const entered = Promise.withResolvers<void>()
        const resumed = Promise.withResolvers<void>()
        decryptionPause = { entered: entered.resolve, resume: resumed.promise }
        const pending = completeLoginMfaWithTotpService({ challengeId: issued.id, token: '123456' })
        await entered.promise
        if (!oidcProvider) throw new Error('Missing test provider.')
        oidcProvider.enabled = false
        resumed.resolve()
        expect(await pending).toEqual({ success: false, code: 'authentication_failed' })
        expect(factor.lastUsedCounter).toBe(0)
        expect(events).not.toContain('session-created')
    })

    for (const proof of [
        { ...oidcProof, providerId: 'another-provider' },
        { ...oidcProof, issuer: oidcProof.issuer + '/' },
        { ...oidcProof, subject: 'Opaque-subject' },
    ]) {
        test(`requires exact provider identity ${JSON.stringify(proof)}`, async () => {
            await expect(
                getAuthDatabase().transaction((transaction) =>
                    requireOidcAuthenticationInTransaction(transaction, proof),
                ),
            ).rejects.toMatchObject({ code: 'user_not_active' })
            expect(events).not.toContain('user-lock:update')
        })
    }
})
