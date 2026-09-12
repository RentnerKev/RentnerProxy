import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { inArray, like, eq, and } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../config/permissions.config'
import {
    accessPolicies,
    auditEvents,
    permissions,
    proxyHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import type { CreateProxyHostInput } from '../features/Admin/ProxyHostManagement/validation'
import type { AccessPolicyIpRules } from '../shared/Helpers/ipAccessRules'
import {
    createAccessPolicyService,
    deleteAccessPolicyService,
    getAccessPoliciesService,
    updateAccessPolicyService,
} from '../server/Admin/AccessPolicyManagement/access-policies.service'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import {
    createProxyHostService,
    disableProxyHostService,
    updateProxyHostService,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import {
    applyProxyConfigurationService,
    getProxyRuntimeSnapshotService,
    getProxyRuntimeStatusService,
} from '../server/ProxyRuntime/proxy-runtime.service'
import { AccessPolicyDomainError } from '../server/Admin/AccessPolicyManagement/access-policies.errors'
import { getDatabaseUrl } from '../server/env.server'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const TEST_EMAIL_SUFFIX = '@access-policy-test.invalid'
const TEST_POLICY_PREFIX = 'access-policy-test-'
const TEST_DOMAIN_SUFFIX = '.access-policy-test.invalid'
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

function testEmail(): string {
    return `user-${randomUUID()}${TEST_EMAIL_SUFFIX}`
}

function testDomain(): string {
    return `host-${randomUUID().replaceAll('-', '').slice(0, 20)}${TEST_DOMAIN_SUFFIX}`
}

function proxyHostInput(): CreateProxyHostInput {
    return {
        domains: [testDomain()],
        enabled: true,
        forwardHost: `backend-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}`,
        forwardPort: 8_080,
        forwardScheme: 'http',
    }
}

async function createTestUser(roleKeys: ReadonlyArray<string>) {
    const email = testEmail()
    return getAuthDatabase().transaction(async (transaction) => {
        const user = requireFirstRow(
            await transaction
                .insert(users)
                .values({
                    displayName: `Access policy test ${email.slice(0, 12)}`,
                    email,
                    emailVerifiedAt: new Date(),
                    status: 'active',
                })
                .returning({ id: users.id }),
            'Test user was not inserted.',
        )
        const selectedRoles = await transaction
            .select({ id: roles.id, key: roles.key })
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
                    description: 'Access policy integration test role',
                    key,
                    name: 'Access policy integration test role',
                })
                .returning({ id: roles.id, key: roles.key }),
            'Test role was not inserted.',
        )
        const selectedPermissions = await transaction
            .select({ id: permissions.id })
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
        return role
    })
}

async function runWithSessionToken<T>(token: string, operation: () => Promise<T>): Promise<T> {
    let failure: unknown
    let result: T | undefined
    const handler = requestHandler(async () => {
        try {
            result = await operation()
        } catch (error) {
            failure = error
        }
        return new Response(null, { status: failure ? 500 : 204 })
    })
    const request = new Request('http://localhost/')
    request.headers.set('cookie', `${SESSION_COOKIE_NAME}=${token}`)
    await handler(request, {})
    if (failure) throw failure
    return result as T
}

async function runAsUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    return runWithSessionToken(session.token, operation)
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
        if (hosts.length > 0) {
            await transaction.delete(proxyHosts).where(
                inArray(
                    proxyHosts.id,
                    hosts.map((row) => row.id),
                ),
            )
        }
        if (policies.length > 0) {
            await transaction.delete(accessPolicies).where(
                inArray(
                    accessPolicies.id,
                    policies.map((row) => row.id),
                ),
            )
        }
        await transaction.delete(users).where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
        await transaction.delete(roles).where(like(roles.key, `${TEST_POLICY_PREFIX}%`))
    })
}

function expectPolicyError(error: unknown, code: AccessPolicyDomainError['code']): void {
    expect(error).toBeInstanceOf(AccessPolicyDomainError)
    if (error instanceof AccessPolicyDomainError) expect(error.code).toBe(code)
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

describe('Access policy management with PostgreSQL', () => {
    integrationTest(
        'creates policies and preserves an omitted host assignment on update',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const policyA = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}a-${randomUUID()}`,
                    mode: 'authenticated',
                    combination: null,
                }),
            )
            const policyB = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}b-${randomUUID()}`,
                    mode: 'public',
                    combination: null,
                }),
            )
            expect(policyA.accessPolicyId).toBe(policyA.id)
            expect(policyA.runtimeStatus).toBe('pending')

            const host = await runAsUser(owner.id, () =>
                createProxyHostService({
                    ...proxyHostInput(),
                    accessPolicyId: policyA.accessPolicyId,
                }),
            )
            await runAsUser(owner.id, () =>
                updateProxyHostService({
                    ...proxyHostInput(),
                    proxyHostId: host.id,
                }),
            )
            const persisted = requireFirstRow(
                await getAuthDatabase()
                    .select({ accessPolicyId: proxyHosts.accessPolicyId })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, host.id)),
                'Updated host was not found.',
            )
            expect(persisted.accessPolicyId).toBe(policyA.accessPolicyId)
            const snapshot = await getProxyRuntimeSnapshotService()
            expect(snapshot.proxyHosts.find((entry) => entry.id === host.id)?.accessPolicy).toEqual(
                {
                    id: policyA.id,
                    mode: 'authenticated',
                    combination: null,
                },
            )
            expect(
                (await runAsUser(owner.id, getAccessPoliciesService)).map((row) => row.id),
            ).toEqual(expect.arrayContaining([policyA.id, policyB.id]))
            await runAsUser(owner.id, () =>
                updateProxyHostService({
                    ...proxyHostInput(),
                    proxyHostId: host.id,
                    accessPolicyId: policyB.id,
                }),
            )
            const assignmentEvents = await getAuthDatabase()
                .select({ metadata: auditEvents.metadata })
                .from(auditEvents)
                .where(and(eq(auditEvents.targetId, host.id), eq(auditEvents.action, 'update')))
            expect(assignmentEvents.map((event) => event.metadata)).toContainEqual({
                changedFields: ['domains', 'upstream', 'tls', 'accessPolicy'],
                assigned: true,
                previousId: policyA.id,
                nextId: policyB.id,
            })
        },
    )

    integrationTest(
        'rejects an explicit null combination update for a combined policy',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const policy = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}combined-${randomUUID()}`,
                    mode: 'combined',
                    combination: 'all',
                }),
            )
            const error = await runAsUser(owner.id, () =>
                updateAccessPolicyService({
                    accessPolicyId: policy.accessPolicyId,
                    combination: null,
                }).catch((caught) => caught),
            )
            expectPolicyError(error, 'invalid_input')
            const unchanged = requireFirstRow(
                await getAuthDatabase()
                    .select({ mode: accessPolicies.mode, combination: accessPolicies.combination })
                    .from(accessPolicies)
                    .where(eq(accessPolicies.id, policy.id)),
                'Policy was not found after rejected update.',
            )
            expect(unchanged).toEqual({ mode: 'combined', combination: 'all' })

            const switched = await runAsUser(owner.id, () =>
                updateAccessPolicyService({ accessPolicyId: policy.id, mode: 'public' }),
            )
            expect(switched).toMatchObject({ mode: 'public', combination: null })
        },
    )

    integrationTest(
        'normalizes IP rules, preserves omitted updates, and removes them with explicit null',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const policy = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}ip-rules-${randomUUID()}`,
                    mode: 'ip-restricted',
                    combination: null,
                    ipRules: {
                        defaultAction: 'deny',
                        allow: ['2001:0DB8::1/64', '192.0.2.17/24', '192.0.2.0/24'],
                        deny: ['10.0.0.1'],
                    },
                }),
            )
            const expectedIpRules: AccessPolicyIpRules = {
                defaultAction: 'deny',
                allow: ['192.0.2.0/24', '2001:db8::/64'],
                deny: ['10.0.0.1/32'],
            }
            expect(policy.ipRules).toEqual(expectedIpRules)
            const host = await runAsUser(owner.id, () =>
                createProxyHostService({
                    ...proxyHostInput(),
                    accessPolicyId: policy.id,
                }),
            )
            const persisted = requireFirstRow(
                await getAuthDatabase()
                    .select({ ipRules: accessPolicies.ipRules })
                    .from(accessPolicies)
                    .where(eq(accessPolicies.id, policy.id)),
                'IP policy was not persisted.',
            )
            expect(persisted.ipRules).toEqual(expectedIpRules)
            expect(
                (await getProxyRuntimeSnapshotService()).proxyHosts.find(
                    (entry) => entry.id === host.id,
                )?.accessPolicy?.ipRules,
            ).toEqual(expectedIpRules)

            const preserved = await runAsUser(owner.id, () =>
                updateAccessPolicyService({ accessPolicyId: policy.id, name: 'renamed IP policy' }),
            )
            expect(preserved.ipRules).toEqual(expectedIpRules)
            const publicPolicy = await runAsUser(owner.id, () =>
                updateAccessPolicyService({ accessPolicyId: policy.id, mode: 'public' }),
            )
            expect(publicPolicy.ipRules).toEqual(expectedIpRules)
            expect(
                (await getProxyRuntimeSnapshotService()).proxyHosts.find(
                    (entry) => entry.id === host.id,
                )?.accessPolicy,
            ).toEqual({ id: policy.id, mode: 'public', combination: null })
            await runAsUser(owner.id, () =>
                updateAccessPolicyService({ accessPolicyId: policy.id, mode: 'ip-restricted' }),
            )
            expect(
                (await getProxyRuntimeSnapshotService()).proxyHosts.find(
                    (entry) => entry.id === host.id,
                )?.accessPolicy?.ipRules,
            ).toEqual(expectedIpRules)
            const removed = await runAsUser(owner.id, () =>
                updateAccessPolicyService({ accessPolicyId: policy.id, ipRules: null }),
            )
            expect(removed.ipRules).toBeNull()
            expect(
                (await getProxyRuntimeSnapshotService()).proxyHosts.find(
                    (entry) => entry.id === host.id,
                )?.accessPolicy,
            ).toEqual({ id: policy.id, mode: 'ip-restricted', combination: null })
        },
    )

    integrationTest(
        'rejects deletion while a disabled host still references the policy',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const unused = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}unused-${randomUUID()}`,
                    mode: 'public',
                    combination: null,
                }),
            )
            const deleted = await runAsUser(owner.id, () =>
                deleteAccessPolicyService(unused.accessPolicyId),
            )
            expect(deleted).toMatchObject({ accessPolicyId: unused.id, runtimeStatus: 'pending' })
            const policy = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}in-use-${randomUUID()}`,
                    mode: 'public',
                    combination: null,
                }),
            )
            const host = await runAsUser(owner.id, () =>
                createProxyHostService({
                    ...proxyHostInput(),
                    accessPolicyId: policy.id,
                }),
            )
            await runAsUser(owner.id, () => disableProxyHostService(host.id))
            const summary = (await runAsUser(owner.id, getAccessPoliciesService)).find(
                (entry) => entry.id === policy.id,
            )
            expect(summary?.assignedHostCount).toBe(1)
            const error = await runAsUser(owner.id, () =>
                deleteAccessPolicyService(policy.id).catch((caught) => caught),
            )
            expectPolicyError(error, 'access_policy_in_use')
            expect(
                await getAuthDatabase()
                    .select({ id: accessPolicies.id })
                    .from(accessPolicies)
                    .where(eq(accessPolicies.id, policy.id)),
            ).toHaveLength(1)
        },
    )

    integrationTest(
        'enforces policy RBAC while allowing ordinary host edits to preserve assignment',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const role = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_CREATE,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            ])
            const actor = await createTestUser([role.key])
            const policy = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}rbac-${randomUUID()}`,
                    mode: 'public',
                    combination: null,
                }),
            )

            await expect(runAsUser(actor.id, getAccessPoliciesService)).rejects.toBeInstanceOf(
                AuthDomainError,
            )
            await expect(
                runAsUser(actor.id, () =>
                    createAccessPolicyService({
                        name: `${TEST_POLICY_PREFIX}denied-create-${randomUUID()}`,
                        mode: 'public',
                        combination: null,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            await expect(
                runAsUser(actor.id, () =>
                    updateAccessPolicyService({ accessPolicyId: policy.id, name: 'denied update' }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            await expect(
                runAsUser(actor.id, () => deleteAccessPolicyService(policy.id)),
            ).rejects.toBeInstanceOf(AuthDomainError)
            await expect(
                runAsUser(actor.id, () =>
                    getProxyRuntimeStatusService(PERMISSIONS.ACCESS_POLICIES_VIEW),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
            await expect(
                runAsUser(actor.id, () =>
                    applyProxyConfigurationService(PERMISSIONS.ACCESS_POLICIES_APPLY),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)

            const assignedHost = await runAsUser(owner.id, () =>
                createProxyHostService({
                    ...proxyHostInput(),
                    accessPolicyId: policy.id,
                }),
            )
            await runAsUser(actor.id, () =>
                updateProxyHostService({ ...proxyHostInput(), proxyHostId: assignedHost.id }),
            )
            const preserved = requireFirstRow(
                await getAuthDatabase()
                    .select({ accessPolicyId: proxyHosts.accessPolicyId })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, assignedHost.id)),
                'Assigned host was not found after ordinary update.',
            )
            expect(preserved.accessPolicyId).toBe(policy.id)

            await expect(
                runAsUser(actor.id, () =>
                    createProxyHostService({
                        ...proxyHostInput(),
                        accessPolicyId: policy.id,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)

            const unassignedHost = await runAsUser(actor.id, () =>
                createProxyHostService(proxyHostInput()),
            )
            await expect(
                runAsUser(actor.id, () =>
                    updateProxyHostService({
                        ...proxyHostInput(),
                        proxyHostId: unassignedHost.id,
                        accessPolicyId: policy.id,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)

            await expect(
                runAsUser(actor.id, () =>
                    updateProxyHostService({
                        ...proxyHostInput(),
                        proxyHostId: assignedHost.id,
                        accessPolicyId: null,
                    }),
                ),
            ).rejects.toBeInstanceOf(AuthDomainError)
        },
    )

    integrationTest(
        'allows an actor with assignment permission to assign and remove policies',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const role = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
                PERMISSIONS.ACCESS_POLICIES_ASSIGN,
            ])
            const actor = await createTestUser([role.key])
            const policy = await runAsUser(owner.id, () =>
                createAccessPolicyService({
                    name: `${TEST_POLICY_PREFIX}assignable-${randomUUID()}`,
                    mode: 'public',
                    combination: null,
                }),
            )
            const host = await runAsUser(owner.id, () => createProxyHostService(proxyHostInput()))

            await runAsUser(actor.id, () =>
                updateProxyHostService({
                    ...proxyHostInput(),
                    proxyHostId: host.id,
                    accessPolicyId: policy.id,
                }),
            )
            expect(
                requireFirstRow(
                    await getAuthDatabase()
                        .select({ accessPolicyId: proxyHosts.accessPolicyId })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, host.id)),
                    'Assigned host was not found.',
                ).accessPolicyId,
            ).toBe(policy.id)

            await runAsUser(actor.id, () =>
                updateProxyHostService({
                    ...proxyHostInput(),
                    proxyHostId: host.id,
                    accessPolicyId: null,
                }),
            )
            expect(
                requireFirstRow(
                    await getAuthDatabase()
                        .select({ accessPolicyId: proxyHosts.accessPolicyId })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, host.id)),
                    'Host was not found after policy removal.',
                ).accessPolicyId,
            ).toBeNull()
        },
    )
})
