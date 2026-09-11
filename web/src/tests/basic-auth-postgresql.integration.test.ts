import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from '../config/access-policies.config'
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../config/permissions.config'
import {
    accessPolicyBasicAuthAccounts,
    accessPolicies,
    permissions,
    rolePermissions,
    roles,
    userRoles,
    users,
    proxyHosts,
} from '../db/schema'
import { createAccessPolicyService } from '../server/Admin/AccessPolicyManagement/access-policies.service'
import {
    createBasicAuthAccountService,
    deleteBasicAuthAccountService,
    getBasicAuthAccountsService,
    updateBasicAuthAccountService,
} from '../server/Admin/AccessPolicyManagement/basic-auth.service'
import { BasicAuthDomainError } from '../server/Admin/AccessPolicyManagement/basic-auth.errors'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { createProxyHostService } from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import { getProxyRuntimeSnapshotService } from '../server/ProxyRuntime/proxy-runtime.service'
import { getDatabaseUrl } from '../server/env.server'
import type { CreateProxyHostInput } from '../features/Admin/ProxyHostManagement/validation'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const TEST_EMAIL_SUFFIX = '@basic-auth-test.invalid'
const TEST_POLICY_PREFIX = 'basic-auth-test-'
const TEST_DOMAIN_SUFFIX = '.basic-auth-test.invalid'
const SEEDED_PASSWORD_HASH =
    '$argon2id$v=19$m=47104,t=1,p=1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const originalControllerEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (variable) => [variable, process.env[variable]] as const,
    ),
)

function requireFirstRow<T>(rows: ReadonlyArray<T>, message: string): T {
    const row = rows.at(0)
    if (!row) throw new Error(message)
    return row
}

function hostInput(): CreateProxyHostInput {
    return {
        domains: [`host-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}`],
        enabled: true,
        forwardHost: `backend-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}`,
        forwardPort: 8_080,
        forwardScheme: 'http',
    }
}

async function createTestUser(roleKeys: ReadonlyArray<string>) {
    const email = `user-${randomUUID()}${TEST_EMAIL_SUFFIX}`
    return getAuthDatabase().transaction(async (transaction) => {
        const user = requireFirstRow(
            await transaction
                .insert(users)
                .values({
                    displayName: 'Basic Auth test user',
                    email,
                    emailVerifiedAt: new Date(),
                    status: 'active',
                })
                .returning({ id: users.id }),
            'Test user was not inserted.',
        )
        const selectedRoles = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.key, roleKeys))
        if (selectedRoles.length !== new Set(roleKeys).size) {
            throw new Error('A requested test role is unavailable.')
        }
        await transaction
            .insert(userRoles)
            .values(selectedRoles.map((role) => ({ roleId: role.id, userId: user.id })))
        return user
    })
}

async function createCustomRole(permissionKeys: ReadonlyArray<PermissionKey>) {
    const key = `${TEST_POLICY_PREFIX}${randomUUID()}`
    return getAuthDatabase().transaction(async (transaction) => {
        const role = requireFirstRow(
            await transaction
                .insert(roles)
                .values({
                    description: 'Basic Auth integration test role',
                    key,
                    name: 'Basic Auth integration test role',
                })
                .returning({ id: roles.id, key: roles.key }),
            'Test role was not inserted.',
        )
        const selectedPermissions = await transaction
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, permissionKeys))
        await transaction.insert(rolePermissions).values(
            selectedPermissions.map((permission) => ({
                permissionId: permission.id,
                roleId: role.id,
            })),
        )
        return role
    })
}

async function runWithSession<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    let result: T | undefined
    let failure: unknown
    const handler = requestHandler(async () => {
        try {
            result = await operation()
        } catch (error) {
            failure = error
        }
        return new Response(null, { status: failure ? 500 : 204 })
    })
    const request = new Request('http://localhost/', {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
    })
    await handler(request, {})
    if (failure) throw failure
    return result as T
}

async function cleanTestRows(): Promise<void> {
    const database = getAuthDatabase()
    const hosts = await database
        .select({ id: proxyHosts.id })
        .from(proxyHosts)
        .where(like(proxyHosts.forwardHost, `%${TEST_DOMAIN_SUFFIX}`))
    const policies = await database
        .select({ id: accessPolicies.id })
        .from(accessPolicies)
        .where(like(accessPolicies.name, `${TEST_POLICY_PREFIX}%`))
    await database.transaction(async (transaction) => {
        if (hosts.length > 0)
            await transaction.delete(proxyHosts).where(
                inArray(
                    proxyHosts.id,
                    hosts.map((row) => row.id),
                ),
            )
        if (policies.length > 0)
            await transaction.delete(accessPolicies).where(
                inArray(
                    accessPolicies.id,
                    policies.map((row) => row.id),
                ),
            )
        await transaction.delete(users).where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
        await transaction.delete(roles).where(like(roles.key, `${TEST_POLICY_PREFIX}%`))
    })
}

function expectBasicAuthError(error: unknown, code: BasicAuthDomainError['code']): void {
    expect(error).toBeInstanceOf(BasicAuthDomainError)
    if (error instanceof BasicAuthDomainError) expect(error.code).toBe(code)
}

beforeAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) return
    await getAuthDatabase().transaction((transaction) =>
        ensureAuthorizationRegistryInTransaction(transaction),
    )
})

beforeEach(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) return
    process.env.RENTNERPROXY_CONTROLLER_URL = ''
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
    await cleanTestRows()
})

afterEach(async () => {
    if (DATABASE_INTEGRATION_ENABLED) await cleanTestRows()
    for (const [variable, originalValue] of originalControllerEnvironment) {
        if (originalValue === undefined) delete process.env[variable]
        else process.env[variable] = originalValue
    }
})

describe('Basic Auth accounts with PostgreSQL', () => {
    integrationTest(
        'returns credential metadata without returning plaintext or password hashes',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const policy = await runWithSession(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}accounts-${randomUUID()}`,
                    mode: 'authenticated',
                    combination: null,
                }),
            )
            const host = await runWithSession(owner.id, () =>
                createProxyHostService({ ...hostInput(), accessPolicyId: policy.id }),
            )
            const created = await runWithSession(owner.id, () =>
                createBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    username: 'Alice.Admin@example',
                    password: 'secret phrase',
                }),
            )
            const accounts = await runWithSession(owner.id, () =>
                getBasicAuthAccountsService({ accessPolicyId: policy.id }),
            )
            expect(accounts).toHaveLength(1)
            expect(accounts[0]).toMatchObject({
                id: created.accountId,
                accessPolicyId: policy.id,
                username: 'Alice.Admin@example',
            })
            expect(JSON.stringify(accounts)).not.toContain('secret phrase')
            expect(JSON.stringify(accounts)).not.toContain('passwordHash')
            const stored = requireFirstRow(
                await getAuthDatabase()
                    .select({ passwordHash: accessPolicyBasicAuthAccounts.passwordHash })
                    .from(accessPolicyBasicAuthAccounts)
                    .where(eq(accessPolicyBasicAuthAccounts.id, created.accountId)),
                'Basic Auth account was not stored.',
            )
            expect(stored.passwordHash).toMatch(
                /^\$argon2id\$v=19\$m=47104,t=1,p=1\$[A-Za-z0-9+/]{43}\$[A-Za-z0-9+/]{43}$/u,
            )
            expect(await Bun.password.verify('secret phrase', stored.passwordHash)).toBe(true)
            const snapshot = await getProxyRuntimeSnapshotService()
            expect(
                snapshot.proxyHosts.find((entry) => entry.id === host.id)?.accessPolicy,
            ).toMatchObject({
                id: policy.id,
                mode: 'authenticated',
                basicAuth: {
                    accounts: [
                        { username: 'Alice.Admin@example', passwordHash: stored.passwordHash },
                    ],
                },
            })
        },
    )

    integrationTest(
        'rotates passwords, preserves omitted credentials, and deletes the last account',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const policy = await runWithSession(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}rotation-${randomUUID()}`,
                    mode: 'combined',
                    combination: 'all',
                }),
            )
            const host = await runWithSession(owner.id, () =>
                createProxyHostService({ ...hostInput(), accessPolicyId: policy.id }),
            )
            const created = await runWithSession(owner.id, () =>
                createBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    username: 'rotate-me',
                    password: 'before',
                }),
            )
            const before = requireFirstRow(
                await getAuthDatabase()
                    .select({ passwordHash: accessPolicyBasicAuthAccounts.passwordHash })
                    .from(accessPolicyBasicAuthAccounts)
                    .where(eq(accessPolicyBasicAuthAccounts.id, created.accountId)),
                'Initial hash was not stored.',
            ).passwordHash
            await runWithSession(owner.id, () =>
                updateBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    accountId: created.accountId,
                    username: 'rotated-name',
                }),
            )
            const renamed = requireFirstRow(
                await getAuthDatabase()
                    .select()
                    .from(accessPolicyBasicAuthAccounts)
                    .where(eq(accessPolicyBasicAuthAccounts.id, created.accountId)),
                'Renamed account was not stored.',
            )
            expect(renamed.passwordHash).toBe(before)
            await runWithSession(owner.id, () =>
                updateBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    accountId: created.accountId,
                    password: 'after',
                }),
            )
            const rotated = requireFirstRow(
                await getAuthDatabase()
                    .select({ passwordHash: accessPolicyBasicAuthAccounts.passwordHash })
                    .from(accessPolicyBasicAuthAccounts)
                    .where(eq(accessPolicyBasicAuthAccounts.id, created.accountId)),
                'Rotated account was not stored.',
            ).passwordHash
            expect(rotated).not.toBe(before)
            expect(await Bun.password.verify('before', rotated)).toBe(false)
            expect(await Bun.password.verify('after', rotated)).toBe(true)
            await runWithSession(owner.id, () =>
                deleteBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    accountId: created.accountId,
                }),
            )
            expect(
                await runWithSession(owner.id, () =>
                    getBasicAuthAccountsService({ accessPolicyId: policy.id }),
                ),
            ).toEqual([])
            expect(
                (await getProxyRuntimeSnapshotService()).proxyHosts.find(
                    (entry) => entry.id === host.id,
                )?.accessPolicy?.basicAuth,
            ).toBeUndefined()
        },
    )

    integrationTest(
        'maps duplicate usernames and enforces VIEW versus credential UPDATE',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const viewerRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.ACCESS_POLICIES_VIEW,
            ])
            const viewer = await createTestUser([viewerRole.key])
            const policy = await runWithSession(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}rbac-${randomUUID()}`,
                    mode: 'authenticated',
                    combination: null,
                }),
            )
            await runWithSession(owner.id, () =>
                createBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    username: 'duplicate',
                    password: 'one',
                }),
            )
            const duplicate = await runWithSession(owner.id, () =>
                createBasicAuthAccountService({
                    accessPolicyId: policy.id,
                    username: 'duplicate',
                    password: 'two',
                }).catch((error) => error),
            )
            expectBasicAuthError(duplicate, 'basic_auth_username_conflict')
            expect(
                await runWithSession(viewer.id, () =>
                    getBasicAuthAccountsService({ accessPolicyId: policy.id }),
                ),
            ).toHaveLength(1)
            await expect(
                runWithSession(viewer.id, () =>
                    createBasicAuthAccountService({
                        accessPolicyId: policy.id,
                        username: 'denied',
                        password: 'secret',
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            const account = requireFirstRow(
                await getAuthDatabase()
                    .select({ id: accessPolicyBasicAuthAccounts.id })
                    .from(accessPolicyBasicAuthAccounts)
                    .where(eq(accessPolicyBasicAuthAccounts.policyId, policy.id)),
                'Basic Auth account was not available for RBAC checks.',
            )
            await expect(
                runWithSession(viewer.id, () =>
                    updateBasicAuthAccountService({
                        accessPolicyId: policy.id,
                        accountId: account.id,
                        password: 'denied',
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            await expect(
                runWithSession(viewer.id, () =>
                    deleteBasicAuthAccountService({
                        accessPolicyId: policy.id,
                        accountId: account.id,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
        },
    )

    integrationTest('rejects policy/account mismatches before hashing', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const firstPolicy = await runWithSession(owner.id, () =>
            createAccessPolicyService({
                name: `${TEST_POLICY_PREFIX}mismatch-first-${randomUUID()}`,
                mode: 'authenticated',
                combination: null,
            }),
        )
        const secondPolicy = await runWithSession(owner.id, () =>
            createAccessPolicyService({
                name: `${TEST_POLICY_PREFIX}mismatch-second-${randomUUID()}`,
                mode: 'authenticated',
                combination: null,
            }),
        )
        const created = await runWithSession(owner.id, () =>
            createBasicAuthAccountService({
                accessPolicyId: firstPolicy.id,
                username: 'owned-by-first-policy',
                password: 'secret',
            }),
        )

        const mismatch = await runWithSession(owner.id, () =>
            updateBasicAuthAccountService({
                accessPolicyId: secondPolicy.id,
                accountId: created.accountId,
                password: 'must-not-be-hashed',
            }).catch((error) => error),
        )
        expectBasicAuthError(mismatch, 'basic_auth_account_not_found')

        const missingPolicy = await runWithSession(owner.id, () =>
            createBasicAuthAccountService({
                accessPolicyId: '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6071',
                username: 'missing-policy',
                password: 'must-not-be-hashed',
            }).catch((error) => error),
        )
        expect(missingPolicy).toBeInstanceOf(Error)
        expect((missingPolicy as { code?: string }).code).toBe('access_policy_not_found')
    })

    integrationTest('enforces the per-policy account limit and VIEW denial', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const noViewRole = await createCustomRole([PERMISSIONS.APP_ACCESS])
        const noViewUser = await createTestUser([noViewRole.key])
        const policy = await runWithSession(owner.id, () =>
            createAccessPolicyService({
                name: `${TEST_POLICY_PREFIX}limit-${randomUUID()}`,
                mode: 'authenticated',
                combination: null,
            }),
        )
        await getAuthDatabase()
            .insert(accessPolicyBasicAuthAccounts)
            .values(
                Array.from({ length: MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY }, (_, index) => ({
                    policyId: policy.id,
                    username: `seed-${index}`,
                    passwordHash: SEEDED_PASSWORD_HASH,
                })),
            )

        const limitError = await runWithSession(owner.id, () =>
            createBasicAuthAccountService({
                accessPolicyId: policy.id,
                username: 'over-limit',
                password: 'must-not-be-stored',
            }).catch((error) => error),
        )
        expectBasicAuthError(limitError, 'basic_auth_account_limit')
        expect(
            await getAuthDatabase()
                .select({ id: accessPolicyBasicAuthAccounts.id })
                .from(accessPolicyBasicAuthAccounts)
                .where(eq(accessPolicyBasicAuthAccounts.policyId, policy.id)),
        ).toHaveLength(MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY)
        await expect(
            runWithSession(noViewUser.id, () =>
                getBasicAuthAccountsService({ accessPolicyId: policy.id }),
            ),
        ).rejects.toBeInstanceOf(AuthDomainError)
    })
})
