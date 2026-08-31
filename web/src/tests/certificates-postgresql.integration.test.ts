import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'
import { eq, inArray, like, notLike, sql } from 'drizzle-orm'
import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../config/permissions.config'
import {
    certificateDomains,
    certificates,
    permissions,
    proxyHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import { certificateCoversDomains } from '../features/Admin/CertificateManagement/Helpers/certificateValidation'
import {
    deleteCertificateService,
    getAssignableCertificatesService,
    getCertificatesService,
    importCertificateService,
    renewCertificateService,
    replaceCertificateService,
    requestCertificateService,
} from '../server/Admin/CertificateManagement/certificates.service'
import {
    createProxyHostService,
    disableProxyHostService,
    updateProxyHostService,
} from '../server/Admin/ProxyHostManagement/proxy-hosts.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getProxyRuntimeSnapshotService } from '../server/ProxyRuntime/proxy-runtime.service'
import {
    resetProxyHostConfigEditorService,
    getProxyHostConfigEditorService,
} from '../server/ProxyRuntime/proxy-host-config-editor.service'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const PREFIX = 'certificate-test-'
const DOMAIN = '.certificate-test.invalid'
const EMAIL = '@certificate-test.invalid'
const TOKEN = 'certificate-test-controller-token-0000000000000000'
const originalEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)
let verified = false
let controller: ReturnType<typeof fakeController> | undefined

interface Metadata {
    id: string
    source: 'manual' | 'acme'
    environment: 'staging' | 'production' | null
    domains: string[]
    status: 'valid' | 'pending' | 'failed'
    operation: 'idle' | 'issuing' | 'renewing'
    issuedAt: string | null
    expiresAt: string | null
    issuer: string | null
    fingerprint: string | null
    lastErrorCode: string | null
    updatedAt: string
}

function validMetadata(id: string, domains: string[], overrides: Partial<Metadata> = {}): Metadata {
    return {
        id,
        source: 'manual',
        environment: null,
        domains,
        status: 'valid',
        operation: 'idle',
        issuedAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
        issuer: 'Integration fixture CA',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        lastErrorCode: null,
        updatedAt: new Date().toISOString(),
        ...overrides,
    }
}

function fakeController() {
    const entries = new Map<string, Metadata>()
    const state = {
        importDomains: ['demo.test', 'www.demo.test'],
        fingerprint: 'a',
        requests: 0,
        requiredDomains: [] as string[],
    }
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
            state.requests += 1
            if (request.headers.get('authorization') !== 'Bearer ' + TOKEN)
                return Response.json({ error: 'unauthorized' }, { status: 401 })
            const path = new URL(request.url).pathname
            if (path === '/internal/v1/certificates' && request.method === 'GET')
                return Response.json({ certificates: [...entries.values()] })
            if (path === '/internal/v1/proxy/config' && request.method === 'PUT') {
                const body = (await request.json()) as { revision: string }
                return Response.json({
                    activeRevision: body.revision,
                    status: 'applied',
                    lastApplyAt: null,
                })
            }
            if (path.includes('/proxy/') && path.endsWith('/config/preview')) {
                const body = (await request.json()) as { revision: string }
                return Response.json({ config: '# fixture config', revision: body.revision })
            }
            if (path.includes('/proxy/') && request.method === 'GET') {
                return Response.json({
                    config: '# fixture active',
                    activeRevision: 'sha256:' + 'b'.repeat(64),
                })
            }
            const match =
                /^\/internal\/v1\/certificates\/([a-f0-9-]+)(?:\/(import|issue|renew))?$/u.exec(
                    path,
                )
            if (!match?.[1]) return new Response(null, { status: 404 })
            const id = match[1]
            const action = match[2]
            if (request.method === 'GET') {
                return entries.has(id)
                    ? Response.json(entries.get(id))
                    : Response.json({ error: 'certificate_not_found' }, { status: 404 })
            }
            if (request.method === 'DELETE') {
                entries.delete(id)
                return Response.json({ deleted: true })
            }
            if (action === 'import') {
                const body = (await request.json()) as { requiredDomains: string[] }
                state.requiredDomains = body.requiredDomains
                if (
                    body.requiredDomains.length > 0 &&
                    !certificateCoversDomains(state.importDomains, body.requiredDomains)
                ) {
                    return Response.json({ error: 'domain_mismatch' }, { status: 422 })
                }
                const material = validMetadata(id, [...state.importDomains], {
                    fingerprint: 'sha256:' + state.fingerprint.repeat(64),
                })
                entries.set(id, material)
                return Response.json(material)
            }
            if (action === 'issue') {
                const body = (await request.json()) as {
                    domains: string[]
                    environment: 'staging' | 'production'
                }
                const pending = validMetadata(id, body.domains, {
                    source: 'acme',
                    environment: body.environment,
                    status: 'pending',
                    operation: 'issuing',
                    issuedAt: null,
                    expiresAt: null,
                    issuer: null,
                    fingerprint: null,
                })
                entries.set(id, pending)
                return Response.json(pending, { status: 202 })
            }
            const current = entries.get(id)
            if (!current) return Response.json({ error: 'certificate_not_found' }, { status: 404 })
            const renewing = { ...current, operation: 'renewing' as const }
            entries.set(id, renewing)
            return Response.json(renewing, { status: 202 })
        },
    })
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:' + server.port
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = TOKEN
    return { entries, state, server }
}

async function createUser(roleKeys: readonly string[]) {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'Certificate integration',
                email: randomUUID() + EMAIL,
                status: 'active',
                emailVerifiedAt: new Date(),
                mustChangePassword: false,
            })
            .returning({ id: users.id })
        if (!user) throw new Error('Test user unavailable.')
        const selected = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.key, roleKeys))
        if (selected.length !== roleKeys.length) throw new Error('Test roles unavailable.')
        await transaction
            .insert(userRoles)
            .values(selected.map((role) => ({ userId: user.id, roleId: role.id })))
        return user.id
    })
}

async function createCustomUser(keys: readonly PermissionKey[]) {
    const key = PREFIX + randomUUID()
    await getAuthDatabase().transaction(async (transaction) => {
        const [role] = await transaction
            .insert(roles)
            .values({ key, name: 'Certificate integration role' })
            .returning({ id: roles.id })
        if (!role) throw new Error('Test role unavailable.')
        const selected = await transaction
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, [...new Set([PERMISSIONS.APP_ACCESS, ...keys])]))
        await transaction
            .insert(rolePermissions)
            .values(
                selected.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
            )
    })
    return createUser([key])
}

async function asUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const session = await createSessionService(userId)
    let value: T | undefined
    let failed = false
    let failure: unknown
    const handler = requestHandler(async () => {
        try {
            value = await operation()
        } catch (error) {
            failed = true
            failure = error
        }
        return new Response(null, { status: failed ? 500 : 204 })
    })
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: SESSION_COOKIE_NAME + '=' + session.token },
        }),
        {},
    )
    if (failed) throw failure
    return value as T
}

function importInput() {
    // Only this DB/transport double uses sentinels; Rust and the real smoke validate real PEM.
    return {
        name: PREFIX + randomUUID(),
        certificatePem: 'fixture-certificate',
        privateKeyPem: 'fixture-private-key',
        chainPem: '',
    }
}

function hostInput(certificateId: string | null = null, forceHttps = false) {
    return {
        domains: ['demo.test', 'www.demo.test'],
        forwardScheme: 'http' as const,
        forwardHost: 'backend' + DOMAIN,
        forwardPort: 8080,
        enabled: true,
        certificateId,
        forceHttps,
    }
}

async function cleanup() {
    const database = getAuthDatabase()
    await database.delete(proxyHosts).where(like(proxyHosts.forwardHost, '%' + DOMAIN))
    await database.delete(certificates).where(like(certificates.name, PREFIX + '%'))
    await database.delete(users).where(like(users.email, '%' + EMAIL))
    await database.delete(roles).where(like(roles.key, PREFIX + '%'))
}

beforeAll(async () => {
    if (!enabled) return
    const databaseName = new URL(getDatabaseUrl()!).pathname.slice(1)
    if (!/(?:^|[_-])(?:test|integration)(?:[_-]|$)/u.test(databaseName)) {
        throw new Error('Certificate integrations require an explicitly named test database.')
    }
    process.env.RENTNERPROXY_CONTROLLER_URL = ''
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
    const database = getAuthDatabase()
    const otherUsers = await database
        .select({ id: users.id })
        .from(users)
        .where(notLike(users.email, '%' + EMAIL))
        .limit(1)
    const otherHosts = await database
        .select({ id: proxyHosts.id })
        .from(proxyHosts)
        .where(notLike(proxyHosts.forwardHost, '%' + DOMAIN))
        .limit(1)
    const otherCertificates = await database
        .select({ id: certificates.id })
        .from(certificates)
        .where(notLike(certificates.name, PREFIX + '%'))
        .limit(1)
    if (otherUsers.length || otherHosts.length || otherCertificates.length)
        throw new Error('Non-test data found; refusing certificate integration mutations.')
    verified = true
    await cleanup()
    await database.transaction(ensureAuthorizationRegistryInTransaction)
})

beforeEach(async () => {
    if (!verified) return
    process.env.RENTNERPROXY_CONTROLLER_URL = ''
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
    await cleanup()
    controller = fakeController()
})

afterEach(async () => {
    if (verified) {
        controller?.server.stop(true)
        controller = undefined
        await cleanup()
    }
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('certificate management with PostgreSQL', () => {
    integrationTest(
        'imports metadata using UUIDv7 and relational domains without storing PEM or keys',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const id = await asUser(owner, () => importCertificateService(importInput()))
            expect(id[14]).toBe('7')
            const rows = await getAuthDatabase()
                .select()
                .from(certificates)
                .where(eq(certificates.id, id))
            const domains = await getAuthDatabase()
                .select()
                .from(certificateDomains)
                .where(eq(certificateDomains.certificateId, id))
            expect(domains.map((entry) => entry.domain).toSorted()).toEqual([
                'demo.test',
                'www.demo.test',
            ])
            expect(JSON.stringify(rows)).not.toContain('fixture-private-key')
            const columns = await getAuthDatabase().execute(
                sql.raw(
                    "select column_name from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates'",
                ),
            )
            expect(JSON.stringify(columns).toLowerCase()).not.toMatch(
                /private_key|certificate_pem|chain_pem/u,
            )
            expect((await asUser(owner, getCertificatesService))[0]).toMatchObject({
                id,
                source: 'manual',
                status: 'valid',
                environment: null,
                assignedHostCount: 0,
            })
        },
    )

    integrationTest(
        'allows certificates to share domains but prevents duplicate domains within one certificate',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const first = await asUser(owner, () => importCertificateService(importInput()))
            const second = await asUser(owner, () => importCertificateService(importInput()))
            expect(first).not.toBe(second)
            await expect(
                getAuthDatabase()
                    .insert(certificateDomains)
                    .values({ certificateId: first, domain: 'demo.test' })
                    .execute(),
            ).rejects.toThrow()
        },
    )

    integrationTest(
        'assigns a usable certificate, preserves omitted TLS fields, and includes the v4 snapshot',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const id = await asUser(owner, () => importCertificateService(importInput()))
            const host = await asUser(owner, () => createProxyHostService(hostInput(id, true)))
            expect(host).toMatchObject({
                certificateId: id,
                forceHttps: true,
                runtimeStatus: 'applied',
            })
            const updated = await asUser(owner, () =>
                updateProxyHostService({
                    proxyHostId: host.id,
                    domains: host.domains,
                    enabled: true,
                    forwardScheme: 'http',
                    forwardHost: 'other' + DOMAIN,
                    forwardPort: 9000,
                }),
            )
            expect(updated).toMatchObject({ certificateId: id, forceHttps: true })
            const snapshot = await getProxyRuntimeSnapshotService()
            expect(snapshot.version).toBe(4)
            expect(snapshot.proxyHosts[0]).toMatchObject({ certificateId: id, forceHttps: true })
            const editor = await asUser(owner, () => getProxyHostConfigEditorService(host.id))
            await asUser(owner, () =>
                resetProxyHostConfigEditorService({
                    proxyHostId: host.id,
                    baseRevision: editor.baseRevision,
                }),
            )
            expect(
                (
                    await getAuthDatabase()
                        .select()
                        .from(proxyHosts)
                        .where(eq(proxyHosts.id, host.id))
                )[0],
            ).toMatchObject({ certificateId: id, forceHttps: true })
        },
    )

    integrationTest(
        'rejects force HTTPS without a certificate and incomplete domain coverage',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            await expect(
                asUser(owner, () => createProxyHostService(hostInput(null, true))),
            ).rejects.toMatchObject({ code: 'invalid_input' })
            controller!.state.importDomains = ['demo.test']
            const id = await asUser(owner, () => importCertificateService(importInput()))
            await expect(
                asUser(owner, () => createProxyHostService(hostInput(id))),
            ).rejects.toMatchObject({ code: 'domain_mismatch' })
            await expect(
                getAuthDatabase()
                    .insert(proxyHosts)
                    .values({
                        forwardScheme: 'http',
                        forwardHost: 'backend' + DOMAIN,
                        forwardPort: 8080,
                        forceHttps: true,
                    })
                    .execute(),
            ).rejects.toThrow()
        },
    )

    integrationTest('rejects expired material before assigning it to a proxy host', async () => {
        const owner = await createUser([SYSTEM_ROLES.OWNER])
        const id = await asUser(owner, () => importCertificateService(importInput()))
        controller!.entries.set(
            id,
            validMetadata(id, ['demo.test', 'www.demo.test'], {
                issuedAt: '2025-01-01T00:00:00Z',
                expiresAt: '2025-02-01T00:00:00Z',
            }),
        )
        await expect(
            asUser(owner, () => createProxyHostService(hostInput(id))),
        ).rejects.toMatchObject({ code: 'certificate_expired' })
        expect((await asUser(owner, getCertificatesService))[0]?.status).toBe('expired')
    })

    integrationTest(
        'prevents deleting assigned certificates in service and FK, even on disabled hosts',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const id = await asUser(owner, () => importCertificateService(importInput()))
            const host = await asUser(owner, () => createProxyHostService(hostInput(id)))
            await expect(asUser(owner, () => deleteCertificateService(id))).rejects.toMatchObject({
                code: 'certificate_in_use',
            })
            await expect(
                getAuthDatabase().delete(certificates).where(eq(certificates.id, id)).execute(),
            ).rejects.toThrow()
            await asUser(owner, () => disableProxyHostService(host.id))
            await expect(asUser(owner, () => deleteCertificateService(id))).rejects.toMatchObject({
                code: 'certificate_in_use',
            })
        },
    )

    integrationTest(
        'checks replacement coverage for every assigned domain and retains old valid metadata on failure',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const input = importInput()
            const id = await asUser(owner, () => importCertificateService(input))
            await asUser(owner, () => createProxyHostService(hostInput(id)))
            controller!.state.importDomains = ['demo.test']
            await expect(
                asUser(owner, () => replaceCertificateService({ ...input, certificateId: id })),
            ).rejects.toMatchObject({ code: 'domain_mismatch' })
            expect(controller!.state.requiredDomains).toEqual(['demo.test', 'www.demo.test'])
            expect((await asUser(owner, getCertificatesService))[0]).toMatchObject({
                status: 'valid',
                fingerprint: 'sha256:' + 'a'.repeat(64),
            })
            controller!.state.importDomains = ['demo.test', 'www.demo.test']
            controller!.state.fingerprint = 'b'
            await asUser(owner, () => replaceCertificateService({ ...input, certificateId: id }))
            expect((await asUser(owner, getCertificatesService))[0]?.fingerprint).toBe(
                'sha256:' + 'b'.repeat(64),
            )
        },
    )

    integrationTest(
        'recovers metadata for missing remote material and can retry an unused deletion',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const id = await asUser(owner, () => importCertificateService(importInput()))
            controller!.entries.delete(id)
            expect((await asUser(owner, getCertificatesService))[0]).toMatchObject({
                status: 'failed',
                lastErrorCode: 'certificate_not_found',
            })
            await asUser(owner, () => deleteCertificateService(id))
            expect(
                await getAuthDatabase().select().from(certificates).where(eq(certificates.id, id)),
            ).toHaveLength(0)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(certificateDomains)
                    .where(eq(certificateDomains.certificateId, id)),
            ).toHaveLength(0)
        },
    )

    integrationTest(
        'persists ACME desired state, synchronizes issuance and exposes renewal failure without expiring the old certificate',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const id = await asUser(owner, () =>
                requestCertificateService({
                    name: PREFIX + randomUUID(),
                    domains: ['www.example.com'],
                    acceptTerms: true,
                }),
            )
            expect((await asUser(owner, getCertificatesService))[0]).toMatchObject({
                source: 'acme',
                environment: 'staging',
                status: 'pending',
                operation: 'issuing',
            })
            controller!.entries.set(
                id,
                validMetadata(id, ['www.example.com'], { source: 'acme', environment: 'staging' }),
            )
            expect((await asUser(owner, getCertificatesService))[0]?.status).toBe('valid')
            await asUser(owner, () => renewCertificateService(id))
            expect((await asUser(owner, getCertificatesService))[0]?.operation).toBe('renewing')
            controller!.entries.set(id, {
                ...controller!.entries.get(id)!,
                operation: 'idle',
                lastErrorCode: 'acme_failed',
            })
            expect((await asUser(owner, getCertificatesService))[0]).toMatchObject({
                status: 'valid',
                operation: 'idle',
                lastErrorCode: 'acme_failed',
            })
        },
    )

    integrationTest(
        'grants admin management, viewer metadata only, and checks permissions before transporting PEM or issuing',
        async () => {
            const admin = await createUser([SYSTEM_ROLES.ADMIN])
            const viewer = await createUser([SYSTEM_ROLES.VIEWER])
            const id = await asUser(admin, () => importCertificateService(importInput()))
            expect(await asUser(viewer, getCertificatesService)).toHaveLength(1)
            const before = controller!.state.requests
            await expect(
                asUser(viewer, () => importCertificateService(importInput())),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            await expect(
                asUser(viewer, () =>
                    requestCertificateService({
                        name: PREFIX + randomUUID(),
                        domains: ['www.example.com'],
                        acceptTerms: true,
                    }),
                ),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            await expect(
                asUser(viewer, () =>
                    replaceCertificateService({ ...importInput(), certificateId: id }),
                ),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            await expect(asUser(viewer, () => deleteCertificateService(id))).rejects.toMatchObject({
                code: 'permission_denied',
            })
            await expect(asUser(viewer, () => renewCertificateService(id))).rejects.toMatchObject({
                code: 'permission_denied',
            })
            expect(controller!.state.requests).toBe(before)
            await asUser(admin, () => deleteCertificateService(id))
        },
    )

    integrationTest(
        'keeps custom certificate permissions explicit while assignment uses existing proxy update permission',
        async () => {
            const owner = await createUser([SYSTEM_ROLES.OWNER])
            const viewer = await createCustomUser([PERMISSIONS.CERTIFICATES_VIEW])
            const editor = await createCustomUser([
                PERMISSIONS.PROXY_HOSTS_VIEW,
                PERMISSIONS.PROXY_HOSTS_UPDATE,
            ])
            const id = await asUser(owner, () => importCertificateService(importInput()))
            const host = await asUser(owner, () => createProxyHostService(hostInput()))
            expect(await asUser(viewer, getCertificatesService)).toHaveLength(1)
            await expect(
                asUser(viewer, () => importCertificateService(importInput())),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            await expect(asUser(editor, getCertificatesService)).rejects.toMatchObject({
                code: 'permission_denied',
            })
            expect(await asUser(editor, getAssignableCertificatesService)).toHaveLength(1)
            expect(
                (
                    await asUser(editor, () =>
                        updateProxyHostService({ ...hostInput(id, true), proxyHostId: host.id }),
                    )
                ).certificateId,
            ).toBe(id)
        },
    )
})
