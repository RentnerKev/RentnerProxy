import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { requestHandler } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'
import { SESSION_COOKIE_NAME } from '../web/src/config/auth.config'
import {
    certificateJobs,
    certificates,
    proxyHosts,
    roles,
    userRoles,
    users,
} from '../web/src/db/schema'
import { getAuthDatabase } from '../web/src/server/Auth/Core/database.server'
import { createSessionService } from '../web/src/server/Auth/Access/sessions.service'
import { createProxyHostWithCertificateService } from '../web/src/server/Admin/ProxyHostManagement/certificate-jobs.service'
import { runCertificateJobsOnce } from '../web/src/server/Admin/ProxyHostManagement/certificate-jobs.worker.server'

const stateFile = process.env.RENTNERPROXY_JOB_SMOKE_STATE_FILE
assert.ok(stateFile)
const database = getAuthDatabase()

async function prepare(): Promise<void> {
    const [ownerRole] = await database.select().from(roles).where(eq(roles.key, 'owner'))
    assert.ok(ownerRole)
    const [user] = await database
        .insert(users)
        .values({
            displayName: 'Certificate job fixture',
            email: 'job-fixture@example.com',
            emailVerifiedAt: new Date(),
            status: 'active',
        })
        .returning()
    assert.ok(user)
    await database.insert(userRoles).values({ userId: user.id, roleId: ownerRole.id })
    const session = await createSessionService(user.id)
    const input = {
        idempotencyKey: randomUUID(),
        host: {
            domains: ['certificate-job.example.com'],
            forwardScheme: 'http' as const,
            forwardHost: 'host.docker.internal',
            forwardPort: Number(process.env.RENTNERPROXY_JOB_SMOKE_BACKEND_PORT),
            enabled: true,
            forceHttps: true,
        },
        request: {
            name: 'Durable smoke certificate',
            environment: 'staging' as const,
            challengeType: 'http-01' as const,
            acceptTerms: true as const,
        },
    }
    let failure: unknown
    let jobId = ''
    const handler = requestHandler(async () => {
        try {
            const first = await createProxyHostWithCertificateService(input)
            const replay = await createProxyHostWithCertificateService(input)
            assert.equal(first.id, replay.id)
            assert.equal(first.certificateId, replay.certificateId)
            jobId = first.id
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
    assert.ok(jobId)
    const [host] = await database.select().from(proxyHosts)
    assert.ok(host)
    assert.equal(host.enabled, false)
    assert.equal(host.forceHttps, false)
    assert.equal(host.certificateId, null)
    await writeFile(stateFile!, jobId, { mode: 0o600 })
}

try {
    if (process.argv[2] === 'prepare') await prepare()
    if (process.argv[2] === 'tick') await runCertificateJobsOnce()
    const id = (await readFile(stateFile, 'utf8')).trim()
    const [job] = await database.select().from(certificateJobs).where(eq(certificateJobs.id, id))
    assert.ok(job)
    assert.equal((await database.select({ id: certificates.id }).from(certificates)).length, 1)
    if (job.stage === 'applied') {
        const [host] = await database
            .select()
            .from(proxyHosts)
            .where(eq(proxyHosts.id, job.proxyHostId!))
        assert.equal(host?.certificateId, job.certificateId)
        assert.equal(host?.enabled, true)
        assert.equal(host?.forceHttps, true)
        assert.equal(job.requestCiphertext, null)
        assert.equal(job.requestIv, null)
    }
    console.log(
        JSON.stringify({
            id: job.id,
            certificateId: job.certificateId,
            stage: job.stage,
            error: job.lastErrorCode,
        }),
    )
} finally {
    await database.$client.close()
}
