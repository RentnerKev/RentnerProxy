import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { and, eq, inArray, like, notLike } from 'drizzle-orm'
import * as OTPAuth from 'otpauth'

import { SESSION_COOKIE_NAME } from '../config/auth.config'

import {
    TOTP_ALGORITHM,
    TOTP_DIGITS,
    TOTP_ISSUER,
    TOTP_PERIOD_SECONDS,
} from '../config/auth-security.config'

import {
    PERMISSIONS,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
    type PermissionKey,
} from '../config/permissions.config'
import {
    passwordResetTokens,
    passkeys,
    permissions,
    rolePermissions,
    roles,
    sessions,
    userInvites,
    userRecoveryCodes,
    userRoles,
    userSettings,
    users,
    userTotpFactors,
} from '../db/schema'
import { getDatabaseUrl, getRedisUrl } from '../server/env.server'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import { acceptInviteService, issueInviteService } from '../server/Auth/Setup/invites.service'
import { decryptSecret } from '../server/Auth/Core/encryption.server'
import { changeCurrentPasswordService } from '../server/Auth/Account/account.service'
import { loginService } from '../server/Auth/Login/login.service'
import { hashPassword, verifyPassword } from '../server/Auth/Core/password.server'
import {
    consumePasswordResetService,
    issuePasswordResetService,
} from '../server/Auth/PasswordReset/password-reset.service'
import {
    assertRoleAssignmentAllowedInTransaction,
    countActiveOwnersInTransaction,
    loadRolesByKeysInTransaction,
    requirePermissionInTransaction,
    resolveActiveUserAccessInTransaction,
} from '../server/Auth/Access/rbac.service'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { enableUserService } from '../server/Admin/UserManagement/users.service'
import {
    createSessionService,
    getSessionByTokenService,
    revokeSessionByTokenService,
} from '../server/Auth/Access/sessions.service'
import {
    beginDiscoverablePasskeyAuthenticationService,
    beginPasskeyRegistrationService,
    deletePasskeyService,
    renamePasskeyService,
} from '../server/Auth/Passkey/passkey.service'
import {
    beginTotpSetupService,
    completeLoginMfaWithRecoveryCodeService,
    completeLoginMfaWithTotpService,
    confirmTotpSetupService,
    createLoginMfaChallengeService,
    disableTotpService,
    regenerateRecoveryCodesService,
} from '../server/Auth/TwoFactor/two-factor.service'
import {
    hashRecoveryCode,
    normalizeRecoveryCode,
} from '../server/Auth/TwoFactor/two-factor-credentials.server'
import { consumeAuthChallenge } from '../server/redis/auth-challenges.service'
import { closeRedisClient, getRedisClient } from '../server/redis/client.server'
import {
    RateLimitError,
    SENSITIVE_ACTION_RATE_LIMITS,
    createRateLimitKey,
    createUserRateLimitKey,
} from '../server/redis/rate-limiter.service'
import {
    setupFirstOwnerService,
    type FirstOwnerSetupResult,
} from '../server/Auth/Setup/setup.service'
import { createOpaqueToken, hashOpaqueToken } from '../server/Auth/Core/tokens.server'
import type { AuthenticatedUser, UserStatus } from '../shared/Types/auth.types'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const TEST_EMAIL_SUFFIX = '@auth-test.invalid'
const TEST_ROLE_PREFIX = 'auth-test-'
const CURRENT_PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'new correct horse battery staple'
const SECURITY_INTEGRATION_ENABLED =
    DATABASE_INTEGRATION_ENABLED &&
    process.env.RENTNERPROXY_REDIS_INTEGRATION === '1' &&
    getRedisUrl() !== null
const securityIntegrationTest = SECURITY_INTEGRATION_ENABLED ? test : test.skip

let preparedPasswordHash = ''
const createdRateLimitKeys = new Set<string>()

function testEmail(label: string): string {
    return `${label}-${randomUUID()}${TEST_EMAIL_SUFFIX}`
}

function requireFirstRow<T>(rows: ReadonlyArray<T>, message: string): T {
    const row = rows.at(0)

    if (!row) {
        throw new Error(message)
    }

    return row
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise
        return null
    } catch (error) {
        return error
    }
}

async function cleanRedisRateLimitKeys(): Promise<void> {
    if (!SECURITY_INTEGRATION_ENABLED || createdRateLimitKeys.size === 0) {
        createdRateLimitKeys.clear()
        return
    }

    const client = getRedisClient()

    if (!client) {
        throw new Error('Redis integration client is unavailable during cleanup.')
    }

    try {
        await client.send('DEL', [...createdRateLimitKeys])
    } finally {
        createdRateLimitKeys.clear()
    }
}

async function cleanTestRows(): Promise<void> {
    const database = getAuthDatabase()

    await database.transaction(async (transaction) => {
        await transaction.delete(users).where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
        await transaction.delete(roles).where(like(roles.key, `${TEST_ROLE_PREFIX}%`))
    })
}

async function assertDedicatedAuthDatabase(): Promise<void> {
    const existingUsers = await getAuthDatabase()
        .select({ email: users.email })
        .from(users)
        .where(notLike(users.email, `%${TEST_EMAIL_SUFFIX}`))
        .limit(1)

    if (existingUsers.length > 0) {
        throw new Error(
            'Auth integration tests require a dedicated database without non-test users.',
        )
    }
}

async function assertUserTableEmpty(): Promise<void> {
    const existingUsers = await getAuthDatabase().select({ id: users.id }).from(users).limit(1)

    if (existingUsers.length > 0) {
        throw new Error('First-owner setup tests require an empty users table.')
    }
}

async function createTestUser(
    input: {
        email?: string
        roleKeys?: ReadonlyArray<string>
        status?: UserStatus
        withPassword?: boolean
    } = {},
) {
    const email = input.email ?? testEmail('user')
    const roleKeys = input.roleKeys ?? [SYSTEM_ROLES.VIEWER]
    const status = input.status ?? 'active'
    const withPassword = input.withPassword ?? status !== 'pending'

    return getAuthDatabase().transaction(async (transaction) => {
        const insertedUsers = await transaction
            .insert(users)
            .values({
                displayName: `Test ${email.slice(0, 20)}`,
                email,
                emailVerifiedAt: status === 'pending' ? null : new Date(),
                passwordHash: withPassword ? preparedPasswordHash : null,
                status,
            })
            .returning({
                email: users.email,
                id: users.id,
                passwordHash: users.passwordHash,
                status: users.status,
            })
        const user = requireFirstRow(insertedUsers, 'Test user was not inserted.')

        if (roleKeys.length > 0) {
            const selectedRoles = await transaction
                .select({ id: roles.id, key: roles.key })
                .from(roles)
                .where(inArray(roles.key, roleKeys))

            if (selectedRoles.length !== new Set(roleKeys).size) {
                throw new Error('A requested test role is unavailable.')
            }

            await transaction.insert(userRoles).values(
                selectedRoles.map((role) => ({
                    roleId: role.id,
                    userId: user.id,
                })),
            )
        }

        return user
    })
}

async function createCustomRole(permissionKeys: ReadonlyArray<string>): Promise<string> {
    const key = `${TEST_ROLE_PREFIX}${randomUUID()}`

    await getAuthDatabase().transaction(async (transaction) => {
        const insertedRoles = await transaction
            .insert(roles)
            .values({
                description: 'Auth integration test role',
                key,
                name: 'Auth integration test role',
            })
            .returning({ id: roles.id })
        const role = requireFirstRow(insertedRoles, 'Test role was not inserted.')
        const selectedPermissions = await transaction
            .select({ id: permissions.id, key: permissions.key })
            .from(permissions)
            .where(inArray(permissions.key, permissionKeys))

        if (selectedPermissions.length !== new Set(permissionKeys).size) {
            throw new Error('A requested test permission is unavailable.')
        }

        await transaction.insert(rolePermissions).values(
            selectedPermissions.map((permission) => ({
                permissionId: permission.id,
                roleId: role.id,
            })),
        )
    })

    return key
}

async function loadActiveAccess(userId: string): Promise<AuthenticatedUser> {
    const access = await getAuthDatabase().transaction((transaction) =>
        resolveActiveUserAccessInTransaction(transaction, userId),
    )

    if (!access) {
        throw new Error('Active user access was not resolved.')
    }

    return access
}

async function runWithSessionToken<T>(token: string, operation: () => Promise<T>): Promise<T> {
    let failed = false
    let failure: unknown
    let result: T | undefined
    const handler = requestHandler(async () => {
        try {
            result = await operation()
        } catch (error) {
            failed = true
            failure = error
        }
        return new Response(null, { status: failed ? 500 : 204 })
    })

    const request = new Request('http://localhost/')
    // DOM test Requests strip Cookie during construction; this models an incoming server request.
    request.headers.set('cookie', `${SESSION_COOKIE_NAME}=${token}`)
    await handler(request, {})

    if (failed) {
        throw failure
    }

    return result as T
}

async function runAsUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    return runWithSessionToken(session.token, operation)
}

async function createPendingInvite(expired = false) {
    const user = await createTestUser({ status: 'pending', withPassword: false })
    const token = createOpaqueToken()
    const tokenHash = await hashOpaqueToken(token)
    const expiresAt = new Date(Date.now() + (expired ? -60_000 : 60_000))
    const insertedInvites = await getAuthDatabase()
        .insert(userInvites)
        .values({ expiresAt, tokenHash, userId: user.id })
        .returning({ id: userInvites.id })

    return {
        inviteId: requireFirstRow(insertedInvites, 'Test invite was not inserted.').id,
        token,
        tokenHash,
        userId: user.id,
    }
}

function permissionsForSystemRole(roleKey: string): ReadonlyArray<PermissionKey> {
    const definition = SYSTEM_ROLE_REGISTRY.find((role) => role.key === roleKey)

    if (!definition) {
        throw new Error(`System role ${roleKey} is unavailable.`)
    }

    return definition.permissionKeys
}

beforeAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) {
        return
    }

    await cleanTestRows()
    await assertDedicatedAuthDatabase()
    preparedPasswordHash = await hashPassword(CURRENT_PASSWORD)
    await getAuthDatabase().transaction((transaction) =>
        ensureAuthorizationRegistryInTransaction(transaction),
    )
    if (SECURITY_INTEGRATION_ENABLED && !getRedisClient()) {
        throw new Error('Redis integration client is unavailable.')
    }
})

beforeEach(async () => {
    if (DATABASE_INTEGRATION_ENABLED) {
        await cleanTestRows()
    }
})

afterEach(async () => {
    if (DATABASE_INTEGRATION_ENABLED) {
        await cleanTestRows()
    }
    await cleanRedisRateLimitKeys()
})

afterAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) {
        return
    }

    await cleanTestRows()
    await cleanRedisRateLimitKeys()
    if (SECURITY_INTEGRATION_ENABLED) {
        closeRedisClient()
    }
})

describe('first-owner setup with PostgreSQL', () => {
    integrationTest('allows only the first setup request', async () => {
        await assertUserTableEmpty()
        const first = await setupFirstOwnerService({
            displayName: 'First Owner',
            email: testEmail('first-owner'),
            password: CURRENT_PASSWORD,
        })
        const second = await setupFirstOwnerService({
            displayName: 'Second Owner',
            email: testEmail('second-owner'),
            password: CURRENT_PASSWORD,
        })

        expect(first.success).toBeTrue()
        expect(second).toEqual({ success: false, code: 'already_initialized' })

        if (!first.success) {
            throw new Error('First owner setup unexpectedly failed.')
        }

        const assignments = await getAuthDatabase()
            .select({ roleKey: roles.key, userId: userRoles.userId })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(eq(userRoles.userId, first.userId))

        expect(assignments).toEqual([{ roleKey: SYSTEM_ROLES.OWNER, userId: first.userId }])
    })

    integrationTest('serializes parallel setup requests to one owner', async () => {
        await assertUserTableEmpty()
        const inputs = [
            {
                displayName: 'Parallel Owner One',
                email: testEmail('parallel-one'),
                password: CURRENT_PASSWORD,
            },
            {
                displayName: 'Parallel Owner Two',
                email: testEmail('parallel-two'),
                password: CURRENT_PASSWORD,
            },
        ]
        const results = await Promise.all(inputs.map((input) => setupFirstOwnerService(input)))
        const successes = results.filter(
            (result): result is Extract<FirstOwnerSetupResult, { success: true }> => result.success,
        )
        const failures = results.filter((result) => !result.success)
        const persistedUsers = await getAuthDatabase().select({ id: users.id }).from(users)

        expect(successes).toHaveLength(1)
        expect(failures).toEqual([{ success: false, code: 'already_initialized' }])
        expect(persistedUsers).toHaveLength(1)
    })
})

describe('login with PostgreSQL', () => {
    integrationTest('creates a hashed session for valid credentials', async () => {
        const email = testEmail('login-valid')
        const user = await createTestUser({ email })
        const result = await loginService({
            email: email.toUpperCase(),
            password: CURRENT_PASSWORD,
        })

        expect(result.success).toBeTrue()

        if (!result.success || result.requiresTwoFactor) {
            throw new Error('Valid login unexpectedly failed.')
        }

        const storedSessions = await getAuthDatabase()
            .select({ tokenHash: sessions.tokenHash, userId: sessions.userId })
            .from(sessions)
            .where(eq(sessions.id, result.session.id))
        const storedSession = requireFirstRow(storedSessions, 'Login session was not stored.')

        expect(result.user.id).toBe(user.id)
        expect(result.user.roles).toEqual([SYSTEM_ROLES.VIEWER])
        expect(storedSession.userId).toBe(user.id)
        expect(storedSession.tokenHash).toBe(await hashOpaqueToken(result.session.token))
        expect(storedSession.tokenHash).not.toContain(result.session.token)
    })

    integrationTest('returns the same denial for wrong, unknown, and disabled users', async () => {
        const active = await createTestUser({ email: testEmail('login-active') })
        const disabled = await createTestUser({
            email: testEmail('login-disabled'),
            status: 'disabled',
        })
        const wrongPassword = await loginService({
            email: active.email,
            password: 'a definitely incorrect password',
        })
        const unknownUser = await loginService({
            email: testEmail('login-unknown'),
            password: CURRENT_PASSWORD,
        })
        const disabledUser = await loginService({
            email: disabled.email,
            password: CURRENT_PASSWORD,
        })
        const storedSessions = await getAuthDatabase()
            .select({ id: sessions.id })
            .from(sessions)
            .where(inArray(sessions.userId, [active.id, disabled.id]))

        expect(wrongPassword).toEqual({ success: false, code: 'invalid_credentials' })
        expect(unknownUser).toEqual({ success: false, code: 'invalid_credentials' })
        expect(disabledUser).toEqual({ success: false, code: 'invalid_credentials' })
        expect(storedSessions).toEqual([])
    })
})

describe('sessions with PostgreSQL', () => {
    integrationTest('looks up, expires, and revokes opaque sessions', async () => {
        const user = await createTestUser()
        const expiringSession = await createSessionService(user.id)
        const current = await getSessionByTokenService(expiringSession.token)

        expect(current).toMatchObject({
            id: expiringSession.id,
            user: { id: user.id, roles: [SYSTEM_ROLES.VIEWER] },
        })
        expect(await getSessionByTokenService('not-an-opaque-token')).toBeNull()

        await getAuthDatabase()
            .update(sessions)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(sessions.id, expiringSession.id))
        expect(await getSessionByTokenService(expiringSession.token)).toBeNull()

        const revokedSession = await createSessionService(user.id)
        expect(await revokeSessionByTokenService(revokedSession.token)).toBeTrue()
        expect(await revokeSessionByTokenService(revokedSession.token)).toBeFalse()
        expect(await getSessionByTokenService(revokedSession.token)).toBeNull()
    })

    integrationTest('denies an existing session after app access is removed', async () => {
        const user = await createTestUser()
        const session = await createSessionService(user.id)

        expect(session.user.permissions).toContain(PERMISSIONS.APP_ACCESS)
        await getAuthDatabase().delete(userRoles).where(eq(userRoles.userId, user.id))

        expect(await getSessionByTokenService(session.token)).toBeNull()
    })
})

describe('RBAC with PostgreSQL', () => {
    integrationTest(
        "loads each user's persisted settings independently and preserves sibling values on upsert",
        async () => {
            const darkUser = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
            const lightUser = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })

            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(lightUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(darkUser.id)).language).toBe('en')
            expect((await loadActiveAccess(lightUser.id)).language).toBe('en')

            await getAuthDatabase().insert(userSettings).values({
                language: 'de',
                themeMode: 'dark',
                userId: darkUser.id,
            })
            await getAuthDatabase().insert(userSettings).values({
                language: 'fr',
                themeMode: 'light',
                userId: lightUser.id,
            })

            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('dark')
            expect((await loadActiveAccess(lightUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(darkUser.id)).language).toBe('de')
            expect((await loadActiveAccess(lightUser.id)).language).toBe('fr')

            await getAuthDatabase()
                .insert(userSettings)
                .values({ themeMode: 'light', userId: darkUser.id })
                .onConflictDoUpdate({
                    target: userSettings.userId,
                    set: { themeMode: 'light' },
                })
            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(darkUser.id)).language).toBe('de')

            await getAuthDatabase()
                .insert(userSettings)
                .values({ language: 'es', userId: darkUser.id })
                .onConflictDoUpdate({
                    target: userSettings.userId,
                    set: { language: 'es' },
                })
            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(darkUser.id)).language).toBe('es')
            expect((await loadActiveAccess(lightUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(lightUser.id)).language).toBe('fr')
        },
    )

    integrationTest('resolves owner, admin, viewer, and additive multi-role access', async () => {
        const customRoleKey = await createCustomRole([PERMISSIONS.USERS_VIEW])
        const customEnableRoleKey = await createCustomRole([PERMISSIONS.USERS_ENABLE])
        const owner = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
        const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
        const viewer = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
        const multiRole = await createTestUser({
            roleKeys: [SYSTEM_ROLES.VIEWER, customRoleKey],
        })
        const explicitlyEnabled = await createTestUser({ roleKeys: [customEnableRoleKey] })
        const [ownerAccess, adminAccess, viewerAccess, multiRoleAccess, explicitlyEnabledAccess] =
            await Promise.all([
                loadActiveAccess(owner.id),
                loadActiveAccess(admin.id),
                loadActiveAccess(viewer.id),
                loadActiveAccess(multiRole.id),
                loadActiveAccess(explicitlyEnabled.id),
            ])
        const expectedMultiRolePermissions = [
            ...new Set([...permissionsForSystemRole(SYSTEM_ROLES.VIEWER), PERMISSIONS.USERS_VIEW]),
        ].toSorted()

        expect(ownerAccess.permissions.toSorted()).toEqual(
            permissionsForSystemRole(SYSTEM_ROLES.OWNER).toSorted(),
        )
        expect(adminAccess.permissions.toSorted()).toEqual(
            permissionsForSystemRole(SYSTEM_ROLES.ADMIN).toSorted(),
        )
        expect(viewerAccess.permissions.toSorted()).toEqual(
            permissionsForSystemRole(SYSTEM_ROLES.VIEWER).toSorted(),
        )
        expect(multiRoleAccess.roles.toSorted()).toEqual(
            [SYSTEM_ROLES.VIEWER, customRoleKey].toSorted(),
        )
        expect(multiRoleAccess.permissions.toSorted()).toEqual(expectedMultiRolePermissions)
        expect(ownerAccess.permissions).toContain(PERMISSIONS.USERS_ENABLE)
        expect(adminAccess.permissions).toContain(PERMISSIONS.USERS_ENABLE)
        expect(viewerAccess.permissions).not.toContain(PERMISSIONS.USERS_ENABLE)
        expect(multiRoleAccess.permissions).not.toContain(PERMISSIONS.USERS_ENABLE)
        expect(explicitlyEnabledAccess.permissions).toContain(PERMISSIONS.USERS_ENABLE)
    })

    integrationTest(
        'repairs missing system enable permission assignments idempotently',
        async () => {
            const customRoleKey = await createCustomRole([PERMISSIONS.USERS_VIEW])
            const explicitRoleKey = await createCustomRole([PERMISSIONS.USERS_ENABLE])
            const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
            const viewer = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
            const custom = await createTestUser({ roleKeys: [customRoleKey] })
            const explicit = await createTestUser({ roleKeys: [explicitRoleKey] })
            const adminRole = requireFirstRow(
                await getAuthDatabase()
                    .select({ id: roles.id })
                    .from(roles)
                    .where(eq(roles.key, SYSTEM_ROLES.ADMIN)),
                'Admin role was not found.',
            )
            const enablePermission = requireFirstRow(
                await getAuthDatabase()
                    .select({ id: permissions.id })
                    .from(permissions)
                    .where(eq(permissions.key, PERMISSIONS.USERS_ENABLE)),
                'Enable permission was not found.',
            )

            await getAuthDatabase()
                .delete(rolePermissions)
                .where(
                    and(
                        eq(rolePermissions.roleId, adminRole.id),
                        eq(rolePermissions.permissionId, enablePermission.id),
                    ),
                )
            await getAuthDatabase().transaction((transaction) =>
                ensureAuthorizationRegistryInTransaction(transaction),
            )
            await getAuthDatabase().transaction((transaction) =>
                ensureAuthorizationRegistryInTransaction(transaction),
            )

            const [adminAccess, viewerAccess, customAccess, explicitAccess] = await Promise.all([
                loadActiveAccess(admin.id),
                loadActiveAccess(viewer.id),
                loadActiveAccess(custom.id),
                loadActiveAccess(explicit.id),
            ])
            expect(adminAccess.permissions).toContain(PERMISSIONS.USERS_ENABLE)
            expect(viewerAccess.permissions).not.toContain(PERMISSIONS.USERS_ENABLE)
            expect(customAccess.permissions).not.toContain(PERMISSIONS.USERS_ENABLE)
            expect(explicitAccess.permissions).toContain(PERMISSIONS.USERS_ENABLE)

            const repairedAssignments = await getAuthDatabase()
                .select({ permissionId: rolePermissions.permissionId })
                .from(rolePermissions)
                .where(
                    and(
                        eq(rolePermissions.roleId, adminRole.id),
                        eq(rolePermissions.permissionId, enablePermission.id),
                    ),
                )
            expect(repairedAssignments).toHaveLength(1)
        },
    )

    integrationTest('denies missing permissions and owner assignment by an admin', async () => {
        const viewer = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
        const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
        const viewerDenial = await getAuthDatabase().transaction((transaction) =>
            captureError(
                requirePermissionInTransaction(transaction, viewer.id, PERMISSIONS.USERS_VIEW),
            ),
        )
        const adminAccess = await loadActiveAccess(admin.id)
        const ownerAssignmentDenial = await getAuthDatabase().transaction(async (transaction) => {
            const ownerRoles = await loadRolesByKeysInTransaction(transaction, [SYSTEM_ROLES.OWNER])
            return captureError(
                assertRoleAssignmentAllowedInTransaction(transaction, adminAccess, ownerRoles),
            )
        })

        expect(viewerDenial).toBeInstanceOf(AuthDomainError)
        expect(viewerDenial).toMatchObject({ code: 'permission_denied' })
        expect(ownerAssignmentDenial).toBeInstanceOf(AuthDomainError)
        expect(ownerAssignmentDenial).toMatchObject({ code: 'owner_required' })
    })

    integrationTest('counts only active owners for last-owner enforcement', async () => {
        await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
        const disabledOwner = await createTestUser({
            roleKeys: [SYSTEM_ROLES.OWNER],
            status: 'disabled',
        })
        const initialCount = await getAuthDatabase().transaction((transaction) =>
            countActiveOwnersInTransaction(transaction),
        )
        const secondActiveOwner = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
        const twoOwnerCount = await getAuthDatabase().transaction((transaction) =>
            countActiveOwnersInTransaction(transaction),
        )

        await getAuthDatabase()
            .update(users)
            .set({ status: 'disabled' })
            .where(eq(users.id, secondActiveOwner.id))
        const finalCount = await getAuthDatabase().transaction((transaction) =>
            countActiveOwnersInTransaction(transaction),
        )

        expect(disabledOwner.status).toBe('disabled')
        expect(initialCount).toBe(1)
        expect(twoOwnerCount).toBe(2)
        expect(finalCount).toBe(1)
    })
})

describe('user enablement with PostgreSQL', () => {
    integrationTest(
        'enables a disabled user without changing roles, credentials, or related rows',
        async () => {
            const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
            const target = await createTestUser({
                roleKeys: [SYSTEM_ROLES.VIEWER],
                status: 'disabled',
            })
            const beforeUsers = await getAuthDatabase()
                .select({
                    createdAt: users.createdAt,
                    passwordHash: users.passwordHash,
                    status: users.status,
                    updatedAt: users.updatedAt,
                })
                .from(users)
                .where(eq(users.id, target.id))
            const beforeUser = requireFirstRow(beforeUsers, 'Disabled target was not found.')
            const beforeRoles = await getAuthDatabase()
                .select({ roleKey: roles.key })
                .from(userRoles)
                .innerJoin(roles, eq(roles.id, userRoles.roleId))
                .where(eq(userRoles.userId, target.id))
            const beforeSessions = await getAuthDatabase()
                .select({ id: sessions.id })
                .from(sessions)
                .where(eq(sessions.userId, target.id))
            const beforeInvites = await getAuthDatabase()
                .select({ id: userInvites.id })
                .from(userInvites)
                .where(eq(userInvites.userId, target.id))

            const result = await runAsUser(admin.id, () => enableUserService(target.id))

            expect(result).toMatchObject({
                id: target.id,
                roleKeys: [SYSTEM_ROLES.VIEWER],
                status: 'active',
            })
            const afterUsers = await getAuthDatabase()
                .select({
                    createdAt: users.createdAt,
                    passwordHash: users.passwordHash,
                    status: users.status,
                    updatedAt: users.updatedAt,
                })
                .from(users)
                .where(eq(users.id, target.id))
            const afterUser = requireFirstRow(afterUsers, 'Enabled target was not found.')
            const afterRoles = await getAuthDatabase()
                .select({ roleKey: roles.key })
                .from(userRoles)
                .innerJoin(roles, eq(roles.id, userRoles.roleId))
                .where(eq(userRoles.userId, target.id))
            const afterSessions = await getAuthDatabase()
                .select({ id: sessions.id })
                .from(sessions)
                .where(eq(sessions.userId, target.id))
            const afterInvites = await getAuthDatabase()
                .select({ id: userInvites.id })
                .from(userInvites)
                .where(eq(userInvites.userId, target.id))

            expect(afterUser.status).toBe('active')
            expect(afterUser.createdAt).toEqual(beforeUser.createdAt)
            expect(afterUser.passwordHash).toBe(beforeUser.passwordHash)
            expect(afterUser.updatedAt.getTime()).toBeGreaterThanOrEqual(
                beforeUser.updatedAt.getTime(),
            )
            expect(afterRoles).toEqual(beforeRoles)
            expect(afterSessions).toEqual(beforeSessions)
            expect(afterInvites).toEqual(beforeInvites)
        },
    )

    integrationTest(
        'rejects active, pending, incomplete-disabled, and unknown targets',
        async () => {
            const owner = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
            const active = await createTestUser({ status: 'active' })
            const pending = await createTestUser({ status: 'pending', withPassword: false })
            const incompleteDisabled = await createTestUser({
                status: 'disabled',
                withPassword: false,
            })

            const errors = await Promise.all(
                [active, pending, incompleteDisabled].map((user) =>
                    captureError(runAsUser(owner.id, () => enableUserService(user.id))),
                ),
            )
            for (const error of errors) {
                expect(error).toBeInstanceOf(AuthDomainError)
                expect(error).toMatchObject({ code: 'invalid_input' })
            }
            const missingError = await captureError(
                runAsUser(owner.id, () => enableUserService(randomUUID())),
            )
            expect(missingError).toBeInstanceOf(AuthDomainError)
            expect(missingError).toMatchObject({ code: 'user_not_found' })

            const statuses = await getAuthDatabase()
                .select({ id: users.id, status: users.status })
                .from(users)
                .where(inArray(users.id, [active.id, pending.id, incompleteDisabled.id]))
            expect(statuses).toEqual(
                expect.arrayContaining([
                    { id: active.id, status: 'active' },
                    { id: pending.id, status: 'pending' },
                    { id: incompleteDisabled.id, status: 'disabled' },
                ]),
            )
        },
    )

    integrationTest('denies missing permission and rejects a disabled actor', async () => {
        const viewer = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
        const target = await createTestUser({ status: 'disabled' })
        const viewerError = await captureError(
            runAsUser(viewer.id, () => enableUserService(target.id)),
        )
        expect(viewerError).toBeInstanceOf(AuthDomainError)
        expect(viewerError).toMatchObject({ code: 'permission_denied' })

        const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
        const adminSession = await createSessionService(admin.id)
        await getAuthDatabase()
            .update(users)
            .set({ status: 'disabled' })
            .where(eq(users.id, admin.id))
        const disabledActorError = await captureError(
            runWithSessionToken(adminSession.token, () => enableUserService(target.id)),
        )
        expect(disabledActorError).toBeInstanceOf(AuthDomainError)
        expect(disabledActorError).toMatchObject({ code: 'authentication_required' })
    })

    integrationTest(
        'lets an owner enable a disabled owner while an admin is rejected',
        async () => {
            const owner = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
            const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
            const disabledOwner = await createTestUser({
                roleKeys: [SYSTEM_ROLES.OWNER],
                status: 'disabled',
            })

            const adminError = await captureError(
                runAsUser(admin.id, () => enableUserService(disabledOwner.id)),
            )
            expect(adminError).toBeInstanceOf(AuthDomainError)
            expect(adminError).toMatchObject({ code: 'owner_required' })

            const result = await runAsUser(owner.id, () => enableUserService(disabledOwner.id))
            expect(result).toMatchObject({
                id: disabledOwner.id,
                roleKeys: [SYSTEM_ROLES.OWNER],
                status: 'active',
            })
        },
    )
})

describe('password reset with PostgreSQL', () => {
    integrationTest('rejects unknown capabilities before password hashing', async () => {
        expect(
            await consumePasswordResetService({
                password: 'too-short',
                token: createOpaqueToken(),
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })
    })

    integrationTest('enforces expiry and one-time use while revoking sessions', async () => {
        const user = await createTestUser({ email: testEmail('reset') })
        const session = await createSessionService(user.id)
        const expiredDelivery = await issuePasswordResetService(user.email.toUpperCase())

        if (!expiredDelivery) {
            throw new Error('Password reset delivery was not issued.')
        }

        const storedExpiredTokens = await getAuthDatabase()
            .select({ id: passwordResetTokens.id, tokenHash: passwordResetTokens.tokenHash })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, user.id))
        const storedExpiredToken = requireFirstRow(
            storedExpiredTokens,
            'Password reset token was not stored.',
        )

        expect(storedExpiredToken.tokenHash).toBe(await hashOpaqueToken(expiredDelivery.token))
        expect(storedExpiredToken.tokenHash).not.toContain(expiredDelivery.token)

        await getAuthDatabase()
            .update(passwordResetTokens)
            .set({ expiresAt: new Date(Date.now() - 1_000) })
            .where(eq(passwordResetTokens.id, storedExpiredToken.id))
        expect(
            await consumePasswordResetService({
                password: NEW_PASSWORD,
                token: expiredDelivery.token,
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })
        expect(await getSessionByTokenService(session.token)).not.toBeNull()

        const activeDelivery = await issuePasswordResetService(user.email)

        if (!activeDelivery) {
            throw new Error('Replacement password reset delivery was not issued.')
        }

        expect(
            await consumePasswordResetService({
                password: NEW_PASSWORD,
                token: activeDelivery.token,
            }),
        ).toEqual({ success: true, userId: user.id })
        expect(
            await consumePasswordResetService({
                password: NEW_PASSWORD,
                token: activeDelivery.token,
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })
        expect(await getSessionByTokenService(session.token)).toBeNull()

        const updatedUsers = await getAuthDatabase()
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, user.id))
        const updatedUser = requireFirstRow(updatedUsers, 'Reset user was not found.')

        expect(updatedUser.passwordHash).not.toBeNull()
        expect(await verifyPassword(NEW_PASSWORD, updatedUser.passwordHash ?? '')).toBeTrue()
    })

    integrationTest('keeps issued links usable until one password reset succeeds', async () => {
        const user = await createTestUser({ email: testEmail('parallel-reset') })
        const firstDelivery = await issuePasswordResetService(user.email)
        const secondDelivery = await issuePasswordResetService(user.email)

        if (!firstDelivery || !secondDelivery) {
            throw new Error('Password reset deliveries were not issued.')
        }

        const storedTokens = await getAuthDatabase()
            .select({ tokenHash: passwordResetTokens.tokenHash })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.userId, user.id))

        expect(storedTokens.map((token) => token.tokenHash).toSorted()).toEqual(
            [
                await hashOpaqueToken(firstDelivery.token),
                await hashOpaqueToken(secondDelivery.token),
            ].toSorted(),
        )
        expect(
            await consumePasswordResetService({
                password: NEW_PASSWORD,
                token: firstDelivery.token,
            }),
        ).toEqual({ success: true, userId: user.id })
        expect(
            await consumePasswordResetService({
                password: NEW_PASSWORD,
                token: secondDelivery.token,
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })
    })
})

describe('user invites with PostgreSQL', () => {
    integrationTest('rejects unknown capabilities before password hashing', async () => {
        expect(
            await acceptInviteService({
                displayName: 'Unknown Invite',
                password: 'too-short',
                token: createOpaqueToken(),
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })
    })

    integrationTest('activates a pending invite once and rejects expired invites', async () => {
        const pendingInvite = await createPendingInvite()
        const pendingUsers = await getAuthDatabase()
            .select({ passwordHash: users.passwordHash, status: users.status })
            .from(users)
            .where(eq(users.id, pendingInvite.userId))
        const pendingUser = requireFirstRow(pendingUsers, 'Pending invite user was not found.')

        expect(pendingUser).toEqual({ passwordHash: null, status: 'pending' })
        expect(pendingInvite.tokenHash).toBe(await hashOpaqueToken(pendingInvite.token))
        expect(
            await acceptInviteService({
                displayName: 'Accepted Invite',
                password: NEW_PASSWORD,
                token: pendingInvite.token,
            }),
        ).toEqual({ success: true, userId: pendingInvite.userId })
        expect(
            await acceptInviteService({
                displayName: 'Accepted Again',
                password: NEW_PASSWORD,
                token: pendingInvite.token,
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })

        const acceptedUsers = await getAuthDatabase()
            .select({ passwordHash: users.passwordHash, status: users.status })
            .from(users)
            .where(eq(users.id, pendingInvite.userId))
        const acceptedUser = requireFirstRow(acceptedUsers, 'Accepted invite user was not found.')
        const acceptedInvites = await getAuthDatabase()
            .select({ acceptedAt: userInvites.acceptedAt })
            .from(userInvites)
            .where(eq(userInvites.id, pendingInvite.inviteId))

        expect(acceptedUser.status).toBe('active')
        expect(acceptedUser.passwordHash).not.toBeNull()
        expect(await verifyPassword(NEW_PASSWORD, acceptedUser.passwordHash ?? '')).toBeTrue()
        expect(
            requireFirstRow(acceptedInvites, 'Accepted invite was not found.').acceptedAt,
        ).toBeInstanceOf(Date)

        const expiredInvite = await createPendingInvite(true)

        expect(
            await acceptInviteService({
                displayName: 'Expired Invite',
                password: NEW_PASSWORD,
                token: expiredInvite.token,
            }),
        ).toEqual({ success: false, code: 'invalid_or_expired_token' })

        const expiredUsers = await getAuthDatabase()
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, expiredInvite.userId))
        expect(requireFirstRow(expiredUsers, 'Expired invite user was not found.').status).toBe(
            'pending',
        )
    })
})

describe('sensitive action rate limits with PostgreSQL and Redis', () => {
    securityIntegrationTest(
        'admits ten wrong password changes, isolates users, and rejects the eleventh',
        async () => {
            const user = await createTestUser()
            const otherUser = await createTestUser()
            const userKey = createUserRateLimitKey(
                SENSITIVE_ACTION_RATE_LIMITS.passwordChange.scope,
                user.id,
            )
            const otherUserKey = createUserRateLimitKey(
                SENSITIVE_ACTION_RATE_LIMITS.passwordChange.scope,
                otherUser.id,
            )
            createdRateLimitKeys.add(userKey)
            createdRateLimitKeys.add(otherUserKey)
            const session = await createSessionService(user.id)
            const otherSession = await createSessionService(otherUser.id)

            for (let attempt = 0; attempt < 10; attempt += 1) {
                // oxlint-disable-next-line eslint/no-await-in-loop -- Attempts must consume one shared Redis window in order.
                const result = await runWithSessionToken(session.token, () =>
                    changeCurrentPasswordService({
                        currentPassword: 'wrong current password',
                        password: NEW_PASSWORD,
                    }),
                )
                expect(result).toEqual({ success: false, code: 'invalid_current_password' })
            }

            const eleventhError = await captureError(
                runWithSessionToken(session.token, () =>
                    changeCurrentPasswordService({
                        currentPassword: 'wrong current password',
                        password: NEW_PASSWORD,
                    }),
                ),
            )
            expect(eleventhError).toBeInstanceOf(RateLimitError)
            expect(eleventhError).toMatchObject({
                count: 11,
                limit: SENSITIVE_ACTION_RATE_LIMITS.passwordChange.limit,
                scope: SENSITIVE_ACTION_RATE_LIMITS.passwordChange.scope,
            })

            const otherResult = await runWithSessionToken(otherSession.token, () =>
                changeCurrentPasswordService({
                    currentPassword: 'wrong current password',
                    password: NEW_PASSWORD,
                }),
            )
            expect(otherResult).toEqual({ success: false, code: 'invalid_current_password' })

            const storedUsers = await getAuthDatabase()
                .select({ email: users.email, passwordHash: users.passwordHash })
                .from(users)
                .where(inArray(users.id, [user.id, otherUser.id]))
            expect(storedUsers).toHaveLength(2)
            expect(
                storedUsers.every(
                    (storedUser) =>
                        storedUser.passwordHash !== null &&
                        storedUser.passwordHash === preparedPasswordHash,
                ),
            ).toBeTrue()
        },
    )

    securityIntegrationTest(
        'resends one normalized pending invite five times and rejects the sixth',
        async () => {
            const actor = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
            const actorKey = createUserRateLimitKey(
                SENSITIVE_ACTION_RATE_LIMITS.invite.actor.scope,
                actor.id,
            )
            const inviteEmail = testEmail('pending-target')
            const emailVariants = [
                ` ${inviteEmail.toUpperCase()} `,
                inviteEmail,
                ` ${inviteEmail.toUpperCase()}`,
                `${inviteEmail} `,
                ` ${inviteEmail.toUpperCase()}`,
            ]
            const emailKey = createRateLimitKey(
                SENSITIVE_ACTION_RATE_LIMITS.invite.email.scope,
                emailVariants[0] ?? '',
            )
            createdRateLimitKeys.add(actorKey)
            createdRateLimitKeys.add(emailKey)
            const session = await createSessionService(actor.id)
            const deliveries = []

            for (const email of emailVariants) {
                // oxlint-disable-next-line eslint/no-await-in-loop -- Each resend must replace the same pending invite in order.
                const delivery = await runWithSessionToken(session.token, () =>
                    issueInviteService({ email, roleKeys: [SYSTEM_ROLES.VIEWER] }),
                )
                deliveries.push(delivery)
            }

            const firstDelivery = requireFirstRow(deliveries, 'Initial invite was not delivered.')
            expect(new Set(deliveries.map((delivery) => delivery.userId))).toEqual(
                new Set([firstDelivery.userId]),
            )
            const lastDelivery = deliveries.at(-1)
            if (!lastDelivery) {
                throw new Error('Final invite was not delivered.')
            }
            const inviteBeforeDenial = requireFirstRow(
                await getAuthDatabase()
                    .select({ id: userInvites.id, tokenHash: userInvites.tokenHash })
                    .from(userInvites)
                    .where(eq(userInvites.userId, lastDelivery.userId)),
                'Pending invite was not stored.',
            )
            expect(inviteBeforeDenial.tokenHash).toBe(await hashOpaqueToken(lastDelivery.token))

            const sixthError = await captureError(
                runWithSessionToken(session.token, () =>
                    issueInviteService({
                        email: ` ${inviteEmail.toUpperCase()} `,
                        roleKeys: [SYSTEM_ROLES.VIEWER],
                    }),
                ),
            )
            expect(sixthError).toBeInstanceOf(RateLimitError)
            expect(sixthError).toMatchObject({
                count: 6,
                limit: SENSITIVE_ACTION_RATE_LIMITS.invite.email.limit,
                scope: SENSITIVE_ACTION_RATE_LIMITS.invite.email.scope,
            })

            const pendingUsers = await getAuthDatabase()
                .select({ id: users.id, status: users.status })
                .from(users)
                .where(eq(users.id, lastDelivery.userId))
            const inviteAfterDenial = await getAuthDatabase()
                .select({ id: userInvites.id, tokenHash: userInvites.tokenHash })
                .from(userInvites)
                .where(eq(userInvites.userId, lastDelivery.userId))
            expect(pendingUsers).toEqual([{ id: lastDelivery.userId, status: 'pending' }])
            expect(inviteAfterDenial).toEqual([inviteBeforeDenial])
        },
    )

    securityIntegrationTest(
        'rejects the twenty-first invite for an actor without creating its user or invite',
        async () => {
            const actor = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
            const session = await createSessionService(actor.id)
            const emails = Array.from({ length: 21 }, (_, index) =>
                testEmail(`rate-limit-invite-${index}`),
            )
            createdRateLimitKeys.add(
                createUserRateLimitKey(SENSITIVE_ACTION_RATE_LIMITS.invite.actor.scope, actor.id),
            )
            for (const email of emails) {
                createdRateLimitKeys.add(
                    createRateLimitKey(SENSITIVE_ACTION_RATE_LIMITS.invite.email.scope, email),
                )
            }

            for (const email of emails.slice(0, 20)) {
                // oxlint-disable-next-line eslint/no-await-in-loop -- Actor counter must cross its threshold deterministically.
                await runWithSessionToken(session.token, () =>
                    issueInviteService({ email, roleKeys: [SYSTEM_ROLES.VIEWER] }),
                )
            }

            const beforeUsers = await getAuthDatabase()
                .select({ email: users.email })
                .from(users)
                .where(inArray(users.email, emails))
            const beforeInvites = await getAuthDatabase()
                .select({ userId: userInvites.userId })
                .from(userInvites)
                .innerJoin(users, eq(users.id, userInvites.userId))
                .where(inArray(users.email, emails))
            const deniedEmail = emails.at(-1)
            if (!deniedEmail) {
                throw new Error('Rate-limit target email was not generated.')
            }

            const twentyFirstError = await captureError(
                runWithSessionToken(session.token, () =>
                    issueInviteService({ email: deniedEmail, roleKeys: [SYSTEM_ROLES.VIEWER] }),
                ),
            )
            expect(twentyFirstError).toBeInstanceOf(RateLimitError)
            expect(twentyFirstError).toMatchObject({
                count: 21,
                limit: SENSITIVE_ACTION_RATE_LIMITS.invite.actor.limit,
                scope: SENSITIVE_ACTION_RATE_LIMITS.invite.actor.scope,
            })

            const afterUsers = await getAuthDatabase()
                .select({ email: users.email })
                .from(users)
                .where(inArray(users.email, emails))
            const afterInvites = await getAuthDatabase()
                .select({ userId: userInvites.userId })
                .from(userInvites)
                .innerJoin(users, eq(users.id, userInvites.userId))
                .where(inArray(users.email, emails))
            expect(afterUsers).toEqual(beforeUsers)
            expect(afterInvites).toEqual(beforeInvites)
        },
    )
})

describe('account security with PostgreSQL and Redis', () => {
    securityIntegrationTest(
        'enables TOTP, enforces MFA/replay rules, rotates recovery codes, and manages passkeys',
        async () => {
            const originalEncryptionKey = process.env.APP_ENCRYPTION_KEY
            const originalAppUrl = process.env.APP_URL
            const originalRpId = process.env.WEBAUTHN_RP_ID
            process.env.APP_ENCRYPTION_KEY = Buffer.from(
                crypto.getRandomValues(new Uint8Array(32)),
            ).toString('base64')
            process.env.APP_URL = 'http://localhost:3000'
            process.env.WEBAUTHN_RP_ID = 'localhost'

            try {
                const user = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
                const initialSession = await createSessionService(user.id)
                const setup = await beginTotpSetupService(initialSession)
                const setupTotp = new OTPAuth.TOTP({
                    algorithm: TOTP_ALGORITHM,
                    digits: TOTP_DIGITS,
                    issuer: TOTP_ISSUER,
                    label: user.email,
                    period: TOTP_PERIOD_SECONDS,
                    secret: setup.secret,
                })
                const activation = await confirmTotpSetupService({
                    currentSession: initialSession,
                    flowId: setup.flowId,
                    token: setupTotp.generate(),
                })

                expect(setup.otpAuthUri).toStartWith('otpauth://totp/')
                expect(activation.success).toBeTrue()
                if (!activation.success) {
                    throw new Error('TOTP activation unexpectedly failed.')
                }
                expect(activation.recoveryCodes).toHaveLength(10)
                expect(
                    await confirmTotpSetupService({
                        currentSession: initialSession,
                        flowId: setup.flowId,
                        token: setupTotp.generate(),
                    }),
                ).toEqual({ code: 'challenge_expired', success: false })

                const storedFactors = await getAuthDatabase()
                    .select({
                        ciphertext: userTotpFactors.secretCiphertext,
                        iv: userTotpFactors.secretIv,
                        lastUsedCounter: userTotpFactors.lastUsedCounter,
                    })
                    .from(userTotpFactors)
                    .where(eq(userTotpFactors.userId, user.id))
                const storedFactor = requireFirstRow(storedFactors, 'TOTP factor was not stored.')
                const storedRecoveryCodes = await getAuthDatabase()
                    .select({
                        codeHash: userRecoveryCodes.codeHash,
                        usedAt: userRecoveryCodes.usedAt,
                    })
                    .from(userRecoveryCodes)
                    .where(eq(userRecoveryCodes.userId, user.id))

                expect(storedFactor.iv).toHaveLength(12)
                expect(new TextDecoder().decode(storedFactor.ciphertext)).not.toContain(
                    setup.secret,
                )
                expect(
                    await decryptSecret(
                        { ciphertext: storedFactor.ciphertext, iv: storedFactor.iv },
                        `rentnerproxy:totp:${user.id}`,
                    ),
                ).toBe(setup.secret)
                expect(storedRecoveryCodes).toHaveLength(10)
                expect(
                    storedRecoveryCodes.every((code) => /^[a-f\d]{64}$/.test(code.codeHash)),
                ).toBeTrue()
                expect(storedRecoveryCodes.every((code) => code.usedAt === null)).toBeTrue()
                const expectedRecoveryCodeHashes = await Promise.all(
                    activation.recoveryCodes.map(async (plaintext) => {
                        const normalized = normalizeRecoveryCode(plaintext)
                        expect(normalized).not.toBeNull()
                        return hashRecoveryCode(normalized ?? '')
                    }),
                )
                expect(storedRecoveryCodes.map((code) => code.codeHash)).toEqual(
                    expect.arrayContaining(expectedRecoveryCodeHashes),
                )

                const sessionsBeforePasswordLogin = await getAuthDatabase()
                    .select({ id: sessions.id })
                    .from(sessions)
                    .where(eq(sessions.userId, user.id))
                const passwordLogin = await loginService({
                    email: user.email,
                    password: CURRENT_PASSWORD,
                })
                const sessionsAfterPasswordLogin = await getAuthDatabase()
                    .select({ id: sessions.id })
                    .from(sessions)
                    .where(eq(sessions.userId, user.id))

                expect(passwordLogin.success).toBeTrue()
                if (!passwordLogin.success || !passwordLogin.requiresTwoFactor) {
                    throw new Error('Password login did not create an MFA challenge.')
                }
                expect(sessionsAfterPasswordLogin).toHaveLength(sessionsBeforePasswordLogin.length)

                const recoveryLogin = await completeLoginMfaWithRecoveryCodeService({
                    challengeId: passwordLogin.challenge.id,
                    recoveryCode: activation.recoveryCodes[0] ?? '',
                })
                expect(recoveryLogin.success).toBeTrue()
                expect(
                    await completeLoginMfaWithRecoveryCodeService({
                        challengeId: passwordLogin.challenge.id,
                        recoveryCode: activation.recoveryCodes[0] ?? '',
                    }),
                ).toEqual({ code: 'challenge_expired', success: false })
                if (!recoveryLogin.success) {
                    throw new Error('Recovery-code login unexpectedly failed.')
                }
                const currentSession = await getSessionByTokenService(recoveryLogin.session.token)
                if (!currentSession) {
                    throw new Error('MFA session was not persisted.')
                }
                const consumedRecoveryRows = await getAuthDatabase()
                    .select({ usedAt: userRecoveryCodes.usedAt })
                    .from(userRecoveryCodes)
                    .where(
                        eq(
                            userRecoveryCodes.codeHash,
                            await hashRecoveryCode(
                                normalizeRecoveryCode(activation.recoveryCodes[0] ?? '') ?? '',
                            ),
                        ),
                    )
                expect(
                    requireFirstRow(consumedRecoveryRows, 'Recovery code was not found.').usedAt,
                ).toBeInstanceOf(Date)

                const usedCodeChallenge = await createLoginMfaChallengeService(user.id)
                expect(
                    await completeLoginMfaWithRecoveryCodeService({
                        challengeId: usedCodeChallenge.id,
                        recoveryCode: activation.recoveryCodes[0] ?? '',
                    }),
                ).toEqual({ code: 'authentication_failed', success: false })
                await consumeAuthChallenge('login-mfa', usedCodeChallenge.id)

                const regenerated = await regenerateRecoveryCodesService(currentSession)
                expect(regenerated.success).toBeTrue()
                if (!regenerated.success) {
                    throw new Error('Recovery-code regeneration unexpectedly failed.')
                }
                expect(regenerated.recoveryCodes).toHaveLength(10)
                const oldCodeChallenge = await createLoginMfaChallengeService(user.id)
                expect(
                    await completeLoginMfaWithRecoveryCodeService({
                        challengeId: oldCodeChallenge.id,
                        recoveryCode: activation.recoveryCodes[1] ?? '',
                    }),
                ).toEqual({ code: 'authentication_failed', success: false })
                await consumeAuthChallenge('login-mfa', oldCodeChallenge.id)

                const loginTotp = new OTPAuth.TOTP({
                    algorithm: TOTP_ALGORITHM,
                    digits: TOTP_DIGITS,
                    issuer: TOTP_ISSUER,
                    label: 'login',
                    period: TOTP_PERIOD_SECONDS,
                    secret: setup.secret,
                })
                const futureTimestamp = Date.now() + TOTP_PERIOD_SECONDS * 1_000
                const futureToken = loginTotp.generate({ timestamp: futureTimestamp })
                const totpChallenge = await createLoginMfaChallengeService(user.id)
                const totpLogin = await completeLoginMfaWithTotpService({
                    challengeId: totpChallenge.id,
                    token: futureToken,
                })
                expect(totpLogin.success).toBeTrue()
                const replayChallenge = await createLoginMfaChallengeService(user.id)
                expect(
                    await completeLoginMfaWithTotpService({
                        challengeId: replayChallenge.id,
                        token: futureToken,
                    }),
                ).toEqual({ code: 'authentication_failed', success: false })

                const now = Date.now()
                const validTokens = new Set(
                    [-1, 0, 1].map((offset) =>
                        loginTotp.generate({
                            timestamp: now + offset * TOTP_PERIOD_SECONDS * 1_000,
                        }),
                    ),
                )
                let wrongToken = '000000'
                while (validTokens.has(wrongToken)) {
                    wrongToken = String(Number(wrongToken) + 1).padStart(6, '0')
                }
                const wrongChallenge = await createLoginMfaChallengeService(user.id)
                expect(
                    await completeLoginMfaWithTotpService({
                        challengeId: wrongChallenge.id,
                        token: wrongToken,
                    }),
                ).toEqual({ code: 'authentication_failed', success: false })
                await consumeAuthChallenge('login-mfa', wrongChallenge.id)
                const expiredChallenge = await createLoginMfaChallengeService(user.id)
                await consumeAuthChallenge('login-mfa', expiredChallenge.id)
                expect(
                    await completeLoginMfaWithTotpService({
                        challengeId: expiredChallenge.id,
                        token: futureToken,
                    }),
                ).toEqual({ code: 'challenge_expired', success: false })

                const registration = await beginPasskeyRegistrationService(currentSession)
                expect(registration.options.attestation).toBe('none')
                expect(registration.options.authenticatorSelection).toMatchObject({
                    residentKey: 'required',
                    userVerification: 'required',
                })
                expect(
                    await consumeAuthChallenge('webauthn-registration', registration.flowId),
                ).toMatchObject({ userId: user.id, sessionId: currentSession.id })
                expect(
                    await consumeAuthChallenge('webauthn-registration', registration.flowId),
                ).toBeNull()

                const authentication = await beginDiscoverablePasskeyAuthenticationService()
                expect(authentication.options.userVerification).toBe('required')
                expect(authentication.options.allowCredentials).toBeUndefined()
                expect(
                    await consumeAuthChallenge('webauthn-authentication', authentication.flowId),
                ).toMatchObject({ challenge: authentication.options.challenge })

                const credentialId = `integration-${randomUUID()}`
                const insertedPasskeys = await getAuthDatabase()
                    .insert(passkeys)
                    .values({
                        backedUp: true,
                        counter: 0,
                        credentialId,
                        deviceType: 'multiDevice',
                        name: 'Integration passkey',
                        publicKey: new Uint8Array([1, 2, 3, 4]),
                        transports: ['internal'],
                        userId: user.id,
                    })
                    .returning({ id: passkeys.id })
                const passkeyId = requireFirstRow(insertedPasskeys, 'Passkey was not stored.').id
                const duplicateCredentialError = await captureError(
                    Promise.resolve(
                        getAuthDatabase()
                            .insert(passkeys)
                            .values({
                                backedUp: false,
                                counter: 0,
                                credentialId,
                                deviceType: 'singleDevice',
                                name: 'Duplicate passkey',
                                publicKey: new Uint8Array([5, 6, 7, 8]),
                                transports: [],
                                userId: user.id,
                            })
                            .returning({ id: passkeys.id }),
                    ),
                )
                expect(duplicateCredentialError).toBeInstanceOf(Error)
                expect(
                    await renamePasskeyService({
                        currentSession,
                        name: 'Renamed integration passkey',
                        passkeyId,
                    }),
                ).toBeTrue()
                const renamedPasskeys = await getAuthDatabase()
                    .select({ name: passkeys.name })
                    .from(passkeys)
                    .where(eq(passkeys.id, passkeyId))
                expect(renamedPasskeys).toEqual([{ name: 'Renamed integration passkey' }])

                expect(await disableTotpService(currentSession)).toBeTrue()
                expect(
                    await getAuthDatabase()
                        .select({ id: userTotpFactors.id })
                        .from(userTotpFactors)
                        .where(eq(userTotpFactors.userId, user.id)),
                ).toEqual([])
                expect(
                    await getAuthDatabase()
                        .select({ id: userRecoveryCodes.id })
                        .from(userRecoveryCodes)
                        .where(eq(userRecoveryCodes.userId, user.id)),
                ).toEqual([])
                if (totpLogin.success) {
                    expect(await getSessionByTokenService(totpLogin.session.token)).toBeNull()
                }
                expect(await deletePasskeyService({ currentSession, passkeyId })).toBeTrue()
            } finally {
                if (originalEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY
                else process.env.APP_ENCRYPTION_KEY = originalEncryptionKey
                if (originalAppUrl === undefined) delete process.env.APP_URL
                else process.env.APP_URL = originalAppUrl
                if (originalRpId === undefined) delete process.env.WEBAUTHN_RP_ID
                else process.env.WEBAUTHN_RP_ID = originalRpId
            }
        },
    )
})
