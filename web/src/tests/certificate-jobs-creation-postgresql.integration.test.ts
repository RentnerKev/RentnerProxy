import { randomUUID } from 'node:crypto'

import { requestHandler } from '@tanstack/react-start/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray, like, or } from 'drizzle-orm'

import { SESSION_COOKIE_NAME } from '../config/auth.config'
import { PERMISSIONS, SYSTEM_ROLES } from '../config/permissions.config'
import {
    auditEvents,
    certificateDomains,
    certificateJobs,
    certificates,
    hostDomains,
    permissions,
    proxyHosts,
    rolePermissions,
    roles,
    userRoles,
    users,
} from '../db/schema'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { createSessionService } from '../server/Auth/Access/sessions.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import {
    createProxyHostWithCertificateService,
    retryCertificateJobService,
    requestProxyHostCertificateService,
    updateProxyHostWithCertificateService,
} from '../server/Admin/ProxyHostManagement/certificate-jobs.service'
import type { ControllerCertificateMetadata } from '../server/Foundation/certificates.server'
import { getAppEncryptionKey, getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const HOST_PREFIX = 'certificate-job-service-host-'
const CERTIFICATE_PREFIX = 'certificate-job-service-certificate-'
const EMAIL_SUFFIX = '@certificate-job-service.invalid'
const ROLE_PREFIX = 'certificate-job-service-role-'
const CONTROLLER_TOKEN = 'certificate-job-service-controller-token-000000'
const originalEnvironment = new Map(
    ['APP_ENCRYPTION_KEY', 'RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)

let verified = false
let controllerServer: ReturnType<typeof Bun.serve> | undefined
let controllerAvailable = true
const controllerEntries = new Map<string, ControllerCertificateMetadata>()

function validMetadata(id: string, domains: readonly string[]): ControllerCertificateMetadata {
    const now = Date.now()
    return {
        id,
        source: 'acme',
        environment: 'staging',
        domains: [...domains],
        status: 'valid',
        operation: 'idle',
        issuedAt: new Date(now - 3_600_000).toISOString(),
        expiresAt: new Date(now + 86_400_000).toISOString(),
        issuer: 'Certificate job service fixture',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        candidate: null,
        dnsCleanupPending: false,
        lastErrorCode: null,
        updatedAt: new Date(now).toISOString(),
    }
}

function startController(): void {
    controllerServer = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            if (request.headers.get('authorization') !== `Bearer ${CONTROLLER_TOKEN}`)
                return Response.json({ error: 'unauthorized' }, { status: 401 })
            if (!controllerAvailable)
                return Response.json({ error: 'controller_unavailable' }, { status: 503 })
            const match = /^\/internal\/v1\/certificates\/([a-f0-9-]+)$/u.exec(
                new URL(request.url).pathname,
            )
            if (!match?.[1] || request.method !== 'GET') return new Response(null, { status: 404 })
            const entry = controllerEntries.get(match[1])
            return entry
                ? Response.json(entry)
                : Response.json({ error: 'certificate_not_found' }, { status: 404 })
        },
    })
    process.env.RENTNERPROXY_CONTROLLER_URL = `http://127.0.0.1:${controllerServer.port}`
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = CONTROLLER_TOKEN
}

function stopController(): void {
    controllerServer?.stop(true)
    controllerServer = undefined
    controllerEntries.clear()
}

function fixtureToken(): string {
    return randomUUID().replaceAll('-', '')
}

function certificateRequest(token: string, name = CERTIFICATE_PREFIX + token) {
    return {
        name,
        environment: 'staging' as const,
        challengeType: 'http-01' as const,
        acceptTerms: true as const,
    }
}

function createInput(token: string, domains: readonly string[], idempotencyKey = randomUUID()) {
    return {
        idempotencyKey,
        host: {
            domains: [...domains],
            forwardScheme: 'http' as const,
            forwardHost: HOST_PREFIX + token + '.internal',
            forwardPort: 8_080,
            enabled: true,
            forceHttps: false,
        },
        request: certificateRequest(token),
    }
}

function updateInput(
    token: string,
    proxyHostId: string,
    domains: readonly string[],
    idempotencyKey = randomUUID(),
) {
    return {
        idempotencyKey,
        host: {
            proxyHostId,
            domains: [...domains],
            forwardScheme: 'http' as const,
            forwardHost: HOST_PREFIX + token + '.internal',
            forwardPort: 8_080,
            enabled: true,
            forceHttps: false,
        },
        request: certificateRequest(token),
    }
}

async function asUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
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
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
        }),
        {},
    )
    if (failure) throw failure
    return result as T
}

async function createOwner(): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'Certificate job service owner',
                email: randomUUID() + EMAIL_SUFFIX,
                status: 'active',
                emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id })
        const [role] = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        if (!user || !role) throw new Error('Certificate job service owner fixture unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        return user.id
    })
}

async function createIssueOnlyUser(): Promise<string> {
    const roleKey = ROLE_PREFIX + fixtureToken()
    return getAuthDatabase().transaction(async (transaction) => {
        const [role] = await transaction
            .insert(roles)
            .values({ key: roleKey, name: 'Certificate job service issue role' })
            .returning({ id: roles.id })
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'Certificate job service issue user',
                email: randomUUID() + EMAIL_SUFFIX,
                status: 'active',
                emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id })
        const permissionRows = await transaction
            .select({ id: permissions.id })
            .from(permissions)
            .where(
                inArray(permissions.key, [PERMISSIONS.APP_ACCESS, PERMISSIONS.CERTIFICATES_ISSUE]),
            )
        if (!role || !user || permissionRows.length !== 2)
            throw new Error('Certificate job service permission fixture unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        await transaction.insert(rolePermissions).values(
            permissionRows.map((permission) => ({
                roleId: role.id,
                permissionId: permission.id,
            })),
        )
        return user.id
    })
}

async function insertCertificate(
    token: string,
    domains: readonly string[],
    status: 'pending' | 'valid' = 'pending',
): Promise<string> {
    const [certificate] = await getAuthDatabase()
        .insert(certificates)
        .values({
            name: CERTIFICATE_PREFIX + token,
            source: 'acme',
            environment: 'staging',
            status,
            operation: status === 'valid' ? 'idle' : 'issuing',
            challengeType: 'http-01',
            ...(status === 'valid'
                ? {
                      issuedAt: new Date(Date.now() - 3_600_000),
                      expiresAt: new Date(Date.now() + 86_400_000),
                      issuer: 'Certificate job service fixture',
                      fingerprint: 'sha256:' + 'a'.repeat(64),
                  }
                : {}),
        })
        .returning({ id: certificates.id })
    if (!certificate) throw new Error('Certificate job service certificate fixture unavailable.')
    await getAuthDatabase()
        .insert(certificateDomains)
        .values(domains.toSorted().map((domain) => ({ certificateId: certificate.id, domain })))
    return certificate.id
}

async function insertHost(
    token: string,
    domains: readonly string[],
    options: { certificateId?: string | null; enabled?: boolean; forceHttps?: boolean } = {},
): Promise<{ id: string; updatedAt: Date }> {
    const [host] = await getAuthDatabase()
        .insert(proxyHosts)
        .values({
            forwardScheme: 'http',
            forwardHost: HOST_PREFIX + token + '.internal',
            forwardPort: 8_080,
            enabled: options.enabled ?? true,
            certificateId: options.certificateId ?? null,
            forceHttps: options.forceHttps ?? false,
        })
        .returning({ id: proxyHosts.id, updatedAt: proxyHosts.updatedAt })
    if (!host) throw new Error('Certificate job service host fixture unavailable.')
    await getAuthDatabase()
        .insert(hostDomains)
        .values(domains.toSorted().map((domain) => ({ proxyHostId: host.id, domain })))
    return host
}

async function readHost(id: string) {
    const [host] = await getAuthDatabase()
        .select({
            certificateId: proxyHosts.certificateId,
            enabled: proxyHosts.enabled,
            forceHttps: proxyHosts.forceHttps,
            updatedAt: proxyHosts.updatedAt,
        })
        .from(proxyHosts)
        .where(eq(proxyHosts.id, id))
    return host ?? null
}

async function readJobs(proxyHostId: string) {
    return getAuthDatabase()
        .select()
        .from(certificateJobs)
        .where(eq(certificateJobs.proxyHostId, proxyHostId))
}

async function cleanup(): Promise<void> {
    const database = getAuthDatabase()
    const [hostRows, certificateRows, userRows, roleRows] = await Promise.all([
        database
            .select({ id: proxyHosts.id })
            .from(proxyHosts)
            .where(like(proxyHosts.forwardHost, HOST_PREFIX + '%')),
        database
            .select({ id: certificates.id })
            .from(certificates)
            .where(like(certificates.name, CERTIFICATE_PREFIX + '%')),
        database
            .select({ id: users.id })
            .from(users)
            .where(like(users.email, '%' + EMAIL_SUFFIX)),
        database
            .select({ id: roles.id })
            .from(roles)
            .where(like(roles.key, ROLE_PREFIX + '%')),
    ])
    const hostIds = hostRows.map((row) => row.id)
    const certificateIds = certificateRows.map((row) => row.id)
    const userIds = userRows.map((row) => row.id)
    const conditions = [
        ...(hostIds.length ? [inArray(auditEvents.targetId, hostIds)] : []),
        ...(certificateIds.length ? [inArray(auditEvents.targetId, certificateIds)] : []),
        ...(userIds.length ? [inArray(auditEvents.actorUserId, userIds)] : []),
    ]
    if (conditions.length) await database.delete(auditEvents).where(or(...conditions))
    const jobConditions = [
        ...(hostIds.length ? [inArray(certificateJobs.proxyHostId, hostIds)] : []),
        ...(certificateIds.length ? [inArray(certificateJobs.certificateId, certificateIds)] : []),
    ]
    if (jobConditions.length) await database.delete(certificateJobs).where(or(...jobConditions))
    if (hostIds.length) await database.delete(proxyHosts).where(inArray(proxyHosts.id, hostIds))
    if (certificateIds.length)
        await database.delete(certificates).where(inArray(certificates.id, certificateIds))
    if (userIds.length) await database.delete(users).where(inArray(users.id, userIds))
    if (roleRows.length)
        await database.delete(roles).where(
            inArray(
                roles.id,
                roleRows.map((row) => row.id),
            ),
        )
}

beforeAll(async () => {
    if (!enabled) return
    const databaseName = new URL(getDatabaseUrl()!).pathname.slice(1)
    if (!/(?:^|[_-])(?:test|integration)(?:[_-]|$)/u.test(databaseName))
        throw new Error('Certificate job integrations require an explicitly named test database.')
    if (!getAppEncryptionKey())
        process.env.APP_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64')
    await getAuthDatabase().transaction(ensureAuthorizationRegistryInTransaction)
    await cleanup()
    verified = true
})

beforeEach(async () => {
    if (!verified) return
    await cleanup()
    controllerAvailable = true
    startController()
})

afterEach(async () => {
    if (!verified) return
    stopController()
    await cleanup()
})

afterAll(() => {
    stopController()
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('certificate job creation with PostgreSQL', () => {
    integrationTest(
        'atomically creates a sorted certificate job and replays or rejects idempotency keys',
        async () => {
            const owner = await createOwner()
            const token = fixtureToken()
            const domains = [`z-${token}.example.com`, `a-${token}.example.com`]
            const input = createInput(token, domains)
            const first = await asUser(owner, () => createProxyHostWithCertificateService(input))
            const replay = await asUser(owner, () => createProxyHostWithCertificateService(input))
            expect(first.id[14]).toBe('7')
            expect(first.domains).toEqual(domains.toSorted())
            expect(replay).toMatchObject({
                id: first.id,
                proxyHostId: first.proxyHostId,
                certificateId: first.certificateId,
            })
            await expect(
                asUser(owner, () =>
                    createProxyHostWithCertificateService({
                        ...input,
                        request: { ...input.request, name: input.request.name + '-changed' },
                    }),
                ),
            ).rejects.toMatchObject({ code: 'idempotency_conflict' })
            const host = await readHost(first.proxyHostId!)
            const jobs = await readJobs(first.proxyHostId!)
            const certificateRows = await getAuthDatabase()
                .select({ id: certificates.id, status: certificates.status })
                .from(certificates)
                .where(eq(certificates.id, first.certificateId!))
            expect(host).toMatchObject({ certificateId: null, enabled: false, forceHttps: false })
            expect(jobs).toHaveLength(1)
            expect(jobs[0]).toMatchObject({
                id: first.id,
                domains: domains.toSorted(),
                stage: 'preparing',
            })
            expect(jobs[0]?.requestCiphertext).toBeTruthy()
            expect(jobs[0]?.requestIv).toBeTruthy()
            expect(certificateRows).toEqual([{ id: first.certificateId!, status: 'pending' }])
        },
    )

    integrationTest(
        'atomically updates a host with a sorted pending job and replays or rejects the request',
        async () => {
            const owner = await createOwner()
            const token = fixtureToken()
            const domains = [`z-${token}.example.com`, `a-${token}.example.com`]
            const host = await insertHost(token, domains, { enabled: false })
            const input = updateInput(token, host.id, domains)
            const first = await asUser(owner, () => updateProxyHostWithCertificateService(input))
            const replay = await asUser(owner, () => updateProxyHostWithCertificateService(input))
            expect(first.domains).toEqual(domains.toSorted())
            expect(replay).toMatchObject({ id: first.id, certificateId: first.certificateId })
            await expect(
                asUser(owner, () =>
                    updateProxyHostWithCertificateService({
                        ...input,
                        request: { ...input.request, name: input.request.name + '-changed' },
                    }),
                ),
            ).rejects.toMatchObject({ code: 'idempotency_conflict' })
            const savedHost = await readHost(host.id)
            const jobs = await readJobs(host.id)
            expect(savedHost).toMatchObject({
                certificateId: null,
                enabled: false,
                forceHttps: false,
            })
            expect(jobs).toHaveLength(1)
            expect(jobs[0]?.domains).toEqual(domains.toSorted())
            expect(jobs[0]?.desiredEnabled).toBe(true)
        },
    )

    integrationTest('retries an errored active job only after its lease expires', async () => {
        const owner = await createOwner()
        const token = fixtureToken()
        const domains = [`a-${token}.example.com`]
        const created = await asUser(owner, () =>
            createProxyHostWithCertificateService(createInput(token, domains)),
        )
        const operationId = randomUUID()
        await getAuthDatabase()
            .update(certificateJobs)
            .set({
                stage: 'issuing',
                lastErrorCode: 'controller_unavailable',
                controllerOperationId: operationId,
                leaseToken: null,
                leaseExpiresAt: null,
            })
            .where(eq(certificateJobs.id, created.id))
        const retried = await asUser(owner, () => retryCertificateJobService(created.id))
        expect(retried).toMatchObject({ id: created.id, stage: 'preparing', lastErrorCode: null })
        const afterRetry = (await readJobs(created.proxyHostId!))[0]
        expect(afterRetry).toMatchObject({
            controllerOperationId: operationId,
            retryRequested: true,
            leaseToken: null,
            leaseExpiresAt: null,
        })
        await getAuthDatabase()
            .update(certificateJobs)
            .set({
                stage: 'issuing',
                lastErrorCode: 'controller_unavailable',
                leaseToken: randomUUID(),
                leaseExpiresAt: new Date(Date.now() + 60_000),
            })
            .where(eq(certificateJobs.id, created.id))
        await expect(
            asUser(owner, () => retryCertificateJobService(created.id)),
        ).rejects.toMatchObject({ code: 'operation_in_progress' })
    })

    integrationTest(
        'rejects a certificate row action without proxy host update permission',
        async () => {
            const actor = await createIssueOnlyUser()
            const token = fixtureToken()
            const domains = [`a-${token}.example.com`]
            const host = await insertHost(token, domains, { enabled: true })
            await expect(
                asUser(actor, () =>
                    requestProxyHostCertificateService({
                        idempotencyKey: randomUUID(),
                        proxyHostId: host.id,
                        expectedUpdatedAt: host.updatedAt.toISOString(),
                        request: certificateRequest(token),
                    }),
                ),
            ).rejects.toMatchObject({ code: 'permission_denied' })
            expect(await readJobs(host.id)).toHaveLength(0)
            expect(await readHost(host.id)).toMatchObject({ certificateId: null, enabled: true })
        },
    )

    integrationTest(
        'keeps an existing valid certificate assigned while a replacement is pending',
        async () => {
            const owner = await createOwner()
            const token = fixtureToken()
            const domains = [`z-${token}.example.com`, `a-${token}.example.com`]
            const oldCertificateId = await insertCertificate(token + '-old', domains, 'valid')
            const host = await insertHost(token, domains, {
                certificateId: oldCertificateId,
                enabled: true,
            })
            controllerEntries.set(oldCertificateId, validMetadata(oldCertificateId, domains))
            const replacement = await asUser(owner, () =>
                updateProxyHostWithCertificateService(
                    updateInput(token, host.id, domains, randomUUID()),
                ),
            )
            expect(replacement.certificateId).not.toBe(oldCertificateId)
            expect(replacement.domains).toEqual(domains.toSorted())
            expect(await readHost(host.id)).toMatchObject({
                certificateId: oldCertificateId,
                enabled: true,
                forceHttps: false,
            })
            const [oldCertificate] = await getAuthDatabase()
                .select({ status: certificates.status, fingerprint: certificates.fingerprint })
                .from(certificates)
                .where(eq(certificates.id, oldCertificateId))
            const [newCertificate] = await getAuthDatabase()
                .select({ status: certificates.status })
                .from(certificates)
                .where(eq(certificates.id, replacement.certificateId!))
            expect(oldCertificate).toMatchObject({
                status: 'valid',
                fingerprint: 'sha256:' + 'a'.repeat(64),
            })
            expect(newCertificate).toEqual({ status: 'pending' })
        },
    )
})
