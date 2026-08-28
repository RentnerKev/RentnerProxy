import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray, like, notLike } from 'drizzle-orm'

import {
    PERMISSIONS,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
    type PermissionKey,
} from '../config/permissions.config'
import {
    passwordResetTokens,
    permissions,
    rolePermissions,
    roles,
    sessions,
    userInvites,
    userRoles,
    userSettings,
    users,
} from '../db/schema'
import { getDatabaseUrl } from '../server/env.server'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import { acceptInviteService } from '../server/Auth/Setup/invites.service'
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
import {
    createSessionService,
    getSessionByTokenService,
    revokeSessionByTokenService,
} from '../server/Auth/Access/sessions.service'
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

let preparedPasswordHash = ''

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
                mustChangePassword: status === 'pending',
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
})

afterAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) {
        return
    }

    await cleanTestRows()
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

        if (!result.success) {
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
        const roleKey = await createCustomRole([PERMISSIONS.USERS_VIEW])
        const user = await createTestUser({ roleKeys: [roleKey] })
        const session = await createSessionService(user.id)

        expect(session.user.permissions).not.toContain(PERMISSIONS.APP_ACCESS)
        expect(await getSessionByTokenService(session.token)).toBeNull()
    })
})

describe('RBAC with PostgreSQL', () => {
    integrationTest(
        "loads each user's persisted theme without leaking it to another user",
        async () => {
            const darkUser = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
            const lightUser = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })

            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('light')
            expect((await loadActiveAccess(lightUser.id)).themeMode).toBe('light')

            await getAuthDatabase().insert(userSettings).values({
                themeMode: 'dark',
                userId: darkUser.id,
            })

            expect((await loadActiveAccess(darkUser.id)).themeMode).toBe('dark')
            expect((await loadActiveAccess(lightUser.id)).themeMode).toBe('light')
        },
    )

    integrationTest('resolves owner, admin, viewer, and additive multi-role access', async () => {
        const customRoleKey = await createCustomRole([PERMISSIONS.USERS_VIEW])
        const owner = await createTestUser({ roleKeys: [SYSTEM_ROLES.OWNER] })
        const admin = await createTestUser({ roleKeys: [SYSTEM_ROLES.ADMIN] })
        const viewer = await createTestUser({ roleKeys: [SYSTEM_ROLES.VIEWER] })
        const multiRole = await createTestUser({
            roleKeys: [SYSTEM_ROLES.VIEWER, customRoleKey],
        })
        const [ownerAccess, adminAccess, viewerAccess, multiRoleAccess] = await Promise.all([
            loadActiveAccess(owner.id),
            loadActiveAccess(admin.id),
            loadActiveAccess(viewer.id),
            loadActiveAccess(multiRole.id),
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
    })

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
