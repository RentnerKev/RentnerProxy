import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like, notLike } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import {
    PERMISSION_REGISTRY,
    PERMISSIONS,
    SYSTEM_ROLE_REGISTRY,
    SYSTEM_ROLES,
    type PermissionKey,
} from '../config/permissions.config'
import {
    permissions,
    proxyHostDomains,
    proxyHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { AuthDomainError } from '../server/Auth/Core/errors.server'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import {
    createProxyHostService,
    deleteProxyHostService,
    disableProxyHostService,
    enableProxyHostService,
    getProxyHostsService,
    updateProxyHostService,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import {
    mapProxyHostDomainUniqueViolation,
    ProxyHostDomainError,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.errors'
import { getDatabaseUrl } from '../server/env.server'
import type { CreateProxyHostInput } from '../features/Admin/ProxyHostManagement/validation'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const TEST_DOMAIN_SUFFIX = '.proxy-host-test.invalid'
const TEST_EMAIL_SUFFIX = '@proxy-host-test.invalid'
const TEST_ROLE_PREFIX = 'proxy-host-test-'

let dedicatedDatabaseVerified = false

function requireFirstRow<T>(rows: ReadonlyArray<T>, message: string): T {
    const row = rows.at(0)

    if (!row) {
        throw new Error(message)
    }

    return row
}

function testDomain(label: string): string {
    return `${label}-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}`
}

function testEmail(label: string): string {
    return `${label}-${randomUUID()}${TEST_EMAIL_SUFFIX}`
}

function proxyHostInput(label: string): CreateProxyHostInput {
    return {
        domains: [testDomain(label)],
        enabled: true,
        forwardHost: `backend-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}`,
        forwardPort: 8_080,
        forwardScheme: 'http',
    }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise
        return null
    } catch (error) {
        return error
    }
}

async function createTestUser(roleKeys: ReadonlyArray<string>) {
    const email = testEmail('user')

    return getAuthDatabase().transaction(async (transaction) => {
        const user = requireFirstRow(
            await transaction
                .insert(users)
                .values({
                    displayName: `Test ${email.slice(0, 20)}`,
                    email,
                    emailVerifiedAt: new Date(),
                    mustChangePassword: false,
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
    const key = `${TEST_ROLE_PREFIX}${randomUUID()}`

    return getAuthDatabase().transaction(async (transaction) => {
        const role = requireFirstRow(
            await transaction
                .insert(roles)
                .values({
                    description: 'Proxy host integration test role',
                    key,
                    name: 'Proxy host integration test role',
                })
                .returning({ id: roles.id, key: roles.key }),
            'Custom role was not inserted.',
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

async function loadRolePermissionKeys(roleKey: string): Promise<Array<string>> {
    const rows = await getAuthDatabase()
        .select({ key: permissions.key })
        .from(roles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(roles.key, roleKey))

    return rows.map((row) => row.key).toSorted()
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

async function cleanTestRows(): Promise<void> {
    const database = getAuthDatabase()
    const hostRows = await database
        .select({ id: proxyHosts.id })
        .from(proxyHosts)
        .where(like(proxyHosts.forwardHost, `%${TEST_DOMAIN_SUFFIX}`))

    await database.transaction(async (transaction) => {
        if (hostRows.length > 0) {
            await transaction.delete(proxyHosts).where(
                inArray(
                    proxyHosts.id,
                    hostRows.map((host) => host.id),
                ),
            )
        }

        await transaction.delete(users).where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
        await transaction.delete(roles).where(like(roles.key, `${TEST_ROLE_PREFIX}%`))
    })
}

async function assertDedicatedProxyHostDatabase(): Promise<void> {
    const [otherUsers, otherProxyHosts] = await Promise.all([
        getAuthDatabase()
            .select({ id: users.id })
            .from(users)
            .where(notLike(users.email, `%${TEST_EMAIL_SUFFIX}`))
            .limit(1),
        getAuthDatabase()
            .select({ id: proxyHosts.id })
            .from(proxyHosts)
            .where(notLike(proxyHosts.forwardHost, `%${TEST_DOMAIN_SUFFIX}`))
            .limit(1),
    ])

    if (otherUsers.length > 0 || otherProxyHosts.length > 0) {
        throw new Error(
            'ProxyHost integration tests require a dedicated database without non-test users or proxy hosts.',
        )
    }
}

function expectProxyHostDomainError(error: unknown, code: ProxyHostDomainError['code']): void {
    expect(error).toBeInstanceOf(ProxyHostDomainError)

    if (error instanceof ProxyHostDomainError) {
        expect(error.code).toBe(code)
    }
}

beforeAll(async () => {
    if (!DATABASE_INTEGRATION_ENABLED) {
        return
    }

    await assertDedicatedProxyHostDatabase()
    dedicatedDatabaseVerified = true
    await cleanTestRows()
    await getAuthDatabase().transaction((transaction) =>
        ensureAuthorizationRegistryInTransaction(transaction),
    )
})

beforeEach(async () => {
    if (dedicatedDatabaseVerified) {
        await cleanTestRows()
    }
})

afterEach(async () => {
    if (dedicatedDatabaseVerified) {
        await cleanTestRows()
    }
})

describe('ProxyHost management with PostgreSQL', () => {
    integrationTest(
        'creates, updates, lists, and cascades multiple canonical domains',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const primaryDomain = testDomain('primary')
            const secondaryDomain = testDomain('secondary')
            const created = await runAsUser(owner.id, () =>
                createProxyHostService({
                    domains: [`  ${secondaryDomain.toUpperCase()}. `, primaryDomain.toUpperCase()],
                    enabled: true,
                    forwardHost: ` BACKEND${TEST_DOMAIN_SUFFIX.toUpperCase()} `,
                    forwardPort: 8_080,
                    forwardScheme: 'http',
                }),
            )

            expect(created).toMatchObject({
                domains: [primaryDomain, secondaryDomain].toSorted(),
                enabled: true,
                forwardHost: `backend${TEST_DOMAIN_SUFFIX}`,
                forwardPort: 8_080,
                forwardScheme: 'http',
            })
            expect(created.id[14]).toBe('7')
            expect(created.createdAt).toBeInstanceOf(Date)
            expect(created.updatedAt).toBeInstanceOf(Date)

            const updatedInput = proxyHostInput('updated')
            const updated = await runAsUser(owner.id, () =>
                updateProxyHostService({
                    ...updatedInput,
                    enabled: false,
                    proxyHostId: created.id,
                }),
            )

            expect(updated).toMatchObject({
                ...updatedInput,
                domains: updatedInput.domains.toSorted(),
                enabled: false,
                id: created.id,
            })
            expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
            expect(await runAsUser(owner.id, getProxyHostsService)).toEqual([updated])

            await runAsUser(owner.id, () => deleteProxyHostService(created.id))
            expect(
                await getAuthDatabase()
                    .select({ id: proxyHostDomains.id })
                    .from(proxyHostDomains)
                    .where(eq(proxyHostDomains.proxyHostId, created.id)),
            ).toEqual([])
        },
    )

    integrationTest(
        'maps conflicts, rolls failed updates back, and relies on database constraints',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const firstInput = proxyHostInput('first')
            const secondInput = proxyHostInput('second')
            const first = await runAsUser(owner.id, () => createProxyHostService(firstInput))
            const second = await runAsUser(owner.id, () => createProxyHostService(secondInput))
            const updateError = await captureError(
                runAsUser(owner.id, () =>
                    updateProxyHostService({
                        ...proxyHostInput('rollback'),
                        domains: second.domains,
                        proxyHostId: first.id,
                    }),
                ),
            )

            expectProxyHostDomainError(updateError, 'domain_conflict')
            expect(
                await getAuthDatabase()
                    .select({ domain: proxyHostDomains.domain })
                    .from(proxyHostDomains)
                    .where(eq(proxyHostDomains.proxyHostId, first.id)),
            ).toEqual(first.domains.map((domain) => ({ domain })))

            const invalidScheme = await captureError(
                getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        enabled: true,
                        forwardHost: `raw-scheme${TEST_DOMAIN_SUFFIX}`,
                        forwardPort: 8_080,
                        forwardScheme: 'ftp' as never,
                    })
                    .returning({ id: proxyHosts.id }),
            )
            const invalidPort = await captureError(
                getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        enabled: true,
                        forwardHost: `raw-port${TEST_DOMAIN_SUFFIX}`,
                        forwardPort: 0,
                        forwardScheme: 'http',
                    })
                    .returning({ id: proxyHosts.id }),
            )
            const rawHost = requireFirstRow(
                await getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        enabled: true,
                        forwardHost: `raw-domain${TEST_DOMAIN_SUFFIX}`,
                        forwardPort: 8_080,
                        forwardScheme: 'http',
                    })
                    .returning({ id: proxyHosts.id }),
                'Raw constraint test host was not inserted.',
            )
            const invalidCanonicalDomain = await captureError(
                getAuthDatabase()
                    .insert(proxyHostDomains)
                    .values({
                        domain: `UPPER${TEST_DOMAIN_SUFFIX.toUpperCase()}`,
                        proxyHostId: rawHost.id,
                    })
                    .returning({ id: proxyHostDomains.id }),
            )

            const excessivePort = await captureError(
                getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        enabled: true,
                        forwardHost: `raw-excessive-port${TEST_DOMAIN_SUFFIX}`,
                        forwardPort: 65_536,
                        forwardScheme: 'http',
                    })
                    .returning({ id: proxyHosts.id }),
            )
            const trailingDotDomain = await captureError(
                getAuthDatabase()
                    .insert(proxyHostDomains)
                    .values({
                        domain: `${testDomain('raw-trailing')}.`,
                        proxyHostId: rawHost.id,
                    })
                    .returning({ id: proxyHostDomains.id }),
            )
            const duplicateDomain = testDomain('raw-duplicate')
            const rawHostTwo = requireFirstRow(
                await getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        enabled: true,
                        forwardHost: `raw-duplicate${TEST_DOMAIN_SUFFIX}`,
                        forwardPort: 8_080,
                        forwardScheme: 'http',
                    })
                    .returning({ id: proxyHosts.id }),
                'Second raw constraint test host was not inserted.',
            )
            await getAuthDatabase().insert(proxyHostDomains).values({
                domain: duplicateDomain,
                proxyHostId: rawHost.id,
            })
            const duplicateDomainError = await captureError(
                getAuthDatabase()
                    .insert(proxyHostDomains)
                    .values({ domain: duplicateDomain, proxyHostId: rawHostTwo.id })
                    .returning({ id: proxyHostDomains.id }),
            )
            expect(invalidScheme).toBeInstanceOf(Error)
            expect(invalidPort).toBeInstanceOf(Error)
            expect(invalidCanonicalDomain).toBeInstanceOf(Error)
            expect(excessivePort).toBeInstanceOf(Error)
            expect(trailingDotDomain).toBeInstanceOf(Error)
            expectProxyHostDomainError(
                mapProxyHostDomainUniqueViolation(duplicateDomainError),
                'domain_conflict',
            )
        },
    )

    integrationTest(
        'enforces explicit enable and disable transitions without mutating on no-op',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const created = await runAsUser(owner.id, () =>
                createProxyHostService(proxyHostInput('status')),
            )
            const disabled = await runAsUser(owner.id, () => disableProxyHostService(created.id))
            const noOpError = await captureError(
                runAsUser(owner.id, () => disableProxyHostService(created.id)),
            )
            const afterNoOp = requireFirstRow(
                await getAuthDatabase()
                    .select({ updatedAt: proxyHosts.updatedAt })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
                'Disabled proxy host was not found.',
            )
            const enabled = await runAsUser(owner.id, () => enableProxyHostService(created.id))

            const doubleEnableError = await captureError(
                runAsUser(owner.id, () => enableProxyHostService(created.id)),
            )
            const notFoundError = await captureError(
                runAsUser(owner.id, () => disableProxyHostService(randomUUID())),
            )
            expect(disabled.enabled).toBeFalse()
            expectProxyHostDomainError(noOpError, 'invalid_status_transition')
            expect(afterNoOp.updatedAt).toEqual(disabled.updatedAt)
            expect(enabled.enabled).toBeTrue()
            expectProxyHostDomainError(doubleEnableError, 'invalid_status_transition')
            expectProxyHostDomainError(notFoundError, 'proxy_host_not_found')
        },
    )

    integrationTest(
        'enforces Owner, Admin, Viewer, and custom permissions including update state bypass prevention',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const admin = await createTestUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
            const created = await runAsUser(admin.id, () =>
                createProxyHostService(proxyHostInput('admin')),
            )
            const viewerResult = await runAsUser(viewer.id, getProxyHostsService)
            const viewerCreateError = await captureError(
                runAsUser(viewer.id, () => createProxyHostService(proxyHostInput('viewer-denied'))),
            )
            const updateOnlyRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            ])
            const updateOnlyActor = await createTestUser([updateOnlyRole.key])
            const unchangedState = await runAsUser(updateOnlyActor.id, () =>
                updateProxyHostService({
                    ...proxyHostInput('update-only-without-status-change'),
                    enabled: true,
                    proxyHostId: created.id,
                }),
            )
            const stateBypassError = await captureError(
                runAsUser(updateOnlyActor.id, () =>
                    updateProxyHostService({
                        ...proxyHostInput('update-only'),
                        enabled: false,
                        proxyHostId: created.id,
                    }),
                ),
            )
            const updateAndDisableRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_DISABLE,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            ])
            const updateAndDisableActor = await createTestUser([updateAndDisableRole.key])
            const stateChanged = await runAsUser(updateAndDisableActor.id, () =>
                updateProxyHostService({
                    ...proxyHostInput('update-disable'),
                    enabled: false,
                    proxyHostId: created.id,
                }),
            )
            const createRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_CREATE,
            ])
            const customCreator = await createTestUser([createRole.key])
            const customCreated = await runAsUser(customCreator.id, () =>
                createProxyHostService(proxyHostInput('custom-create')),
            )

            expect(viewerResult).toHaveLength(1)
            expect(viewerCreateError).toBeInstanceOf(AuthDomainError)
            expect(unchangedState.enabled).toBeTrue()
            expect(stateBypassError).toBeInstanceOf(AuthDomainError)
            expect(stateChanged.enabled).toBeFalse()
            expect(customCreated.id[14]).toBe('7')
            expect(await runAsUser(owner.id, getProxyHostsService)).toHaveLength(2)
        },
    )

    integrationTest(
        're-evaluates a revoked permission for the same authenticated session',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            await runAsUser(owner.id, () => createProxyHostService(proxyHostInput('revocation')))
            const customRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_VIEW,
            ])
            const actor = await createTestUser([customRole.key])
            const session = await createSessionService(actor.id)

            expect(await runWithSessionToken(session.token, getProxyHostsService)).toHaveLength(1)
            await getAuthDatabase()
                .delete(rolePermissions)
                .where(eq(rolePermissions.roleId, customRole.id))
            const revokedError = await captureError(
                runWithSessionToken(session.token, getProxyHostsService),
            )

            expect(revokedError).toBeInstanceOf(AuthDomainError)
        },
    )

    integrationTest('lets exactly one concurrent create claim a normalized domain', async () => {
        const firstOwner = await createTestUser([SYSTEM_ROLES.OWNER])
        const secondOwner = await createTestUser([SYSTEM_ROLES.OWNER])
        const sharedDomain = testDomain('concurrent')
        const firstInput = { ...proxyHostInput('concurrent-first'), domains: [sharedDomain] }
        const secondInput = {
            ...proxyHostInput('concurrent-second'),
            domains: [` ${sharedDomain.toUpperCase()}. `],
        }
        const results = await Promise.allSettled([
            runAsUser(firstOwner.id, () => createProxyHostService(firstInput)),
            runAsUser(secondOwner.id, () => createProxyHostService(secondInput)),
        ])
        const successful = results.filter(
            (
                result,
            ): result is PromiseFulfilledResult<
                Awaited<ReturnType<typeof createProxyHostService>>
            > => result.status === 'fulfilled',
        )
        const rejected = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected',
        )

        expect(successful).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expectProxyHostDomainError(rejected[0]?.reason, 'domain_conflict')
        expect(
            await getAuthDatabase()
                .select({ domain: proxyHostDomains.domain })
                .from(proxyHostDomains)
                .where(eq(proxyHostDomains.domain, sharedDomain)),
        ).toEqual([{ domain: sharedDomain }])
    })

    integrationTest(
        'validates direct service calls without relying on transport validation',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const invalidCreateError = await captureError(
                runAsUser(owner.id, () =>
                    createProxyHostService({
                        ...proxyHostInput('invalid'),
                        forwardPort: '8080' as never,
                    }),
                ),
            )
            const invalidForwardHostError = await captureError(
                runAsUser(owner.id, () =>
                    createProxyHostService({
                        ...proxyHostInput('invalid-forward-host'),
                        forwardHost: 'https://origin.example.test',
                    }),
                ),
            )
            const invalidDeleteError = await captureError(
                runAsUser(owner.id, () => deleteProxyHostService('not-a-uuid')),
            )

            expectProxyHostDomainError(invalidCreateError, 'invalid_input')
            expectProxyHostDomainError(invalidForwardHostError, 'invalid_input')
            expectProxyHostDomainError(invalidDeleteError, 'invalid_input')
        },
    )
    integrationTest(
        'enforces every admin mutation while viewers are denied every mutation',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const admin = await createTestUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
            const created = await runAsUser(owner.id, () =>
                createProxyHostService(proxyHostInput('viewer-mutations')),
            )
            const viewerCreateError = await captureError(
                runAsUser(viewer.id, () => createProxyHostService(proxyHostInput('viewer-create'))),
            )
            const viewerUpdateError = await captureError(
                runAsUser(viewer.id, () =>
                    updateProxyHostService({
                        ...proxyHostInput('viewer-update'),
                        proxyHostId: created.id,
                    }),
                ),
            )
            const viewerEnableError = await captureError(
                runAsUser(viewer.id, () => enableProxyHostService(created.id)),
            )
            const viewerDisableError = await captureError(
                runAsUser(viewer.id, () => disableProxyHostService(created.id)),
            )
            const viewerDeleteError = await captureError(
                runAsUser(viewer.id, () => deleteProxyHostService(created.id)),
            )
            const adminUpdated = await runAsUser(admin.id, () =>
                updateProxyHostService({
                    ...proxyHostInput('admin-update'),
                    proxyHostId: created.id,
                }),
            )
            const adminDisabled = await runAsUser(admin.id, () =>
                disableProxyHostService(created.id),
            )
            const adminEnabled = await runAsUser(admin.id, () => enableProxyHostService(created.id))
            await runAsUser(admin.id, () => deleteProxyHostService(created.id))

            expect(viewerCreateError).toBeInstanceOf(AuthDomainError)
            expect(viewerUpdateError).toBeInstanceOf(AuthDomainError)
            expect(viewerEnableError).toBeInstanceOf(AuthDomainError)
            expect(viewerDisableError).toBeInstanceOf(AuthDomainError)
            expect(viewerDeleteError).toBeInstanceOf(AuthDomainError)
            expect(adminUpdated.enabled).toBeTrue()
            expect(adminDisabled.enabled).toBeFalse()
            expect(adminEnabled.enabled).toBeTrue()
            expect(
                await getAuthDatabase()
                    .select({ id: proxyHosts.id })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
            ).toEqual([])
        },
    )

    integrationTest('denies viewing to a custom role without the view permission', async () => {
        const creatorRole = await createCustomRole([
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.PROXY_HOSTS_CREATE,
        ])
        const creator = await createTestUser([creatorRole.key])
        await runAsUser(creator.id, () => createProxyHostService(proxyHostInput('custom-no-view')))
        const listError = await captureError(runAsUser(creator.id, getProxyHostsService))

        expect(listError).toBeInstanceOf(AuthDomainError)
    })

    integrationTest(
        'synchronizes proxy permissions without modifying custom role assignments',
        async () => {
            const customRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            ])
            await getAuthDatabase().transaction((transaction) =>
                ensureAuthorizationRegistryInTransaction(transaction),
            )
            const owner = SYSTEM_ROLE_REGISTRY.find((role) => role.key === SYSTEM_ROLES.OWNER)
            const admin = SYSTEM_ROLE_REGISTRY.find((role) => role.key === SYSTEM_ROLES.ADMIN)
            const viewer = SYSTEM_ROLE_REGISTRY.find((role) => role.key === SYSTEM_ROLES.VIEWER)

            if (!owner || !admin || !viewer) {
                throw new Error('A system role definition is unavailable.')
            }

            const registeredProxyPermissions = (
                await getAuthDatabase().select({ key: permissions.key }).from(permissions)
            )
                .map((permission) => permission.key)
                .filter((key) => key.startsWith('proxy_hosts.'))
                .toSorted()

            expect(registeredProxyPermissions).toEqual(
                Object.values(PERMISSIONS)
                    .filter((key) => key.startsWith('proxy_hosts.'))
                    .toSorted(),
            )
            expect(await loadRolePermissionKeys(owner.key)).toEqual(owner.permissionKeys.toSorted())
            expect(await loadRolePermissionKeys(admin.key)).toEqual(admin.permissionKeys.toSorted())
            expect(
                (await loadRolePermissionKeys(viewer.key)).filter((key) =>
                    key.startsWith('proxy_hosts.'),
                ),
            ).toEqual([PERMISSIONS.PROXY_HOSTS_VIEW])
            expect(await loadRolePermissionKeys(customRole.key)).toEqual(
                [PERMISSIONS.APP_ACCESS, PERMISSIONS.PROXY_HOSTS_UPDATE].toSorted(),
            )
            expect(await loadRolePermissionKeys(admin.key)).toEqual(
                PERMISSION_REGISTRY.map((permission) => permission.key).toSorted(),
            )
        },
    )
})
