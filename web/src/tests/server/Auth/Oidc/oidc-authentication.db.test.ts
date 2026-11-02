import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'

import { SESSION_DURATION_MS } from '@/config/auth.config.ts'
import { TOTP_ALGORITHM, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '@/config/auth-security.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    permissions,
    rolePermissions,
    roles,
    sessions,
    userRecoveryCodes,
    userRoles,
    users,
    userTotpFactors,
} from '@/db/schema.ts'
import { getDatabaseUrl, getValkeyUrl } from '@/server/env.server.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { encryptSecret } from '@/server/Auth/Core/encryption.server.ts'
import { hashPassword } from '@/server/Auth/Core/password.server.ts'
import { hashOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import {
    getSessionByTokenService,
    revokeSessionByTokenService,
} from '@/server/Auth/Access/sessions.service.ts'
import { isSessionRecentlyAuthenticated } from '@/server/Auth/Access/authorization.service.ts'
import { loginService } from '@/server/Auth/Login/login.service.ts'
import { authenticateOidcIdentityService } from '@/server/Auth/Oidc/oidc-login.service.ts'
import { getOidcClientConfigurationService } from '@/server/Auth/Oidc/oidc-providers.service.ts'
import {
    buildStoredOidcSettings,
    lockStoredOidcSettings,
    writeStoredOidcSettings,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'
import type {
    StoredOidcProvider,
    StoredOidcSettings,
} from '@/server/Auth/Oidc/Types/oidc-provider.types.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'
import {
    completeLoginMfaWithRecoveryCodeService,
    completeLoginMfaWithTotpService,
} from '@/server/Auth/TwoFactor/two-factor.service.ts'
import {
    createRecoveryCodeBatch,
    createTotpSecret,
} from '@/server/Auth/TwoFactor/two-factor-credentials.server.ts'
import { getAuthChallenge } from '@/server/Valkey/auth-challenges.service.ts'
import { closeValkeyClient, getValkeyClient } from '@/server/Valkey/client.server.ts'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const securityEnabled =
    enabled && process.env.RENTNERPROXY_VALKEY_INTEGRATION === '1' && getValkeyUrl() !== null
const integrationTest = enabled ? test : test.skip
const securityIntegrationTest = securityEnabled ? test : test.skip
const providerId = randomUUID()
const roleId = randomUUID()
const roleKey = `oidc-integration-${randomUUID()}`
const password = 'isolated OIDC local recovery password'
const issuer = 'https://oidc-integration.example.test'
const subject = 'opaque-existing-identity'
const createdUserIds: string[] = []
const challengeIds = new Set<string>()
let snapshot: StoredOidcSettings | undefined
let fixtureReady = false
let createdPermissionId: string | undefined
let originalEncryptionKey: string | undefined
let passwordHash = ''
let userId = ''
let email = ''
let configuration: OidcClientConfiguration

async function fixtureSessions() {
    return getAuthDatabase().select().from(sessions).where(eq(sessions.userId, userId))
}

async function changeProvider(change: (provider: StoredOidcProvider) => StoredOidcProvider) {
    await getAuthDatabase().transaction(async (transaction) => {
        const current = await lockStoredOidcSettings(transaction)
        const revision = current.revision + 1
        await writeStoredOidcSettings(transaction, {
            ...current,
            revision,
            providers: current.providers.map((provider) =>
                provider.id === providerId
                    ? Object.assign({}, change(provider), { revision })
                    : provider,
            ),
        })
    })
}

async function restoreProviders() {
    const saved = snapshot
    if (!saved) return
    await getAuthDatabase().transaction(async (transaction) => {
        const current = await lockStoredOidcSettings(transaction)
        // Services commit their own transactions, so restore the snapshot with a newer tombstone revision.
        await writeStoredOidcSettings(transaction, { ...saved, revision: current.revision + 1 })
    })
}

async function challenge() {
    const result = await authenticateOidcIdentityService(configuration, { issuer, subject })
    if (!result.success || !result.requiresTwoFactor)
        throw new Error('Expected a local MFA challenge.')
    challengeIds.add(result.challenge.id)
    return result.challenge.id
}

async function installFactor() {
    const secret = createTotpSecret()
    const encrypted = await encryptSecret(secret, `rentnerproxy:totp:${userId}`)
    const recovery = (await createRecoveryCodeBatch())[0]
    if (!recovery) throw new Error('Missing synthetic recovery code.')
    await getAuthDatabase().transaction(async (transaction) => {
        await transaction.insert(userTotpFactors).values({
            userId,
            secretCiphertext: encrypted.ciphertext,
            secretIv: encrypted.iv,
            lastUsedCounter: -1,
        })
        await transaction.insert(userRecoveryCodes).values({ userId, codeHash: recovery.hash })
    })
    const totp = new OTPAuth.TOTP({
        algorithm: TOTP_ALGORITHM,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD_SECONDS,
        secret: OTPAuth.Secret.fromBase32(secret),
    })
    return { token: () => totp.generate(), recoveryCode: recovery.plaintext }
}

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test') {
        throw new Error('OIDC authentication integration requires the disposable test database.')
    }
    if (process.env.APP_ENCRYPTION_KEY_FILE)
        throw new Error('Integration fixtures require an inline synthetic encryption key.')
    originalEncryptionKey = process.env.APP_ENCRYPTION_KEY
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64')
    passwordHash = await hashPassword(password)
    snapshot = await getAuthDatabase().transaction((transaction) =>
        lockStoredOidcSettings(transaction),
    )
    await getAuthDatabase().transaction(async (transaction) => {
        const [inserted] = await transaction
            .insert(permissions)
            .values({ key: PERMISSIONS.APP_ACCESS, name: 'Application access' })
            .onConflictDoNothing({ target: permissions.key })
            .returning({ id: permissions.id })
        createdPermissionId = inserted?.id
        const [permission] = await transaction
            .select({ id: permissions.id })
            .from(permissions)
            .where(eq(permissions.key, PERMISSIONS.APP_ACCESS))
        if (!permission) throw new Error('Missing application access permission.')
        await transaction
            .insert(roles)
            .values({ id: roleId, key: roleKey, name: 'Isolated OIDC test role' })
        await transaction.insert(rolePermissions).values({ roleId, permissionId: permission.id })
    })
    fixtureReady = true
    if (securityEnabled) {
        const client = getValkeyClient()
        if (!client || (await client.ping()) !== 'PONG')
            throw new Error('Disposable Valkey is unavailable.')
    }
})

beforeEach(async () => {
    if (!fixtureReady) return
    userId = randomUUID()
    email = `oidc-${randomUUID()}@auth-test.invalid`
    createdUserIds.push(userId)
    await getAuthDatabase().transaction(async (transaction) => {
        await transaction.insert(users).values({
            id: userId,
            displayName: 'OIDC fixture',
            email,
            passwordHash,
            status: 'active',
            emailVerifiedAt: new Date(),
        })
        await transaction.insert(userRoles).values({ userId, roleId })
        const current = await lockStoredOidcSettings(transaction)
        const existing = current.providers.filter((provider) => provider.id !== providerId)
        const next = await buildStoredOidcSettings(current, {
            expectedRevision: current.revision,
            providers: [
                ...existing.map(
                    ({ clientSecret: _secret, revision: _revision, ...provider }) => provider,
                ),
                {
                    id: providerId,
                    name: 'Isolated IdP',
                    enabled: true,
                    issuer,
                    clientId: 'synthetic-client',
                    clientSecret: 'synthetic-client-secret',
                    tokenEndpointAuthMethod: 'client_secret_basic',
                    allowedEndpointOrigins: [issuer],
                    allowedPrivateCidrs: [],
                    bindings: [{ subject, userId }],
                },
            ],
        })
        await writeStoredOidcSettings(transaction, next)
    })
    configuration = await getOidcClientConfigurationService(providerId)
})

afterEach(async () => {
    if (!fixtureReady) return
    try {
        if (securityEnabled && challengeIds.size > 0) {
            const client = getValkeyClient()
            if (!client) throw new Error('Disposable Valkey is unavailable during fixture cleanup.')
            await client.send(
                'DEL',
                [...challengeIds].flatMap((id) => [
                    `rentnerproxy:auth-challenge:login-mfa:${id}`,
                    `rentnerproxy:auth-challenge:verification-lock:login-mfa:${id}`,
                ]),
            )
        }
    } finally {
        challengeIds.clear()
        await restoreProviders()
        if (createdUserIds.length > 0) {
            await getAuthDatabase().delete(users).where(inArray(users.id, createdUserIds))
            createdUserIds.length = 0
        }
    }
})

afterAll(async () => {
    if (!enabled || !snapshot) return
    try {
        await restoreProviders()
        if (createdUserIds.length > 0)
            await getAuthDatabase().delete(users).where(inArray(users.id, createdUserIds))
        await getAuthDatabase().delete(roles).where(eq(roles.id, roleId))
        if (createdPermissionId)
            await getAuthDatabase()
                .delete(permissions)
                .where(eq(permissions.id, createdPermissionId))
    } finally {
        if (originalEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY
        else process.env.APP_ENCRYPTION_KEY = originalEncryptionKey
        if (securityEnabled) closeValkeyClient()
    }
})

describe('OIDC identity authentication with isolated PostgreSQL and Valkey', () => {
    integrationTest(
        'uses an existing account and hashed local session, preserves expiry, freshness and logout',
        async () => {
            const startedAt = Date.now()
            const identity = {
                issuer,
                subject,
                email: 'untrusted@example.test',
                roles: ['owner'],
                groups: ['owner'],
            }
            const result = await authenticateOidcIdentityService(configuration, identity)
            if (!result.success || result.requiresTwoFactor)
                throw new Error('Expected an authenticated local session.')
            expect(result.user.id).toBe(userId)
            expect(result.user.roles).toEqual([roleKey])
            const [stored] = await fixtureSessions()
            expect(stored?.tokenHash).toBe(await hashOpaqueToken(result.session.token))
            expect(stored?.tokenHash).not.toBe(result.session.token)
            expect(stored?.reauthenticatedAt.getTime()).toBe(0)
            expect(result.session.expiresAt.getTime()).toBeGreaterThanOrEqual(
                startedAt + SESSION_DURATION_MS,
            )
            expect(result.session.expiresAt.getTime()).toBeLessThanOrEqual(
                Date.now() + SESSION_DURATION_MS,
            )
            const current = await getSessionByTokenService(result.session.token)
            if (!current) throw new Error('Stored OIDC session was not resolved.')
            expect(isSessionRecentlyAuthenticated(current)).toBeFalse()
            expect(await revokeSessionByTokenService(result.session.token)).toBeTrue()
            expect(await getSessionByTokenService(result.session.token)).toBeNull()
            expect(await fixtureSessions()).toHaveLength(0)
            const [local] = await getAuthDatabase()
                .select({ passwordHash: users.passwordHash })
                .from(users)
                .where(eq(users.id, userId))
            expect(local?.passwordHash).toBe(passwordHash)
            const passwordLogin = await loginService({ email, password })
            expect(passwordLogin).toMatchObject({
                success: true,
                requiresTwoFactor: false,
                user: { id: userId },
            })
            if (!passwordLogin.success || passwordLogin.requiresTwoFactor)
                throw new Error('Local password recovery login failed.')
            const passwordSession = await getSessionByTokenService(passwordLogin.session.token)
            if (!passwordSession) throw new Error('Local password session was not stored.')
            expect(isSessionRecentlyAuthenticated(passwordSession)).toBeTrue()
        },
    )

    integrationTest(
        'does not link another subject through verified email, groups or owner claims',
        async () => {
            const identity = {
                issuer,
                subject: 'unbound-subject',
                email,
                email_verified: true,
                groups: ['owner'],
                roles: ['owner'],
            }
            await expect(
                authenticateOidcIdentityService(configuration, identity),
            ).rejects.toMatchObject({ code: 'identity_not_allowed' })
            expect(await fixtureSessions()).toHaveLength(0)
            const matching = await getAuthDatabase()
                .select({ id: users.id, passwordHash: users.passwordHash })
                .from(users)
                .where(eq(users.email, email))
            expect(matching).toEqual([{ id: userId, passwordHash }])
        },
    )

    for (const invalidation of [
        'provider-disabled',
        'revision-changed',
        'user-disabled',
        'permission-revoked',
    ] as const) {
        integrationTest(`rejects verified identity after ${invalidation}`, async () => {
            if (invalidation === 'provider-disabled')
                await changeProvider((provider) => ({ ...provider, enabled: false }))
            if (invalidation === 'revision-changed')
                await changeProvider((provider) => ({ ...provider, name: 'Updated IdP' }))
            if (invalidation === 'user-disabled')
                await getAuthDatabase()
                    .update(users)
                    .set({ status: 'disabled' })
                    .where(eq(users.id, userId))
            if (invalidation === 'permission-revoked')
                await getAuthDatabase().delete(userRoles).where(eq(userRoles.userId, userId))
            await expect(
                authenticateOidcIdentityService(configuration, { issuer, subject }),
            ).rejects.toMatchObject({ code: 'user_not_active' })
            expect(await fixtureSessions()).toHaveLength(0)
        })
    }

    for (const method of ['totp', 'recovery-code'] as const) {
        securityIntegrationTest(
            `requires and consumes real local ${method} before creating a fresh session`,
            async () => {
                const factor = await installFactor()
                const id = await challenge()
                expect(await fixtureSessions()).toHaveLength(0)
                expect(await getAuthChallenge('login-mfa', id)).toMatchObject({
                    userId,
                    firstFactor: {
                        kind: 'oidc',
                        providerId,
                        providerRevision: configuration.revision,
                        issuer,
                        subject,
                    },
                })
                const complete = () =>
                    method === 'totp'
                        ? completeLoginMfaWithTotpService({
                              challengeId: id,
                              token: factor.token(),
                          })
                        : completeLoginMfaWithRecoveryCodeService({
                              challengeId: id,
                              recoveryCode: factor.recoveryCode,
                          })
                const result = await complete()
                if (!result.success) throw new Error('Valid local MFA was rejected.')
                const current = await getSessionByTokenService(result.session.token)
                if (!current) throw new Error('MFA session was not stored.')
                expect(isSessionRecentlyAuthenticated(current)).toBeTrue()
                expect(await fixtureSessions()).toHaveLength(1)
                expect(await complete()).toEqual({ success: false, code: 'challenge_expired' })
                expect(await fixtureSessions()).toHaveLength(1)
                const [stored] = await getAuthDatabase()
                    .select()
                    .from(userTotpFactors)
                    .where(eq(userTotpFactors.userId, userId))
                const [recovery] = await getAuthDatabase()
                    .select()
                    .from(userRecoveryCodes)
                    .where(eq(userRecoveryCodes.userId, userId))
                if (method === 'totp') expect(stored?.lastUsedCounter).toBeGreaterThan(0)
                else expect(recovery?.usedAt).toBeInstanceOf(Date)
            },
        )
    }

    for (const invalidation of ['revision-changed', 'user-disabled'] as const) {
        securityIntegrationTest(
            `revalidates a real pending MFA challenge after ${invalidation}`,
            async () => {
                const factor = await installFactor()
                const id = await challenge()
                if (invalidation === 'revision-changed')
                    await changeProvider((provider) => ({
                        ...provider,
                        name: 'Changed during MFA',
                    }))
                else
                    await getAuthDatabase()
                        .update(users)
                        .set({ status: 'disabled' })
                        .where(eq(users.id, userId))
                expect(
                    await completeLoginMfaWithRecoveryCodeService({
                        challengeId: id,
                        recoveryCode: factor.recoveryCode,
                    }),
                ).toEqual({ success: false, code: 'authentication_failed' })
                expect(await fixtureSessions()).toHaveLength(0)
                const [recovery] = await getAuthDatabase()
                    .select({ usedAt: userRecoveryCodes.usedAt })
                    .from(userRecoveryCodes)
                    .where(eq(userRecoveryCodes.userId, userId))
                expect(recovery?.usedAt).toBeNull()
            },
        )
    }

    securityIntegrationTest(
        'admits one concurrent TOTP proof across two real OIDC challenges',
        async () => {
            const factor = await installFactor()
            const first = await challenge()
            const second = await challenge()
            const token = factor.token()
            const results = await Promise.all(
                [first, second].map((challengeId) =>
                    completeLoginMfaWithTotpService({ challengeId, token }),
                ),
            )
            expect(results.filter((result) => result.success)).toHaveLength(1)
            expect(results.filter((result) => !result.success)).toHaveLength(1)
            expect(await fixtureSessions()).toHaveLength(1)
        },
    )
})
