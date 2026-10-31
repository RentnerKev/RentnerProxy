// oxlint-disable no-await-in-loop -- Isolated appliance probes poll one bounded lifecycle transition at a time.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { chmod, chown, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    managedBackupJobSchema,
    managedBackupStateSchema,
    managedBackupStatusSchema,
} from '../../../../web/src/lib/Backups/validation.ts'
import { verifyPublishedBackup } from '../../../../scripts/backup/publication.ts'

const statePath = '/var/lib/rentnerproxy/backups/jobs.json'
const artifacts = '/var/lib/rentnerproxy/backups/artifacts'
const markerPath = '/var/lib/rentnerproxy/proxy/managed-backup-smoke-marker'
const marker = 'isolated-managed-backup-fixture'
const actorId = '0198d98a-0000-7000-8000-000000000001'
const probeModes = [
    'auth',
    'web-isolation',
    'seed',
    'markers',
    'status',
    'configure',
    'concurrent',
    'start',
    'active',
    'verify',
    'absent',
    'schedule',
] as const

async function call(path: string, method = 'GET', body?: unknown, authorized = true) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (authorized)
        headers.authorization =
            'Bearer ' + (await readFile('/run/rentnerproxy/controller-token/value', 'utf8')).trim()
    const response = await fetch('http://127.0.0.1:8081/internal/v1/backups' + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(6_000),
    })
    return { status: response.status, body: (await response.json()) as unknown }
}

async function status() {
    const response = await call('/status')
    assert.equal(response.status, 200)
    return managedBackupStatusSchema.parse(response.body)
}

async function psql(sql: string) {
    const command = Bun.spawn(
        [
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--set=ON_ERROR_STOP=1',
            '--tuples-only',
            '--no-align',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=rentnerproxy',
            '--command',
            sql,
        ],
        { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
    )
    const [code, output] = await Promise.all([
        command.exited,
        new Response(command.stdout).text(),
        new Response(command.stderr).text(),
    ])
    assert.equal(code, 0)
    return output.trim()
}

async function denied(operation: () => Promise<unknown>) {
    try {
        await operation()
    } catch (error) {
        assert.ok(
            error instanceof Error &&
                'code' in error &&
                ['EACCES', 'EPERM'].includes(String(error.code)),
        )
        return
    }
    throw new Error('private backup resource was accessible')
}

async function run(mode: (typeof probeModes)[number]) {
    if (mode === 'web-isolation') {
        assert.equal(process.getuid?.(), 10002)
        await denied(() => readdir(artifacts))
        await denied(() => readFile(statePath))
        await denied(
            () =>
                new Promise<void>((resolveConnected, reject) => {
                    const socket = createConnection('/run/rentnerproxy/backups/agent.sock')
                    socket.once('connect', () => {
                        socket.destroy()
                        resolveConnected()
                    })
                    socket.once('error', reject)
                    socket.setTimeout(5_000, () => {
                        socket.destroy()
                        reject(new Error('socket timeout'))
                    })
                }),
        )
        return { ok: true }
    }
    assert.equal(process.getuid?.(), 0)
    if (mode === 'auth') {
        for (const [path, method] of [
            ['/status', 'GET'],
            ['/start', 'POST'],
            ['/config', 'PUT'],
        ] as const) {
            const response = await call(path, method, method === 'GET' ? undefined : {}, false)
            assert.ok([401, 403].includes(response.status))
        }
        return { ok: true }
    }
    if (mode === 'seed' || mode === 'markers') {
        if (mode === 'seed') {
            await psql(
                `INSERT INTO rentnerproxy.system_settings(key,value) VALUES ('managed_backup_smoke_marker','{"fixture":"isolated-managed-backup-fixture"}'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
            )
            await writeFile(markerPath, marker, { mode: 0o600 })
            await chown(markerPath, 10001, 10001)
        }
        assert.equal(
            await psql(
                `SELECT count(*) FROM rentnerproxy.system_settings WHERE key='managed_backup_smoke_marker' AND value='{"fixture":"isolated-managed-backup-fixture"}'::jsonb`,
            ),
            '1',
        )
        assert.equal(await readFile(markerPath, 'utf8'), marker)
        return { ok: true }
    }
    if (mode === 'status') return await status()
    if (mode === 'configure') {
        const current = await status()
        const response = await call('/config', 'PUT', {
            requestId: randomUUID(),
            actorId,
            expectedRevision: current.configuration.revision,
            enabled: false,
            intervalHours: 1,
            retentionCount: 1,
        })
        assert.equal(response.status, 200)
        const configuration = managedBackupStatusSchema.parse(response.body).configuration
        assert.equal(configuration.enabled, false)
        assert.equal(configuration.retentionCount, 1)
        return configuration
    }
    if (mode === 'concurrent') {
        const requests = [randomUUID(), randomUUID()].map((requestId) => ({ requestId, actorId }))
        const responses = await Promise.all(
            requests.map((request) => call('/start', 'POST', request)),
        )
        assert.deepEqual(responses.map((response) => response.status).toSorted(), [200, 409])
        const winner = responses.findIndex((response) => response.status === 200)
        const busy = responses.find((response) => response.status === 409)
        assert.deepEqual(busy?.body, { error: 'busy' })
        const job = managedBackupStatusSchema
            .parse(responses[winner]!.body)
            .jobs.find((entry) => entry.requestId === requests[winner]!.requestId)
        assert.ok(job)
        // The supervisor can quiesce HTTP before a replay; recovery unavailability is expected.
        const deadline = Date.now() + 180_000
        while (Date.now() < deadline) {
            try {
                const replay = await call('/start', 'POST', requests[winner])
                assert.equal(replay.status, 200)
                assert.equal(
                    managedBackupStatusSchema
                        .parse(replay.body)
                        .jobs.find((entry) => entry.requestId === job.requestId)?.id,
                    job.id,
                )
                return job
            } catch {
                await Bun.sleep(250)
            }
        }
        throw new Error('idempotent replay unavailable')
    }
    if (mode === 'start') {
        const requestId = randomUUID()
        const response = await call('/start', 'POST', { requestId, actorId })
        assert.equal(response.status, 200)
        const job = managedBackupStatusSchema
            .parse(response.body)
            .jobs.find((entry) => entry.requestId === requestId)
        assert.ok(job)
        return job
    }
    if (mode === 'active') {
        const id = managedBackupJobSchema.shape.id.parse(process.argv[3])
        const deadline = Date.now() + 40_000
        while (Date.now() < deadline) {
            try {
                const value: unknown = JSON.parse(
                    await readFile('/run/rentnerproxy/backups/active.json', 'utf8'),
                )
                assert.deepEqual(value, { id })
                return { id }
            } catch {
                await Bun.sleep(50)
            }
        }
        throw new Error('active backup unavailable')
    }
    if (mode === 'verify' || mode === 'absent') {
        const id = managedBackupJobSchema.shape.id.parse(process.argv[3])
        if (mode === 'absent') {
            await assert.rejects(stat(join(artifacts, id)), { code: 'ENOENT' })
            return { id }
        }
        const current = await status()
        const job = current.jobs.find((entry) => entry.id === id)
        assert.equal(job?.state, 'succeeded')
        assert.equal(job?.retained, true)
        const verified = await verifyPublishedBackup(join(artifacts, id))
        assert.deepEqual(verified.metadata.source, job?.source)
        assert.deepEqual(
            verified.metadata.source,
            JSON.parse(await readFile('/usr/share/rentnerproxy/backup-source.json', 'utf8')),
        )
        assert.equal(verified.metadataSha256, job?.artifact?.metadataSha256)
        assert.equal(verified.bytes, job?.artifact?.bytes)
        assert.equal(verified.metadata.source.imageId, null)
        return { id }
    }
    if (mode === 'schedule') {
        // Only called by a root-only maintenance container after the source appliance is stopped.
        const state = managedBackupStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
        assert.ok(state.jobs.every((job) => job.state !== 'queued' && job.state !== 'running'))
        assert.equal(state.configuration.enabled, false)
        state.configuration = {
            ...state.configuration,
            revision: state.configuration.revision + 1,
            enabled: true,
            intervalHours: 1,
            nextRunAt: Date.now() - 3 * 60 * 60 * 1_000,
        }
        managedBackupStateSchema.parse(state)
        const temporary = statePath + '.' + randomUUID() + '.smoke.tmp'
        await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
        await chmod(temporary, 0o600)
        await rename(temporary, statePath)
        return { scheduledBefore: state.jobs.filter((job) => job.origin === 'schedule').length }
    }
    throw new Error('unknown probe')
}

if (import.meta.main) {
    const mode = process.argv[2]
    try {
        assert.ok(probeModes.includes(mode as (typeof probeModes)[number]))
        console.log(JSON.stringify(await run(mode as (typeof probeModes)[number])))
    } catch {
        console.error('Managed backup fixture probe failed')
        process.exitCode = 1
    }
}
