import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../config/permissions.config'
import {
    permissions,
    proxyHosts,
    rolePermissions,
    roles,
    trustedCas,
    userRoles,
    users,
} from '../db/schema'
import {
    createTrustedCaService,
    deleteTrustedCaService,
    getTrustedCasService,
    replaceTrustedCaService,
} from '../server/Admin/TrustedCaManagement/trusted-cas.service'
import {
    createProxyHostService,
    updateProxyHostService,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const PREFIX = 'trusted-ca-test-'
const EMAIL = '@trusted-ca-test.invalid'
const TOKEN = 'trusted-ca-test-controller-token-0000000000000000'
const PEM = '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n'
let controller: ReturnType<typeof fakeController> | undefined

function hostInput(label: string) {
    return {
        domains: [randomUUID() + '.invalid'],
        forwardScheme: 'https' as const,
        forwardHost: PREFIX + label + '.invalid',
        forwardPort: 443,
        enabled: true,
    }
}

const originalControllerEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)
let dedicatedDatabaseVerified = false

function fakeController() {
    const revisions: string[] = []
    let validations = 0
    let fingerprint = 'a'
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            if (request.headers.get('authorization') !== 'Bearer ' + TOKEN)
                return Response.json({ error: 'unauthorized' }, { status: 401 })
            const path = new URL(request.url).pathname
            if (path === '/internal/v1/trusted-cas/validate' && request.method === 'POST') {
                validations += 1
                const { pem } = (await request.json()) as { pem: string }
                if (pem.includes('PRIVATE KEY') || pem.length > 256 * 1024)
                    return Response.json({ error: 'invalid_trusted_ca' }, { status: 422 })
                return Response.json({
                    pem: PEM,
                    fingerprintSha256: 'sha256:' + fingerprint.repeat(64),
                    subject: 'CN=Fixture CA',
                    issuer: 'CN=Fixture CA',
                    notBefore: '2025-01-01T00:00:00Z',
                    notAfter: '2035-01-01T00:00:00Z',
                })
            }
            if (path === '/internal/v1/proxy/config' && request.method === 'PUT') {
                const body = (await request.json()) as { revision: string }
                revisions.push(body.revision)
                return Response.json({
                    status: 'applied',
                    activeRevision: body.revision,
                    lastApplyAt: null,
                })
            }
            return new Response(null, { status: 404 })
        },
    })
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:' + server.port
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = TOKEN
    return {
        server,
        revisions,
        validationCount: () => validations,
        setFingerprint: (value: string) => {
            fingerprint = value
        },
    }
}

async function createUser(roleKeys: readonly string[]) {
    return getAuthDatabase().transaction(async (tx) => {
        const [user] = await tx
            .insert(users)
            .values({
                displayName: 'Trusted CA test',
                email: randomUUID() + EMAIL,
                status: 'active',
                emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id })
        if (!user) throw new Error('Test user unavailable.')
        const selected = await tx
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.key, roleKeys))
        await tx
            .insert(userRoles)
            .values(selected.map((role) => ({ userId: user.id, roleId: role.id })))
        return user.id
    })
}

async function customUser(keys: readonly PermissionKey[]) {
    const key = PREFIX + randomUUID()
    await getAuthDatabase().transaction(async (tx) => {
        const [role] = await tx.insert(roles).values({ key, name: key }).returning({ id: roles.id })
        if (!role) throw new Error('Test role unavailable.')
        const selected = await tx
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, [PERMISSIONS.APP_ACCESS, ...keys]))
        await tx
            .insert(rolePermissions)
            .values(
                selected.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
            )
    })
    return createUser([key])
}

async function asUser<T>(userId: string, action: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    let result: T | undefined
    let failure: unknown
    const handler = requestHandler(async () => {
        try {
            result = await action()
        } catch (error) {
            failure = error
        }
        return new Response(null)
    })
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: SESSION_COOKIE_NAME + '=' + session.token },
        }),
        {},
    )
    if (failure) throw failure
    return result as T
}

async function cleanup() {
    const db = getAuthDatabase()
    await db.delete(proxyHosts).where(like(proxyHosts.forwardHost, PREFIX + '%'))
    await db.delete(trustedCas).where(like(trustedCas.name, PREFIX + '%'))
    await db.delete(users).where(like(users.email, '%' + EMAIL))
    await db.delete(roles).where(like(roles.key, PREFIX + '%'))
}

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test')
        throw new Error('Trusted CA integration requires its disposable test database.')
    dedicatedDatabaseVerified = true
    await getAuthDatabase().transaction(ensureAuthorizationRegistryInTransaction)
    await cleanup()
})
beforeEach(async () => {
    if (!enabled) return
    await cleanup()
    controller = fakeController()
})
afterEach(async () => {
    controller?.server.stop(true)
    controller = undefined
    for (const [key, value] of originalControllerEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    if (enabled && dedicatedDatabaseVerified) await cleanup()
})

describe('trusted CAs with PostgreSQL', () => {
    integrationTest(
        'persists controller-canonical bundle and metadata, rejects duplicate, and replaces atomically',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const created = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'root', pem: PEM }),
            )
            const [row] = await getAuthDatabase()
                .select()
                .from(trustedCas)
                .where(eq(trustedCas.id, created.trustedCaId))
            expect(row).toMatchObject({
                pem: PEM,
                subject: 'CN=Fixture CA',
                fingerprintSha256: 'sha256:' + 'a'.repeat(64),
            })
            await expect(
                asUser(owner, () =>
                    createTrustedCaService({ name: PREFIX + 'duplicate', pem: PEM }),
                ),
            ).rejects.toMatchObject({ code: 'trusted_ca_duplicate' })
            controller!.setFingerprint('b')
            await asUser(owner, () =>
                replaceTrustedCaService({
                    trustedCaId: created.trustedCaId,
                    name: PREFIX + 'replaced',
                    pem: PEM,
                }),
            )
            expect(
                (
                    await getAuthDatabase()
                        .select()
                        .from(trustedCas)
                        .where(eq(trustedCas.id, created.trustedCaId))
                )[0]?.fingerprintSha256,
            ).toBe('sha256:' + 'b'.repeat(64))
        },
    )

    integrationTest(
        'rejects invalid, private-key, and oversized input before persistence',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            await Promise.all(
                [
                    'not pem',
                    '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
                    '-----BEGIN CERTIFICATE-----\n' +
                        'a'.repeat(256 * 1024) +
                        '\n-----END CERTIFICATE-----',
                ].map((pem) =>
                    expect(
                        asUser(owner, () =>
                            createTrustedCaService({ name: PREFIX + randomUUID(), pem }),
                        ),
                    ).rejects.toMatchObject({ code: 'invalid_input' }),
                ),
            )
        },
    )

    integrationTest(
        'prevents delete while assigned in service and FK, then deletes unused',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const ca = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'assigned', pem: PEM }),
            )
            await asUser(owner, () =>
                createProxyHostService({
                    domains: [randomUUID() + '.invalid'],
                    forwardScheme: 'https',
                    forwardHost: PREFIX + 'backend.invalid',
                    forwardPort: 443,
                    enabled: true,
                    verifyUpstreamTls: true,
                    upstreamTlsServerName: null,
                    trustedCaId: ca.trustedCaId,
                }),
            )
            await expect(
                asUser(owner, () => deleteTrustedCaService(ca.trustedCaId)),
            ).rejects.toMatchObject({ code: 'trusted_ca_in_use' })
            await expect(
                getAuthDatabase()
                    .delete(trustedCas)
                    .where(eq(trustedCas.id, ca.trustedCaId))
                    .execute(),
            ).rejects.toThrow()
            await getAuthDatabase()
                .update(proxyHosts)
                .set({ trustedCaId: null })
                .where(eq(proxyHosts.trustedCaId, ca.trustedCaId))
            await asUser(owner, () => deleteTrustedCaService(ca.trustedCaId))
            expect(
                await getAuthDatabase()
                    .select()
                    .from(trustedCas)
                    .where(eq(trustedCas.id, ca.trustedCaId)),
            ).toHaveLength(0)
        },
    )

    integrationTest(
        'Owner and Admin manage, Viewer reads only, and custom roles require explicit trusted-CA permissions',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const admin = await createUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createUser([SYSTEM_ROLES.VIEWER])
            const explicit = await customUser([
                PERMISSIONS.TRUSTED_CAS_CREATE,
                PERMISSIONS.TRUSTED_CAS_UPDATE,
                PERMISSIONS.TRUSTED_CAS_DELETE,
            ])
            const ca = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'permissions', pem: PEM }),
            )
            expect(await asUser(viewer, getTrustedCasService)).toHaveLength(1)
            await expect(
                asUser(viewer, () => createTrustedCaService({ name: PREFIX + 'denied', pem: PEM })),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            await asUser(admin, () =>
                replaceTrustedCaService({
                    trustedCaId: ca.trustedCaId,
                    name: PREFIX + 'admin',
                    pem: PEM,
                }),
            )
            await asUser(explicit, () => deleteTrustedCaService(ca.trustedCaId))
        },
    )

    integrationTest(
        'uses secure defaults and preserves an existing explicit opt-out on ordinary updates',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const secure = await asUser(owner, () => createProxyHostService(hostInput('secure')))
            expect(secure).toMatchObject({
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
            })
            const [stored] = await getAuthDatabase()
                .select()
                .from(proxyHosts)
                .where(eq(proxyHosts.id, secure.id))
            expect(stored?.verifyUpstreamTls).toBeTrue()
            const legacy = await asUser(owner, () =>
                createProxyHostService({ ...hostInput('legacy'), verifyUpstreamTls: false }),
            )
            const updated = await asUser(owner, () =>
                updateProxyHostService({
                    ...hostInput('legacy-updated'),
                    domains: legacy.domains,
                    proxyHostId: legacy.id,
                }),
            )
            expect(updated.verifyUpstreamTls).toBeFalse()
        },
    )

    integrationTest(
        'clears HTTPS settings on HTTP and defaults HTTP to HTTPS to verification',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const ca = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'transition', pem: PEM }),
            )
            const input = hostInput('transition')
            const host = await asUser(owner, () =>
                createProxyHostService({
                    ...input,
                    trustedCaId: ca.trustedCaId,
                    upstreamTlsServerName: 'backend.invalid',
                }),
            )
            const http = await asUser(owner, () =>
                updateProxyHostService({
                    ...input,
                    proxyHostId: host.id,
                    forwardScheme: 'http',
                }),
            )
            expect(http).toMatchObject({
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
            })
            const https = await asUser(owner, () =>
                updateProxyHostService({
                    ...input,
                    proxyHostId: host.id,
                }),
            )
            expect(https).toMatchObject({
                verifyUpstreamTls: true,
                upstreamTlsServerName: null,
                trustedCaId: null,
            })
            await asUser(owner, () =>
                updateProxyHostService({ ...input, proxyHostId: host.id, forwardScheme: 'http' }),
            )
            const optOut = await asUser(owner, () =>
                updateProxyHostService({
                    ...input,
                    proxyHostId: host.id,
                    verifyUpstreamTls: false,
                }),
            )
            expect(optOut.verifyUpstreamTls).toBeFalse()
        },
    )

    integrationTest(
        'validates CA assignments and changes desired revision when selected material is replaced',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const ca = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'assignment', pem: PEM }),
            )
            const input = hostInput('assignment')
            await expect(
                asUser(owner, () =>
                    createProxyHostService({
                        ...input,
                        verifyUpstreamTls: false,
                        trustedCaId: ca.trustedCaId,
                    }),
                ),
            ).rejects.toMatchObject({ code: 'invalid_input' })
            const host = await asUser(owner, () =>
                createProxyHostService({ ...input, trustedCaId: ca.trustedCaId }),
            )
            expect(host.trustedCaId).toBe(ca.trustedCaId)
            const firstRevision = controller!.revisions.at(-1)
            controller!.setFingerprint('b')
            await asUser(owner, () =>
                replaceTrustedCaService({
                    trustedCaId: ca.trustedCaId,
                    name: PREFIX + 'replaced-assignment',
                    pem: PEM,
                }),
            )
            expect(controller!.revisions.at(-1)).not.toBe(firstRevision)
            const removed = await asUser(owner, () =>
                updateProxyHostService({
                    ...input,
                    proxyHostId: host.id,
                    trustedCaId: null,
                }),
            )
            expect(removed.trustedCaId).toBeNull()
            expect(removed.verifyUpstreamTls).toBeTrue()
        },
    )

    integrationTest(
        'rejects invalid DNS identities and verified IP targets without a DNS override',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const invalidInputs = [
                { forwardHost: '192.0.2.10' },
                { forwardHost: '2001:db8::10' },
                { upstreamTlsServerName: 'https://backend.invalid' },
                { upstreamTlsServerName: 'backend.invalid:443' },
                { upstreamTlsServerName: '*.backend.invalid' },
                { upstreamTlsServerName: '192.0.2.10' },
                { upstreamTlsServerName: 'backend.invalid; proxy_ssl_verify off;' },
            ]
            await Promise.all(
                invalidInputs.map((invalid) =>
                    expect(
                        asUser(owner, () =>
                            createProxyHostService({ ...hostInput('invalid-name'), ...invalid }),
                        ),
                    ).rejects.toMatchObject({ code: 'invalid_input' }),
                ),
            )
            // The connection uses an IP; only the expected TLS identity is a DNS name.
            const input = hostInput('ip-override')
            const host = await asUser(owner, () =>
                createProxyHostService({
                    ...input,
                    forwardHost: '192.0.2.10',
                    upstreamTlsServerName: ' Backend.Invalid. ',
                }),
            )
            expect(host.upstreamTlsServerName).toBe('backend.invalid')
            await asUser(owner, () =>
                updateProxyHostService({
                    ...input,
                    proxyHostId: host.id,
                    upstreamTlsServerName: null,
                }),
            )
        },
    )

    integrationTest(
        'denies Viewer and unprivileged custom CA mutations before controller transport',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const viewer = await createUser([SYSTEM_ROLES.VIEWER])
            const custom = await customUser([])
            const ca = await asUser(owner, () =>
                createTrustedCaService({ name: PREFIX + 'denied', pem: PEM }),
            )
            const validationsBefore = controller!.validationCount()
            await Promise.all(
                [viewer, custom].flatMap((actor) => [
                    expect(
                        asUser(actor, () =>
                            createTrustedCaService({ name: PREFIX + 'not-saved', pem: PEM }),
                        ),
                    ).rejects.toMatchObject({ code: 'permission_denied' }),
                    expect(
                        asUser(actor, () =>
                            replaceTrustedCaService({
                                trustedCaId: ca.trustedCaId,
                                name: PREFIX + 'not-replaced',
                                pem: PEM,
                            }),
                        ),
                    ).rejects.toMatchObject({ code: 'permission_denied' }),
                    expect(
                        asUser(actor, () => deleteTrustedCaService(ca.trustedCaId)),
                    ).rejects.toMatchObject({ code: 'permission_denied' }),
                ]),
            )
            expect(controller!.validationCount()).toBe(validationsBefore)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(trustedCas)
                    .where(eq(trustedCas.id, ca.trustedCaId)),
            ).toHaveLength(1)
        },
    )

    integrationTest(
        'grants only explicitly assigned custom CA permissions and never exposes PEM in summaries',
        async () => {
            const actor = await customUser([
                PERMISSIONS.TRUSTED_CAS_VIEW,
                PERMISSIONS.TRUSTED_CAS_CREATE,
                PERMISSIONS.TRUSTED_CAS_UPDATE,
                PERMISSIONS.TRUSTED_CAS_DELETE,
            ])
            const ca = await asUser(actor, () =>
                createTrustedCaService({ name: PREFIX + 'custom', pem: PEM }),
            )
            const summaries = await asUser(actor, getTrustedCasService)
            expect(summaries).toHaveLength(1)
            expect(summaries[0]).not.toHaveProperty('pem')
            controller!.setFingerprint('c')
            await asUser(actor, () =>
                replaceTrustedCaService({
                    trustedCaId: ca.trustedCaId,
                    name: PREFIX + 'custom-replaced',
                    pem: PEM,
                }),
            )
            await asUser(actor, () => deleteTrustedCaService(ca.trustedCaId))
            expect(await asUser(actor, getTrustedCasService)).toHaveLength(0)
        },
    )
})
