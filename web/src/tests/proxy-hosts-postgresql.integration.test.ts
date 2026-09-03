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
    redirectHosts,
    hostDomains,
    certificateDomains,
    certificates,
    proxyHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import {
    applyProxyConfigurationService,
    getProxyRuntimeSnapshotService,
} from '../server/ProxyRuntime/proxy-runtime.service'
import {
    getProxyHostConfigEditorService,
    previewProxyHostConfigEditorService,
    resetProxyHostConfigEditorService,
    saveProxyHostConfigEditorService,
} from '../server/ProxyRuntime/proxy-host-config-editor.service'
import {
    getProxyConfigEditorService,
    previewProxyConfigEditorService,
    ProxyConfigEditorError,
} from '../server/ProxyRuntime/proxy-config-editor.service'
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
    createRedirectHostService,
    deleteRedirectHostService,
    disableRedirectHostService,
    enableRedirectHostService,
    getRedirectHostsService,
    updateRedirectHostService,
} from '../server/Admin/RedirectHostManagement/redirect-hosts.service'
import {
    deleteCertificateService,
    getCertificatesService,
} from '../server/Admin/CertificateManagement/certificates.service'
import {
    mapProxyHostDomainUniqueViolation,
    ProxyHostDomainError,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.errors'
import { RedirectHostDomainError } from '../server/Admin/RedirectHostManagement/redirect-hosts.errors'
import { getDatabaseUrl } from '../server/env.server'
import type { CreateProxyHostInput } from '../features/Admin/ProxyHostManagement/validation'
import type { CreateRedirectHostInput } from '../features/Admin/RedirectHostManagement/validation'

const DATABASE_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = DATABASE_INTEGRATION_ENABLED ? test : test.skip
const TEST_DOMAIN_SUFFIX = '.proxy-host-test.invalid'
const TEST_EMAIL_SUFFIX = '@proxy-host-test.invalid'
const TEST_ROLE_PREFIX = 'proxy-host-test-'
const TEST_CERTIFICATE_PREFIX = 'proxy-host-test-certificate-'

let dedicatedDatabaseVerified = false
const originalControllerEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (variable) => [variable, process.env[variable]] as const,
    ),
)

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

function redirectHostInput(label: string): CreateRedirectHostInput {
    return {
        domains: [testDomain(`redirect-${label}`)],
        destination: `https://destination-${randomUUID().replaceAll('-', '').slice(0, 16)}${TEST_DOMAIN_SUFFIX}/target`,
        statusCode: 302,
        preserveRequestUri: true,
        enabled: true,
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
    const redirectRows = await database
        .select({ id: redirectHosts.id })
        .from(redirectHosts)
        .where(like(redirectHosts.destination, `%${TEST_DOMAIN_SUFFIX}%`))

    await database.transaction(async (transaction) => {
        if (hostRows.length > 0) {
            await transaction.delete(proxyHosts).where(
                inArray(
                    proxyHosts.id,
                    hostRows.map((host) => host.id),
                ),
            )
        }
        if (redirectRows.length > 0) {
            await transaction.delete(redirectHosts).where(
                inArray(
                    redirectHosts.id,
                    redirectRows.map((host) => host.id),
                ),
            )
        }

        await transaction.delete(users).where(like(users.email, `%${TEST_EMAIL_SUFFIX}`))
        await transaction.delete(roles).where(like(roles.key, `${TEST_ROLE_PREFIX}%`))
        await transaction
            .delete(certificates)
            .where(like(certificates.name, TEST_CERTIFICATE_PREFIX + '%'))
    })
}

async function insertValidCertificate(domains: ReadonlyArray<string>): Promise<string> {
    const certificate = requireFirstRow(
        await getAuthDatabase()
            .insert(certificates)
            .values({
                name: TEST_CERTIFICATE_PREFIX + randomUUID(),
                source: 'manual',
                status: 'valid',
                operation: 'idle',
                issuedAt: new Date(Date.now() - 60_000),
                expiresAt: new Date(Date.now() + 86_400_000),
                issuer: 'PostgreSQL integration fixture',
                fingerprint: 'sha256:' + 'a'.repeat(64),
            })
            .returning({ id: certificates.id }),
        'Certificate fixture was not inserted.',
    )
    await getAuthDatabase()
        .insert(certificateDomains)
        .values(domains.map((domain) => ({ certificateId: certificate.id, domain })))
    return certificate.id
}

interface FakeController {
    readonly applyRevisions: string[]
    readonly requests: Array<{
        readonly method: string
        readonly path: string
        readonly body: string | null
    }>
    readonly server: ReturnType<typeof Bun.serve>
}

const FAKE_ACTIVE_REVISION = 'sha256:' + 'a'.repeat(64)

function startFakeController(
    failApply: boolean,
    options: {
        readonly activeConfig?: string
        readonly certificate?: { readonly id: string; readonly domains: ReadonlyArray<string> }
    } = {},
): FakeController {
    const applyRevisions: string[] = []
    const requests: Array<{
        readonly method: string
        readonly path: string
        readonly body: string | null
    }> = []
    const activeConfig = options.activeConfig ?? '# fake active configuration'
    const certificateMetadata = options.certificate
        ? {
              id: options.certificate.id,
              source: 'manual',
              environment: null,
              domains: options.certificate.domains,
              status: 'valid',
              operation: 'idle',
              issuedAt: new Date(Date.now() - 60_000).toISOString(),
              expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
              issuer: 'PostgreSQL integration fixture',
              fingerprint: 'sha256:' + 'a'.repeat(64),
              lastErrorCode: null,
              updatedAt: new Date().toISOString(),
          }
        : null
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            const url = new URL(request.url)
            const body = request.method === 'GET' ? null : await request.text()
            requests.push({ method: request.method, path: url.pathname, body })

            if (request.method === 'PUT' && url.pathname === '/internal/v1/proxy/config') {
                if (failApply) {
                    applyRevisions.push('failed')
                    return new Response('unavailable', { status: 503 })
                }

                const payload = (body ? JSON.parse(body) : null) as { revision?: unknown } | null
                if (typeof payload?.revision !== 'string') {
                    return new Response('invalid', { status: 400 })
                }

                applyRevisions.push(payload.revision)
                return Response.json({
                    activeRevision: payload.revision,
                    lastApplyAt: null,
                    status: 'applied',
                })
            }

            if (
                request.method === 'GET' &&
                (url.pathname === '/internal/v1/proxy/config' ||
                    /^\/internal\/v1\/proxy\/hosts\/[0-9a-f-]+\/config$/u.test(url.pathname))
            ) {
                return Response.json({ config: activeConfig, activeRevision: FAKE_ACTIVE_REVISION })
            }

            if (
                request.method === 'POST' &&
                (url.pathname === '/internal/v1/proxy/config/preview' ||
                    /^\/internal\/v1\/proxy\/hosts\/[0-9a-f-]+\/config\/preview$/u.test(
                        url.pathname,
                    ))
            ) {
                const payload = (body ? JSON.parse(body) : null) as { revision?: unknown } | null
                if (typeof payload?.revision !== 'string') {
                    return new Response('invalid', { status: 400 })
                }
                return Response.json({
                    config: '# fake preview configuration',
                    revision: payload.revision,
                })
            }

            if (request.method === 'GET' && url.pathname === '/internal/v1/certificates') {
                return Response.json({
                    certificates: certificateMetadata ? [certificateMetadata] : [],
                })
            }

            if (
                request.method === 'GET' &&
                certificateMetadata &&
                url.pathname === '/internal/v1/certificates/' + certificateMetadata.id
            ) {
                return Response.json(certificateMetadata)
            }

            return new Response('not found', { status: 404 })
        },
    })
    process.env.RENTNERPROXY_CONTROLLER_URL = server.url.origin
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'C'.repeat(32)
    return { applyRevisions, requests, server }
}

async function insertRawProxyHost(
    input: CreateProxyHostInput,
    advancedConfig = '',
): Promise<string> {
    const rows = await getAuthDatabase()
        .insert(proxyHosts)
        .values({
            enabled: input.enabled,
            forwardHost: input.forwardHost,
            forwardPort: input.forwardPort,
            forwardScheme: input.forwardScheme,
            advancedConfig,
        })
        .returning({ id: proxyHosts.id })
    const id = requireFirstRow(rows, 'Raw runtime test host was not inserted.').id
    await getAuthDatabase()
        .insert(hostDomains)
        .values(input.domains.map((domain) => ({ domain, proxyHostId: id })))
    return id
}
async function assertDedicatedProxyHostDatabase(): Promise<void> {
    const [otherUsers, otherProxyHosts, otherRedirectHosts] = await Promise.all([
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
        getAuthDatabase()
            .select({ id: redirectHosts.id })
            .from(redirectHosts)
            .where(notLike(redirectHosts.destination, `%${TEST_DOMAIN_SUFFIX}%`))
            .limit(1),
    ])

    if (otherUsers.length > 0 || otherProxyHosts.length > 0 || otherRedirectHosts.length > 0) {
        throw new Error(
            'ProxyHost integration tests require a dedicated database without non-test users or hosts.',
        )
    }
}

function expectProxyHostDomainError(error: unknown, code: ProxyHostDomainError['code']): void {
    expect(error).toBeInstanceOf(ProxyHostDomainError)

    if (error instanceof ProxyHostDomainError) {
        expect(error.code).toBe(code)
    }
}

function expectRedirectHostDomainError(
    error: unknown,
    code: RedirectHostDomainError['code'],
): void {
    expect(error).toBeInstanceOf(RedirectHostDomainError)

    if (error instanceof RedirectHostDomainError) {
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
        // Only explicitly started test controllers may receive test snapshots.
        // An empty URL disables the client; deleting it would select localhost.
        process.env.RENTNERPROXY_CONTROLLER_URL = ''
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
        await cleanTestRows()
    }
})

afterEach(async () => {
    if (dedicatedDatabaseVerified) {
        await cleanTestRows()
    }
    for (const [variable, originalValue] of originalControllerEnvironment) {
        if (originalValue === undefined) delete process.env[variable]
        else process.env[variable] = originalValue
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
            const { runtimeStatus: _runtimeStatus, ...updatedWithoutRuntimeStatus } = updated
            expect(await runAsUser(owner.id, getProxyHostsService)).toEqual([
                updatedWithoutRuntimeStatus,
            ])

            await runAsUser(owner.id, () => deleteProxyHostService(created.id))
            expect(
                await getAuthDatabase()
                    .select({ id: hostDomains.id })
                    .from(hostDomains)
                    .where(eq(hostDomains.proxyHostId, created.id)),
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
                    .select({ domain: hostDomains.domain })
                    .from(hostDomains)
                    .where(eq(hostDomains.proxyHostId, first.id)),
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
                    .insert(hostDomains)
                    .values({
                        domain: `UPPER${TEST_DOMAIN_SUFFIX.toUpperCase()}`,
                        proxyHostId: rawHost.id,
                    })
                    .returning({ id: hostDomains.id }),
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
                    .insert(hostDomains)
                    .values({
                        domain: `${testDomain('raw-trailing')}.`,
                        proxyHostId: rawHost.id,
                    })
                    .returning({ id: hostDomains.id }),
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
            await getAuthDatabase().insert(hostDomains).values({
                domain: duplicateDomain,
                proxyHostId: rawHost.id,
            })
            const duplicateDomainError = await captureError(
                getAuthDatabase()
                    .insert(hostDomains)
                    .values({ domain: duplicateDomain, proxyHostId: rawHostTwo.id })
                    .returning({ id: hostDomains.id }),
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
                .select({ domain: hostDomains.domain })
                .from(hostDomains)
                .where(eq(hostDomains.domain, sharedDomain)),
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

describe('RedirectHost management with PostgreSQL', () => {
    integrationTest(
        'creates, updates, lists, and cascades canonical redirect host domains',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const primaryDomain = testDomain('redirect-primary')
            const secondaryDomain = testDomain('redirect-secondary')
            const created = await runAsUser(owner.id, () =>
                createRedirectHostService({
                    ...redirectHostInput('crud'),
                    domains: [
                        '  ' + secondaryDomain.toUpperCase() + '.',
                        primaryDomain.toUpperCase(),
                    ],
                    destination: ' HTTPS://Destination.Example/target ',
                }),
            )

            expect(created).toMatchObject({
                domains: [primaryDomain, secondaryDomain].toSorted(),
                destination: 'https://destination.example/target',
                enabled: true,
                preserveRequestUri: true,
                statusCode: 302,
            })
            expect(created.id[14]).toBe('7')

            const updatedInput = redirectHostInput('updated')
            const updated = await runAsUser(owner.id, () =>
                updateRedirectHostService({
                    ...updatedInput,
                    redirectHostId: created.id,
                    enabled: false,
                }),
            )

            expect(updated).toMatchObject({
                ...updatedInput,
                domains: updatedInput.domains.toSorted(),
                enabled: false,
                id: created.id,
            })
            const { runtimeStatus: _runtimeStatus, ...updatedWithoutRuntimeStatus } = updated
            expect(await runAsUser(owner.id, getRedirectHostsService)).toEqual([
                updatedWithoutRuntimeStatus,
            ])

            await runAsUser(owner.id, () => deleteRedirectHostService(created.id))
            expect(
                await getAuthDatabase()
                    .select({ id: hostDomains.id })
                    .from(hostDomains)
                    .where(eq(hostDomains.redirectHostId, created.id)),
            ).toEqual([])
        },
    )

    integrationTest(
        'rejects invalid destination and IDs without changing persisted state',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const created = await runAsUser(owner.id, () =>
                createRedirectHostService(redirectHostInput('validation')),
            )
            const invalidUpdateError = await captureError(
                runAsUser(owner.id, () =>
                    updateRedirectHostService({
                        ...redirectHostInput('invalid-destination'),
                        destination: 'ftp://destination.example/path',
                        redirectHostId: created.id,
                    }),
                ),
            )
            const invalidDeleteError = await captureError(
                runAsUser(owner.id, () => deleteRedirectHostService('not-a-uuid')),
            )
            const notFoundError = await captureError(
                runAsUser(owner.id, () => enableRedirectHostService(randomUUID())),
            )
            const persisted = requireFirstRow(
                await getAuthDatabase()
                    .select()
                    .from(redirectHosts)
                    .where(eq(redirectHosts.id, created.id)),
                'Redirect host was not persisted.',
            )

            expectRedirectHostDomainError(invalidUpdateError, 'invalid_input')
            expectRedirectHostDomainError(invalidDeleteError, 'invalid_input')
            expectRedirectHostDomainError(notFoundError, 'host_not_found')
            expect(persisted.destination).toBe(created.destination)
        },
    )

    integrationTest(
        'enforces redirect permissions and explicit enable and disable transitions',
        async () => {
            const admin = await createTestUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
            const created = await runAsUser(admin.id, () =>
                createRedirectHostService(redirectHostInput('permissions')),
            )
            const viewerResult = await runAsUser(viewer.id, getRedirectHostsService)
            const viewerCreateError = await captureError(
                runAsUser(viewer.id, () => createRedirectHostService(redirectHostInput('viewer'))),
            )
            const updateOnlyRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.REDIRECT_HOSTS_UPDATE,
            ])
            const updateOnlyActor = await createTestUser([updateOnlyRole.key])
            const unchangedState = await runAsUser(updateOnlyActor.id, () =>
                updateRedirectHostService({
                    ...redirectHostInput('update-only'),
                    enabled: true,
                    redirectHostId: created.id,
                }),
            )
            const stateBypassError = await captureError(
                runAsUser(updateOnlyActor.id, () =>
                    updateRedirectHostService({
                        ...redirectHostInput('state-bypass'),
                        enabled: false,
                        redirectHostId: created.id,
                    }),
                ),
            )
            const disabled = await runAsUser(admin.id, () => disableRedirectHostService(created.id))
            const noOpError = await captureError(
                runAsUser(admin.id, () => disableRedirectHostService(created.id)),
            )
            const enabled = await runAsUser(admin.id, () => enableRedirectHostService(created.id))

            expect(viewerResult).toHaveLength(1)
            expect(viewerCreateError).toBeInstanceOf(AuthDomainError)
            expect(unchangedState.enabled).toBeTrue()
            expect(stateBypassError).toBeInstanceOf(AuthDomainError)
            expect(disabled.enabled).toBeFalse()
            expect(enabled.enabled).toBeTrue()
            expectRedirectHostDomainError(noOpError, 'invalid_status_transition')
        },
    )

    integrationTest(
        'rejects proxy-to-redirect, redirect-to-proxy, and redirect-to-redirect domain conflicts',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const proxyOwnedDomain = testDomain('proxy-owned')
            const redirectOwnedDomain = testDomain('redirect-owned')

            await runAsUser(owner.id, () =>
                createProxyHostService({
                    ...proxyHostInput('domain-owner'),
                    domains: [proxyOwnedDomain],
                }),
            )
            const redirectAgainstProxy = await captureError(
                runAsUser(owner.id, () =>
                    createRedirectHostService({
                        ...redirectHostInput('against-proxy'),
                        domains: [proxyOwnedDomain.toUpperCase() + '.'],
                    }),
                ),
            )

            await runAsUser(owner.id, () =>
                createRedirectHostService({
                    ...redirectHostInput('domain-owner'),
                    domains: [redirectOwnedDomain],
                }),
            )
            const proxyAgainstRedirect = await captureError(
                runAsUser(owner.id, () =>
                    createProxyHostService({
                        ...proxyHostInput('against-redirect'),
                        domains: [' ' + redirectOwnedDomain.toUpperCase()],
                    }),
                ),
            )
            const redirectAgainstRedirect = await captureError(
                runAsUser(owner.id, () =>
                    createRedirectHostService({
                        ...redirectHostInput('against-redirect'),
                        domains: [redirectOwnedDomain],
                    }),
                ),
            )

            expectRedirectHostDomainError(redirectAgainstProxy, 'domain_conflict')
            expectProxyHostDomainError(proxyAgainstRedirect, 'domain_conflict')
            expectRedirectHostDomainError(redirectAgainstRedirect, 'domain_conflict')
            expect(
                await getAuthDatabase()
                    .select({ domain: hostDomains.domain })
                    .from(hostDomains)
                    .where(inArray(hostDomains.domain, [proxyOwnedDomain, redirectOwnedDomain])),
            ).toHaveLength(2)
        },
    )

    integrationTest(
        'lets exactly one concurrent proxy or redirect create claim a normalized domain',
        async () => {
            const firstOwner = await createTestUser([SYSTEM_ROLES.OWNER])
            const secondOwner = await createTestUser([SYSTEM_ROLES.OWNER])
            const sharedDomain = testDomain('cross-type-concurrent')
            const proxyInput = { ...proxyHostInput('cross-type-proxy'), domains: [sharedDomain] }
            const redirectInput = {
                ...redirectHostInput('cross-type-redirect'),
                domains: [' ' + sharedDomain.toUpperCase() + '.'],
            }
            const results = await Promise.allSettled([
                runAsUser(firstOwner.id, () => createProxyHostService(proxyInput)),
                runAsUser(secondOwner.id, () => createRedirectHostService(redirectInput)),
            ])
            const successful = results.filter((result) => result.status === 'fulfilled')
            const rejected = results.filter(
                (result): result is PromiseRejectedResult => result.status === 'rejected',
            )
            const domainRows = await getAuthDatabase()
                .select({ id: hostDomains.id })
                .from(hostDomains)
                .where(eq(hostDomains.domain, sharedDomain))

            expect(successful).toHaveLength(1)
            expect(rejected).toHaveLength(1)
            expect(rejected[0]?.reason).toMatchObject({ code: 'domain_conflict' })
            expect(domainRows).toHaveLength(1)
        },
    )

    for (const [expectedStatus, failApply] of [
        ['applied', false],
        ['pending', true],
    ] as const) {
        integrationTest(
            'persists redirect desired state when controller reconciliation is ' + expectedStatus,
            async () => {
                const owner = await createTestUser([SYSTEM_ROLES.OWNER])
                const controller = startFakeController(failApply)
                try {
                    const result = await runAsUser(owner.id, () =>
                        createRedirectHostService(redirectHostInput('reconcile-' + expectedStatus)),
                    )
                    expect(result.runtimeStatus).toBe(expectedStatus)
                    expect(
                        await getAuthDatabase()
                            .select({ id: redirectHosts.id })
                            .from(redirectHosts)
                            .where(eq(redirectHosts.id, result.id)),
                    ).toHaveLength(1)
                    expect(controller.applyRevisions).toHaveLength(1)
                } finally {
                    controller.server.stop(true)
                }
            },
        )
    }

    integrationTest(
        'counts disabled redirect assignments and blocks certificate deletion',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const domain = testDomain('certificate')
            const certificateId = await insertValidCertificate([domain])
            const controller = startFakeController(false, {
                certificate: { id: certificateId, domains: [domain] },
            })
            try {
                const created = await runAsUser(owner.id, () =>
                    createRedirectHostService({
                        ...redirectHostInput('certificate'),
                        certificateId,
                        domains: [domain],
                    }),
                )
                await runAsUser(owner.id, () => disableRedirectHostService(created.id))
                const certificatesSummary = await runAsUser(owner.id, getCertificatesService)
                const deleteError = await captureError(
                    runAsUser(owner.id, () => deleteCertificateService(certificateId)),
                )

                expect(
                    certificatesSummary.find((certificate) => certificate.id === certificateId),
                ).toMatchObject({ assignedHostCount: 1 })
                expect(deleteError).toMatchObject({ code: 'certificate_in_use' })
            } finally {
                controller.server.stop(true)
            }
        },
    )
})

describe('manual runtime apply permissions', () => {
    integrationTest(
        'grants manual apply to owner/admin and only explicitly assigned custom roles',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const admin = await createTestUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
            const deniedRole = await createCustomRole([PERMISSIONS.APP_ACCESS])
            const denied = await createTestUser([deniedRole.key])
            const grantedRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_APPLY,
            ])
            const granted = await createTestUser([grantedRole.key])
            const controller = startFakeController(false)
            try {
                expect(await runAsUser(owner.id, applyProxyConfigurationService)).toBe('applied')
                expect(await runAsUser(admin.id, applyProxyConfigurationService)).toBe('applied')
                expect(await runAsUser(granted.id, applyProxyConfigurationService)).toBe('applied')
                expect(
                    await captureError(runAsUser(viewer.id, applyProxyConfigurationService)),
                ).toBeInstanceOf(AuthDomainError)
                expect(
                    await captureError(runAsUser(denied.id, applyProxyConfigurationService)),
                ).toBeInstanceOf(AuthDomainError)
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )
})
describe('runtime reconcile after PostgreSQL mutations', () => {
    integrationTest.each([
        ['applied', false],
        ['pending', true],
    ] as const)(
        'reports %s after create and leaves the committed host',
        async (expected, failApply) => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const controller = startFakeController(failApply)
            try {
                const input = proxyHostInput('runtime-create')
                const result = await runAsUser(owner.id, () => createProxyHostService(input))
                const persisted = await getAuthDatabase()
                    .select({ id: proxyHosts.id })
                    .from(proxyHosts)
                    .innerJoin(hostDomains, eq(hostDomains.proxyHostId, proxyHosts.id))
                    .where(eq(hostDomains.domain, input.domains[0]!))

                expect(result.runtimeStatus).toBe(expected)
                expect(persisted).toHaveLength(1)
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest.each([
        ['applied', false],
        ['pending', true],
    ] as const)(
        'reports %s after update and leaves the committed values',
        async (expected, failApply) => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const original = proxyHostInput('runtime-update-original')
            const proxyHostId = await insertRawProxyHost(original)
            const controller = startFakeController(failApply)
            try {
                const input = proxyHostInput('runtime-update-new')
                const result = await runAsUser(owner.id, () =>
                    updateProxyHostService({ ...input, proxyHostId }),
                )
                const persisted = requireFirstRow(
                    await getAuthDatabase()
                        .select({ forwardPort: proxyHosts.forwardPort })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, proxyHostId)),
                    'Updated runtime test host was not persisted.',
                )

                expect(result.runtimeStatus).toBe(expected)
                expect(persisted.forwardPort).toBe(input.forwardPort)
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest.each([
        ['applied', false],
        ['pending', true],
    ] as const)(
        'reports %s after delete and leaves the committed deletion',
        async (expected, failApply) => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const proxyHostId = await insertRawProxyHost(proxyHostInput('runtime-delete'))
            const controller = startFakeController(failApply)
            try {
                const result = await runAsUser(owner.id, () => deleteProxyHostService(proxyHostId))
                const persisted = await getAuthDatabase()
                    .select({ id: proxyHosts.id })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, proxyHostId))

                expect(result.runtimeStatus).toBe(expected)
                expect(persisted).toEqual([])
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest.each([
        ['applied', false],
        ['pending', true],
    ] as const)(
        'reports %s after disable and leaves the committed status',
        async (expected, failApply) => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const proxyHostId = await insertRawProxyHost(proxyHostInput('runtime-disable'))
            const controller = startFakeController(failApply)
            try {
                const result = await runAsUser(owner.id, () => disableProxyHostService(proxyHostId))
                const persisted = requireFirstRow(
                    await getAuthDatabase()
                        .select({ enabled: proxyHosts.enabled })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, proxyHostId)),
                    'Disabled runtime test host was not persisted.',
                )

                expect(result.runtimeStatus).toBe(expected)
                expect(persisted.enabled).toBeFalse()
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest.each([
        ['applied', false],
        ['pending', true],
    ] as const)(
        'reports %s after enable and leaves the committed status',
        async (expected, failApply) => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const input = proxyHostInput('runtime-enable')
            const proxyHostId = await insertRawProxyHost({ ...input, enabled: false })
            const controller = startFakeController(failApply)
            try {
                const result = await runAsUser(owner.id, () => enableProxyHostService(proxyHostId))
                const persisted = requireFirstRow(
                    await getAuthDatabase()
                        .select({ enabled: proxyHosts.enabled })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, proxyHostId)),
                    'Enabled runtime test host was not persisted.',
                )

                expect(result.runtimeStatus).toBe(expected)
                expect(persisted.enabled).toBeTrue()
                expect(controller.applyRevisions.length).toBeGreaterThan(0)
            } finally {
                await controller.server.stop(true)
            }
        },
    )
})

describe('advanced proxy host configuration with PostgreSQL', () => {
    integrationTest(
        'defaults raw configuration and ignores a crafted normal host field',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const craftedInput = {
                ...proxyHostInput('crafted-raw'),
                advancedConfig: 'add_header X-Should-Be-Ignored yes;',
            }
            const created = await runAsUser(owner.id, () => createProxyHostService(craftedInput))

            const row = requireFirstRow(
                await getAuthDatabase()
                    .select({ advancedConfig: proxyHosts.advancedConfig })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
                'Crafted raw host was not persisted.',
            )
            expect(row.advancedConfig).toBe('')
            expect(await runAsUser(owner.id, getProxyHostsService)).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ advancedConfig: expect.anything() }),
                ]),
            )
        },
    )

    integrationTest('owner and admin persist normalized raw configuration', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const admin = await createTestUser([SYSTEM_ROLES.ADMIN])
        const created = await runAsUser(owner.id, () =>
            createProxyHostService(proxyHostInput('owner-admin-raw')),
        )
        const controller = startFakeController(false)
        try {
            const ownerState = await runAsUser(owner.id, () =>
                getProxyHostConfigEditorService(created.id),
            )
            expect(ownerState.advancedConfig).toBe('')
            await runAsUser(owner.id, () =>
                saveProxyHostConfigEditorService({
                    advancedConfig: 'add_header X-Owner works;\r\n# owner',
                    baseRevision: ownerState.baseRevision,
                    proxyHostId: created.id,
                    settingsSource: '',
                }),
            )

            const ownerRow = requireFirstRow(
                await getAuthDatabase()
                    .select({ advancedConfig: proxyHosts.advancedConfig })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
                'Owner raw configuration was not persisted.',
            )
            expect(ownerRow.advancedConfig).toBe('add_header X-Owner works;\n# owner')

            const adminState = await runAsUser(admin.id, () =>
                getProxyHostConfigEditorService(created.id),
            )
            await runAsUser(admin.id, () =>
                saveProxyHostConfigEditorService({
                    advancedConfig: 'add_header X-Admin works;\r\n',
                    baseRevision: adminState.baseRevision,
                    proxyHostId: created.id,
                    settingsSource: '',
                }),
            )
            const adminRow = requireFirstRow(
                await getAuthDatabase()
                    .select({ advancedConfig: proxyHosts.advancedConfig })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
                'Admin raw configuration was not persisted.',
            )
            expect(adminRow.advancedConfig).toBe('add_header X-Admin works;\n')
        } finally {
            await controller.server.stop(true)
        }
    })

    integrationTest(
        'custom roles require the raw permission and preserve hidden raw text',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const created = await runAsUser(owner.id, () =>
                createProxyHostService(proxyHostInput('custom-raw')),
            )
            const raw = 'add_header X-Private secret;'
            await getAuthDatabase()
                .update(proxyHosts)
                .set({ advancedConfig: raw })
                .where(eq(proxyHosts.id, created.id))

            const limitedRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_VIEW,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
                PERMISSIONS.PROXY_HOSTS_APPLY,
            ])
            const limited = await createTestUser([limitedRole.key])
            const grantedRole = await createCustomRole([
                PERMISSIONS.APP_ACCESS,
                PERMISSIONS.PROXY_HOSTS_VIEW,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
                PERMISSIONS.PROXY_HOSTS_APPLY,
                PERMISSIONS.PROXY_HOSTS_ADVANCED_CONFIG,
            ])
            const granted = await createTestUser([grantedRole.key])
            const controller = startFakeController(false, { activeConfig: 'controller-secret' })
            try {
                const hidden = await runAsUser(limited.id, () =>
                    getProxyHostConfigEditorService(created.id),
                )
                expect(hidden).not.toHaveProperty('advancedConfig')
                expect(hidden.active).toBeNull()
                expect(hidden.defaults).not.toBeNull()
                expect(hidden.generated).not.toBeNull()
                expect(hidden.defaults?.config).not.toContain('controller-secret')
                expect(hidden.generated?.config).not.toContain('controller-secret')
                expect(
                    controller.requests.some(
                        (request) =>
                            request.method === 'GET' &&
                            request.path.endsWith('/config') &&
                            request.path.includes('/hosts/'),
                    ),
                ).toBeFalse()
                expect(
                    controller.requests
                        .filter(
                            (request) =>
                                request.method === 'POST' &&
                                request.path.includes('/hosts/') &&
                                request.path.endsWith('/preview'),
                        )
                        .every((request) => !request.body?.includes('controller-secret')),
                ).toBeTrue()

                const deniedSave = await captureError(
                    runAsUser(limited.id, () =>
                        saveProxyHostConfigEditorService({
                            advancedConfig: 'controller-secret',
                            baseRevision: hidden.baseRevision,
                            proxyHostId: created.id,
                            settingsSource: '',
                        }),
                    ),
                )
                const deniedPreview = await captureError(
                    runAsUser(limited.id, () =>
                        previewProxyHostConfigEditorService({
                            advancedConfig: 'controller-secret',
                            proxyHostId: created.id,
                            settingsSource: '',
                        }),
                    ),
                )
                const deniedReset = await captureError(
                    runAsUser(limited.id, () =>
                        resetProxyHostConfigEditorService({
                            baseRevision: hidden.baseRevision,
                            proxyHostId: created.id,
                            resetAdvancedConfig: true,
                        }),
                    ),
                )
                expect(deniedSave).toBeInstanceOf(AuthDomainError)
                expect(deniedPreview).toBeInstanceOf(AuthDomainError)
                expect(deniedReset).toBeInstanceOf(AuthDomainError)

                await runAsUser(limited.id, () =>
                    saveProxyHostConfigEditorService({
                        baseRevision: hidden.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: '',
                    }),
                )
                const craftedUpdate = {
                    ...proxyHostInput('custom-normal-update'),
                    advancedConfig: 'controller-secret',
                    forwardPort: 8_081,
                    proxyHostId: created.id,
                }
                await runAsUser(limited.id, () => updateProxyHostService(craftedUpdate))
                const preserved = requireFirstRow(
                    await getAuthDatabase()
                        .select({
                            advancedConfig: proxyHosts.advancedConfig,
                            forwardPort: proxyHosts.forwardPort,
                        })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, created.id)),
                    'Hidden raw configuration was not preserved.',
                )
                expect(preserved.advancedConfig).toBe(raw)
                expect(preserved.forwardPort).toBe(8_081)

                const grantedState = await runAsUser(granted.id, () =>
                    getProxyHostConfigEditorService(created.id),
                )
                expect(grantedState.advancedConfig).toBe(raw)
                await runAsUser(granted.id, () =>
                    saveProxyHostConfigEditorService({
                        advancedConfig: 'add_header X-Granted yes;',
                        baseRevision: grantedState.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: '',
                    }),
                )
                const grantedRow = requireFirstRow(
                    await getAuthDatabase()
                        .select({ advancedConfig: proxyHosts.advancedConfig })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, created.id)),
                    'Granted custom raw configuration was not persisted.',
                )
                expect(grantedRow.advancedConfig).toBe('add_header X-Granted yes;')
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest('viewer omits raw configuration and cannot write it', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
        const created = await runAsUser(owner.id, () =>
            createProxyHostService(proxyHostInput('viewer-raw')),
        )
        await getAuthDatabase()
            .update(proxyHosts)
            .set({ advancedConfig: 'controller-secret' })
            .where(eq(proxyHosts.id, created.id))
        const controller = startFakeController(false, { activeConfig: 'controller-secret' })
        try {
            const state = await runAsUser(viewer.id, () =>
                getProxyHostConfigEditorService(created.id),
            )
            expect(state).not.toHaveProperty('advancedConfig')
            expect(state.active).toBeNull()
            expect(state.defaults).not.toBeNull()
            expect(state.generated).not.toBeNull()
            expect(state.defaults?.config).not.toContain('controller-secret')
            expect(state.generated?.config).not.toContain('controller-secret')
            const preview = await runAsUser(viewer.id, () =>
                previewProxyHostConfigEditorService({
                    proxyHostId: created.id,
                    settingsSource: '',
                }),
            )
            expect(preview).not.toBeNull()
            expect(preview.config).not.toContain('controller-secret')
            const denied = await captureError(
                runAsUser(viewer.id, () =>
                    saveProxyHostConfigEditorService({
                        advancedConfig: 'controller-secret',
                        baseRevision: state.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: '',
                    }),
                ),
            )
            expect(denied).toBeInstanceOf(AuthDomainError)
        } finally {
            await controller.server.stop(true)
        }
    })

    integrationTest('global full-source query and preview require the raw permission', async () => {
        const viewer = await createTestUser([SYSTEM_ROLES.VIEWER])
        expect(
            await captureError(runAsUser(viewer.id, getProxyConfigEditorService)),
        ).toBeInstanceOf(AuthDomainError)
        expect(
            await captureError(runAsUser(viewer.id, () => previewProxyConfigEditorService(''))),
        ).toBeInstanceOf(AuthDomainError)
    })

    integrationTest(
        'structured save and reset preserve raw configuration unless requested',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const created = await runAsUser(owner.id, () =>
                createProxyHostService(proxyHostInput('structured-preserve')),
            )
            await getAuthDatabase()
                .update(proxyHosts)
                .set({ advancedConfig: 'add_header X-Keep yes;' })
                .where(eq(proxyHosts.id, created.id))
            const controller = startFakeController(false)
            try {
                const state = await runAsUser(owner.id, () =>
                    getProxyHostConfigEditorService(created.id),
                )
                await runAsUser(owner.id, () =>
                    saveProxyHostConfigEditorService({
                        baseRevision: state.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: 'proxy_read_timeout 30s;',
                    }),
                )
                const afterSettings = requireFirstRow(
                    await getAuthDatabase()
                        .select({ advancedConfig: proxyHosts.advancedConfig })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, created.id)),
                    'Raw configuration disappeared during structured save.',
                )
                expect(afterSettings.advancedConfig).toBe('add_header X-Keep yes;')

                const next = await runAsUser(owner.id, () =>
                    getProxyHostConfigEditorService(created.id),
                )
                await runAsUser(owner.id, () =>
                    resetProxyHostConfigEditorService({
                        baseRevision: next.baseRevision,
                        proxyHostId: created.id,
                    }),
                )
                const afterReset = requireFirstRow(
                    await getAuthDatabase()
                        .select({ advancedConfig: proxyHosts.advancedConfig })
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, created.id)),
                    'Raw configuration disappeared during reset.',
                )
                expect(afterReset.advancedConfig).toBe('add_header X-Keep yes;')
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest('advanced reset isolates hosts and delete cascades the raw field', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const first = await insertRawProxyHost(
            proxyHostInput('reset-first'),
            'add_header X-First yes;',
        )
        const second = await insertRawProxyHost(
            proxyHostInput('reset-second'),
            'add_header X-Second yes;',
        )
        const controller = startFakeController(false)
        try {
            const state = await runAsUser(owner.id, () => getProxyHostConfigEditorService(first))
            await runAsUser(owner.id, () =>
                resetProxyHostConfigEditorService({
                    baseRevision: state.baseRevision,
                    proxyHostId: first,
                    resetAdvancedConfig: true,
                }),
            )
            const rows = await getAuthDatabase()
                .select({ id: proxyHosts.id, advancedConfig: proxyHosts.advancedConfig })
                .from(proxyHosts)
                .where(inArray(proxyHosts.id, [first, second]))
            expect(rows).toEqual(
                expect.arrayContaining([
                    { id: first, advancedConfig: '' },
                    { id: second, advancedConfig: 'add_header X-Second yes;' },
                ]),
            )

            await runAsUser(owner.id, () => deleteProxyHostService(first))
            expect(
                await getAuthDatabase()
                    .select({ id: proxyHosts.id })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, first)),
            ).toEqual([])
            expect(
                await getAuthDatabase()
                    .select({ proxyHostId: hostDomains.proxyHostId })
                    .from(hostDomains)
                    .where(eq(hostDomains.proxyHostId, first)),
            ).toEqual([])
        } finally {
            await controller.server.stop(true)
        }
    })

    integrationTest('disabled snapshots omit raw configuration until enable', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const created = await insertRawProxyHost(
            { ...proxyHostInput('disabled-raw'), enabled: false },
            'add_header X-Disabled yes;',
        )
        const hidden = await runAsUser(owner.id, getProxyRuntimeSnapshotService)
        expect(hidden.proxyHosts).toEqual([])

        const controller = startFakeController(false)
        try {
            await runAsUser(owner.id, () => enableProxyHostService(created))
            const enabled = await runAsUser(owner.id, getProxyRuntimeSnapshotService)
            expect(enabled.proxyHosts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        advancedConfig: 'add_header X-Disabled yes;',
                    }),
                ]),
            )
        } finally {
            await controller.server.stop(true)
        }
    })

    integrationTest(
        'pending apply persists structurally valid invalid runtime text and changes revision',
        async () => {
            const owner = await createTestUser([SYSTEM_ROLES.OWNER])
            const created = await runAsUser(owner.id, () =>
                createProxyHostService(proxyHostInput('pending-invalid-raw')),
            )
            const controller = startFakeController(true)
            try {
                const before = await runAsUser(owner.id, getProxyRuntimeSnapshotService)
                const state = await runAsUser(owner.id, () =>
                    getProxyHostConfigEditorService(created.id),
                )
                const result = await runAsUser(owner.id, () =>
                    saveProxyHostConfigEditorService({
                        advancedConfig: 'add_header ;',
                        baseRevision: state.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: '',
                    }),
                )
                const after = await runAsUser(owner.id, getProxyRuntimeSnapshotService)
                expect(result.runtimeStatus).toBe('pending')
                expect(after.revision).not.toBe(before.revision)
                expect(after.proxyHosts).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ advancedConfig: 'add_header ;' }),
                    ]),
                )
                expect(controller.applyRevisions).toHaveLength(1)
            } finally {
                await controller.server.stop(true)
            }
        },
    )

    integrationTest('CAS rejects a stale raw-only draft', async () => {
        const owner = await createTestUser([SYSTEM_ROLES.OWNER])
        const created = await runAsUser(owner.id, () =>
            createProxyHostService(proxyHostInput('raw-cas')),
        )
        const controller = startFakeController(false)
        try {
            const first = await runAsUser(owner.id, () =>
                getProxyHostConfigEditorService(created.id),
            )
            const stale = await runAsUser(owner.id, () =>
                getProxyHostConfigEditorService(created.id),
            )
            await runAsUser(owner.id, () =>
                saveProxyHostConfigEditorService({
                    advancedConfig: 'add_header X-First yes;',
                    baseRevision: first.baseRevision,
                    proxyHostId: created.id,
                    settingsSource: '',
                }),
            )
            const error = await captureError(
                runAsUser(owner.id, () =>
                    saveProxyHostConfigEditorService({
                        advancedConfig: 'add_header X-Stale yes;',
                        baseRevision: stale.baseRevision,
                        proxyHostId: created.id,
                        settingsSource: '',
                    }),
                ),
            )
            expect(error).toBeInstanceOf(ProxyConfigEditorError)
            expect((error as ProxyConfigEditorError).code).toBe('configuration_conflict')
            const row = requireFirstRow(
                await getAuthDatabase()
                    .select({ advancedConfig: proxyHosts.advancedConfig })
                    .from(proxyHosts)
                    .where(eq(proxyHosts.id, created.id)),
                'CAS test host was not persisted.',
            )
            expect(row.advancedConfig).toBe('add_header X-First yes;')
        } finally {
            await controller.server.stop(true)
        }
    })
})
