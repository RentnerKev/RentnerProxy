import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, inArray, like, or } from 'drizzle-orm'

import { PERMISSIONS, SYSTEM_ROLES } from '../config/permissions.config'
import {
    certificateDomains,
    certificateJobs,
    certificates,
    hostDomains,
    proxyHosts,
    roles,
    userRoles,
    users,
} from '../db/schema'
import type { RequestCertificateInput } from '../features/Admin/CertificateManagement/validation'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { CertificateDomainError } from '../server/Admin/CertificateManagement/certificates.errors'
import { runCertificateJobsOnce } from '../server/Admin/ProxyHostManagement/certificate-jobs.worker.server'
import { readCertificateJobHost } from '../server/Admin/ProxyHostManagement/certificate-jobs.storage.server'
import { encryptSecret } from '../server/Auth/Core/encryption.server'
import { readProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-data'
import type { ProxyRuntimeStatus } from '../shared/Types/proxy-runtime.types'
import type { ControllerCertificateMetadata } from '../server/Foundation/certificates.server'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const HOST_PREFIX = 'certificate-job-worker-backend-'
const CERTIFICATE_PREFIX = 'certificate-job-worker-'
const EMAIL_SUFFIX = '@certificate-job-worker.invalid'

type CertificateJobRow = typeof certificateJobs.$inferSelect
type JobController = {
    get: (certificateId: string) => Promise<ControllerCertificateMetadata>
    issue: (
        certificateId: string,
        input: RequestCertificateInput,
    ) => Promise<ControllerCertificateMetadata>
    renew: (certificateId: string) => Promise<ControllerCertificateMetadata>
}

type FixtureJob = {
    actorId: string
    certificateId: string
    domain: string
    hostId: string
    id: string
}

function validMetadata(
    id: string,
    domains: readonly string[],
    overrides: Partial<ControllerCertificateMetadata> = {},
): ControllerCertificateMetadata {
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
        issuer: 'Certificate job worker fixture',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        lastErrorCode: null,
        updatedAt: new Date(now).toISOString(),
        ...overrides,
    }
}

function createController() {
    const entries = new Map<string, ControllerCertificateMetadata>()
    let failIssueOnce = false
    let getCalls = 0
    let issueCalls = 0
    const get = async (certificateId: string): Promise<ControllerCertificateMetadata> => {
        getCalls += 1
        const metadata = entries.get(certificateId)
        if (!metadata) throw new CertificateDomainError('certificate_not_found')
        return metadata
    }
    const controller: JobController = {
        get,
        issue: async (certificateId, input) => {
            issueCalls += 1
            const metadata = validMetadata(certificateId, input.domains, {
                environment: input.environment ?? 'staging',
            })
            entries.set(certificateId, metadata)
            if (failIssueOnce) {
                failIssueOnce = false
                throw new CertificateDomainError('controller_unavailable')
            }
            return metadata
        },
        renew: get,
    }
    return {
        controller,
        entries,
        getCalls: () => getCalls,
        issueCalls: () => issueCalls,
        setFailIssueOnce: () => {
            failIssueOnce = true
        },
    }
}

function createRuntime() {
    let available = false
    let reconcileCalls = 0
    const reconcile = Object.assign(
        async () => {
            reconcileCalls += 1
            return available ? 'applied' : 'pending'
        },
        {
            checkDrift: async () => {},
            start: () => {},
            stop: async () => {},
        },
    )
    return {
        runtime: {
            reconcile,
            status: async (): Promise<ProxyRuntimeStatus> => {
                if (!available)
                    return {
                        available: false,
                        running: false,
                        activeRevision: null,
                        lastApplyAt: null,
                    }
                const desired = await getAuthDatabase().transaction(
                    (transaction) => readProxyRuntimeSnapshot(transaction),
                    { isolationLevel: 'repeatable read', accessMode: 'read only' },
                )
                return {
                    available: true,
                    running: true,
                    activeRevision: desired.revision,
                    lastApplyAt: null,
                }
            },
        },
        reconcileCalls: () => reconcileCalls,
        setAvailable: (value: boolean) => {
            available = value
        },
    }
}

async function createUser(): Promise<string> {
    return getAuthDatabase().transaction(async (transaction) => {
        const [user] = await transaction
            .insert(users)
            .values({
                displayName: 'Certificate job worker',
                email: randomUUID() + EMAIL_SUFFIX,
                status: 'active',
                emailVerifiedAt: new Date(),
            })
            .returning({ id: users.id })
        const [role] = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        if (!user || !role) throw new Error('Certificate worker fixture user unavailable.')
        await transaction.insert(userRoles).values({ userId: user.id, roleId: role.id })
        return user.id
    })
}

async function createJob(actorId: string): Promise<FixtureJob> {
    const token = randomUUID().replaceAll('-', '')
    const domain = `certificate-job-${token}.com`
    const name = CERTIFICATE_PREFIX + token
    return getAuthDatabase().transaction(async (transaction) => {
        const [host] = await transaction
            .insert(proxyHosts)
            .values({
                forwardScheme: 'http',
                forwardHost: HOST_PREFIX + token + '.internal',
                forwardPort: 8080,
                enabled: false,
                certificateId: null,
                forceHttps: false,
            })
            .returning({ id: proxyHosts.id })
        const [certificate] = await transaction
            .insert(certificates)
            .values({
                name,
                source: 'acme',
                environment: 'staging',
                status: 'pending',
                operation: 'issuing',
                challengeType: 'http-01',
            })
            .returning({ id: certificates.id })
        if (!host || !certificate) throw new Error('Certificate worker fixture unavailable.')
        await transaction.insert(hostDomains).values({ proxyHostId: host.id, domain })
        await transaction
            .insert(certificateDomains)
            .values({ certificateId: certificate.id, domain })
        const hostState = await readCertificateJobHost(transaction, host.id)
        const [job] = await transaction
            .insert(certificateJobs)
            .values({
                actorUserId: actorId,
                proxyHostId: host.id,
                certificateId: certificate.id,
                idempotencyKey: randomUUID(),
                requestDigest: 'a'.repeat(64),
                domains: [domain],
                requiredPermissions: [PERMISSIONS.CERTIFICATES_ISSUE],
                hostRevision: hostState.revision,
                desiredEnabled: true,
                desiredForceHttps: false,
                stage: 'preparing',
                nextAttemptAt: new Date(),
            })
            .returning()
        if (!job) throw new Error('Certificate worker fixture job unavailable.')
        const request: RequestCertificateInput = {
            name,
            domains: [domain],
            environment: 'staging',
            challengeType: 'http-01',
            acceptTerms: true,
        }
        const encrypted = await encryptSecret(
            JSON.stringify(request),
            `certificate-binding-job:${job.id}`,
        )
        await transaction
            .update(certificateJobs)
            .set({ requestCiphertext: encrypted.ciphertext, requestIv: encrypted.iv })
            .where(eq(certificateJobs.id, job.id))
        return { actorId, certificateId: certificate.id, domain, hostId: host.id, id: job.id }
    })
}

async function readJob(id: string): Promise<CertificateJobRow> {
    const [job] = await getAuthDatabase()
        .select()
        .from(certificateJobs)
        .where(eq(certificateJobs.id, id))
    if (!job) throw new Error('Certificate worker fixture job missing.')
    return job
}

async function readHost(id: string) {
    const [host] = await getAuthDatabase()
        .select({ certificateId: proxyHosts.certificateId, enabled: proxyHosts.enabled })
        .from(proxyHosts)
        .where(eq(proxyHosts.id, id))
    return host ?? null
}

async function makeDue(id: string, expiredLease = false): Promise<void> {
    const now = Date.now()
    await getAuthDatabase()
        .update(certificateJobs)
        .set({
            nextAttemptAt: new Date(now - 1_000),
            leaseToken: expiredLease ? randomUUID() : null,
            leaseExpiresAt: expiredLease ? new Date(now - 1_000) : null,
        })
        .where(eq(certificateJobs.id, id))
}

async function cleanupFixture(): Promise<void> {
    const database = getAuthDatabase()
    const [hostRows, certificateRows, userRows] = await Promise.all([
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
    ])
    const hostIds = hostRows.map((row) => row.id)
    const certificateIds = certificateRows.map((row) => row.id)
    const userIds = userRows.map((row) => row.id)
    const jobConditions = [
        ...(hostIds.length ? [inArray(certificateJobs.proxyHostId, hostIds)] : []),
        ...(certificateIds.length ? [inArray(certificateJobs.certificateId, certificateIds)] : []),
    ]
    if (jobConditions.length) await database.delete(certificateJobs).where(or(...jobConditions))
    if (hostIds.length) await database.delete(proxyHosts).where(inArray(proxyHosts.id, hostIds))
    if (certificateIds.length)
        await database.delete(certificates).where(inArray(certificates.id, certificateIds))
    if (userIds.length) await database.delete(users).where(inArray(users.id, userIds))
}

beforeAll(async () => {
    if (!enabled) return
    await cleanupFixture()
    await getAuthDatabase().transaction(ensureAuthorizationRegistryInTransaction)
})

beforeEach(async () => {
    if (enabled) await cleanupFixture()
})

afterEach(async () => {
    if (enabled) await cleanupFixture()
})

describe('certificate job worker with PostgreSQL', () => {
    integrationTest('does not issue twice after a lost issue response', async () => {
        const actorId = await createUser()
        const fixture = await createJob(actorId)
        const controller = createController()
        const runtime = createRuntime()
        controller.setFailIssueOnce()
        runtime.setAvailable(true)
        await makeDue(fixture.id)

        await runCertificateJobsOnce(controller.controller, runtime.runtime)
        expect(controller.issueCalls()).toBe(1)
        expect((await readJob(fixture.id)).stage).toBe('issuing')

        await makeDue(fixture.id)
        await runCertificateJobsOnce(controller.controller, runtime.runtime)
        expect(controller.issueCalls()).toBe(1)
        expect((await readJob(fixture.id)).stage).toBe('applied')
        expect(await readHost(fixture.hostId)).toMatchObject({
            certificateId: fixture.certificateId,
            enabled: true,
        })
    })

    integrationTest('recovers an expired lease and confirms automatic assignment', async () => {
        const actorId = await createUser()
        const fixture = await createJob(actorId)
        const controller = createController()
        const runtime = createRuntime()
        controller.entries.set(
            fixture.certificateId,
            validMetadata(fixture.certificateId, [fixture.domain]),
        )
        runtime.setAvailable(true)
        await makeDue(fixture.id, true)

        await runCertificateJobsOnce(controller.controller, runtime.runtime)
        const job = await readJob(fixture.id)
        expect(job.stage).toBe('applied')
        expect(job.attemptCount).toBe(1)
        expect(controller.issueCalls()).toBe(0)
        expect(runtime.reconcileCalls()).toBeGreaterThan(0)
        expect(await readHost(fixture.hostId)).toMatchObject({
            certificateId: fixture.certificateId,
            enabled: true,
        })
    })

    integrationTest(
        'moves changed, deleted, and unauthorized jobs to needs_attention',
        async () => {
            const edited = await createJob(await createUser())
            const deleted = await createJob(await createUser())
            const revoked = await createJob(await createUser())
            const database = getAuthDatabase()
            await database
                .update(proxyHosts)
                .set({
                    forwardHost: `${HOST_PREFIX}changed-${randomUUID()}.internal`,
                    updatedAt: new Date(),
                })
                .where(eq(proxyHosts.id, edited.hostId))
            await database.delete(proxyHosts).where(eq(proxyHosts.id, deleted.hostId))
            await database.delete(userRoles).where(eq(userRoles.userId, revoked.actorId))
            await Promise.all([makeDue(edited.id), makeDue(deleted.id), makeDue(revoked.id)])

            await runCertificateJobsOnce(createController().controller, createRuntime().runtime)
            const [editedJob, deletedJob, revokedJob] = await Promise.all([
                readJob(edited.id),
                readJob(deleted.id),
                readJob(revoked.id),
            ])
            expect(editedJob).toMatchObject({
                stage: 'needs_attention',
                lastErrorCode: 'host_changed',
            })
            expect(deletedJob).toMatchObject({
                stage: 'needs_attention',
                lastErrorCode: 'host_deleted',
                proxyHostId: null,
            })
            expect(revokedJob).toMatchObject({
                stage: 'needs_attention',
                lastErrorCode: 'permission_revoked',
            })
            expect(await readHost(edited.hostId)).toMatchObject({ certificateId: null })
            expect(await readHost(revoked.hostId)).toMatchObject({ certificateId: null })
        },
    )

    integrationTest(
        'keeps applying jobs retryable after runtime failure without a new order',
        async () => {
            const actorId = await createUser()
            const fixture = await createJob(actorId)
            const controller = createController()
            const runtime = createRuntime()
            controller.entries.set(
                fixture.certificateId,
                validMetadata(fixture.certificateId, [fixture.domain]),
            )
            await makeDue(fixture.id)

            await runCertificateJobsOnce(controller.controller, runtime.runtime)
            expect(await readJob(fixture.id)).toMatchObject({
                stage: 'applying',
                lastErrorCode: 'runtime_apply_failed',
            })
            expect(await readHost(fixture.hostId)).toMatchObject({
                certificateId: fixture.certificateId,
                enabled: true,
            })
            expect(controller.issueCalls()).toBe(0)

            runtime.setAvailable(true)
            await makeDue(fixture.id)
            await runCertificateJobsOnce(controller.controller, runtime.runtime)
            expect(await readJob(fixture.id)).toMatchObject({
                stage: 'applied',
                lastErrorCode: null,
            })
            expect(controller.issueCalls()).toBe(0)
            expect(controller.getCalls()).toBe(2)
        },
    )
})
