// oxlint-disable no-await-in-loop -- Observe the actual appliance's ordered backup, replacement and restart checkpoints.
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chown, lstat, readFile, writeFile } from 'node:fs/promises'
import {
    backupRestoreSnapshotSchema,
    managedBackupStateSchema,
    managedBackupStatusSchema,
} from '../../../../web/src/lib/Backups/validation.ts'
import { SESSION_COOKIE_NAME } from '../../../../web/src/config/auth.config.ts'
import { sqlQuote } from './appliance-storage.ts'

const origin = 'https://managed-backup.invalid'
const statePath = '/var/lib/rentnerproxy/backups/jobs.json'
const markerPath = '/var/lib/rentnerproxy/proxy/online-restore-fixture-marker'

async function psql(statement: string) {
    const process = Bun.spawn(
        [
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--quiet',
            '--set=ON_ERROR_STOP=1',
            '--tuples-only',
            '--no-align',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=rentnerproxy',
            '--command',
            statement,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [code, output] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ])
    assert.equal(code, 0, 'isolated restore fixture SQL must succeed')
    return output.trim()
}

async function wait<T>(read: () => Promise<T | undefined>) {
    const until = Date.now() + 180_000
    while (Date.now() < until) {
        const value = await read()
        if (value !== undefined) return value
        await Bun.sleep(100)
    }
    throw new Error('Online restore fixture did not reach its checkpoint')
}

async function request(token: string, path: string, body?: object) {
    const response = await fetch('http://127.0.0.1:3000' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
            origin,
            cookie: SESSION_COOKIE_NAME + '=' + token,
            'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
    })
    const value: unknown = await response.json()
    return { status: response.status, value }
}

function live(token: string) {
    // The DOM ambient type omits Bun's native authenticated-client options.
    const RuntimeWebSocket = WebSocket as typeof WebSocket & {
        new (url: string, options: Bun.WebSocketOptions): WebSocket
    }
    const socket = new RuntimeWebSocket('ws://127.0.0.1:3000/api/live', {
        headers: { origin, cookie: SESSION_COOKIE_NAME + '=' + token },
    })
    const snapshots: ReturnType<typeof backupRestoreSnapshotSchema.parse>[] = []
    socket.addEventListener('open', () =>
        socket.send(JSON.stringify({ type: 'subscribe', topic: 'backup-restore', query: {} })),
    )
    socket.addEventListener('message', (event) => {
        const message: unknown = JSON.parse(String(event.data))
        if (
            !message ||
            typeof message !== 'object' ||
            !('topic' in message) ||
            message.topic !== 'backup-restore' ||
            !('payload' in message)
        )
            return
        const parsed = backupRestoreSnapshotSchema.safeParse(message.payload)
        if (parsed.success) snapshots.push(parsed.data)
    })
    return { socket, snapshots }
}

/** Runs only in the existing private smoke appliance, using fresh local identities and no external services. */
export async function verifyManagedWebRestore() {
    assert.equal(process.getuid?.(), 0)
    assert.equal(process.env.PUBLIC_ORIGIN, origin)
    assert.equal(
        await readFile('/var/lib/rentnerproxy/proxy/managed-backup-smoke-marker', 'utf8'),
        'isolated-managed-backup-fixture',
    )
    const actor = randomUUID(),
        token = randomBytes(32).toString('base64url'),
        before = randomUUID()
    const session = (value: string) =>
        `INSERT INTO rentnerproxy.sessions(user_id,token_hash,reauthenticated_at,expires_at,oidc_proof) VALUES (${sqlQuote(actor)},${sqlQuote(createHash('sha256').update(value).digest('hex'))},now(),now()+interval '1 hour',NULL);`
    await psql(`BEGIN;
        INSERT INTO rentnerproxy.users(id,display_name,email,status,email_verified_at)
        VALUES (${sqlQuote(actor)},'Online Restore Fixture',${sqlQuote(actor + '@restore.fixture.invalid')},'active',now());
        INSERT INTO rentnerproxy.user_roles(user_id,role_id) SELECT ${sqlQuote(actor)},id FROM rentnerproxy.roles WHERE key='owner';
        ${session(token)}
        INSERT INTO rentnerproxy.system_settings(key,value) VALUES ('online_restore_fixture',${sqlQuote(JSON.stringify(before))}::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
        COMMIT;`)
    await writeFile(markerPath, before, { mode: 0o600 })
    await chown(markerPath, 10001, 10001)
    const backupRequest = randomUUID()
    assert.equal(
        (await request(token, '/api/admin/backups/start', { requestId: backupRequest })).status,
        202,
    )
    const backup = await wait(async () => {
        const state = managedBackupStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
        const job = state.jobs.find((entry) => entry.requestId === backupRequest)
        assert.ok(job?.state !== 'failed' && job?.state !== 'interrupted')
        if (job?.state !== 'succeeded' || !job.retained || !job.artifact) return undefined
        const pending = await Promise.all(
            ['request.json', 'active.json', 'result.json'].map(async (name) => {
                try {
                    await lstat('/run/rentnerproxy/backups/' + name)
                    return true
                } catch (error) {
                    if (
                        error &&
                        typeof error === 'object' &&
                        'code' in error &&
                        error.code === 'ENOENT'
                    )
                        return false
                    throw error
                }
            }),
        )
        return pending.some(Boolean) ? undefined : job
    })
    // The browser that requests recovery may have signed in after the backup.
    const currentToken = randomBytes(32).toString('base64url')
    await psql(
        session(currentToken) +
            `UPDATE rentnerproxy.system_settings SET value='"after"'::jsonb WHERE key='online_restore_fixture';`,
    )
    await writeFile(markerPath, 'after', { mode: 0o600 })
    const observer = live(currentToken)
    try {
        await wait(async () => (observer.snapshots.length ? true : undefined))
        const requestId = randomUUID()
        const accepted = await request(currentToken, '/api/admin/backups/restore', {
            requestId,
            jobId: backup.id,
            metadataSha256: backup.artifact!.metadataSha256,
        })
        assert.equal(accepted.status, 202)
        const operation = managedBackupStatusSchema.parse(accepted.value).maintenance
        assert.equal(operation?.requestId, requestId)
        await wait(async () => {
            const state = managedBackupStateSchema.parse(
                JSON.parse(await readFile(statePath, 'utf8')),
            )
            const current = state.maintenance
            assert.equal(current?.id, operation?.id)
            assert.ok(current?.state !== 'failed' && current?.state !== 'interrupted')
            return current?.state === 'succeeded' ? current : undefined
        })
        assert.ok(
            observer.snapshots.some(
                (snapshot) =>
                    snapshot.maintenance?.id === operation?.id &&
                    ['queued', 'running'].includes(snapshot.maintenance.state),
            ),
        )
        assert.equal(
            observer.socket.readyState,
            WebSocket.CLOSED,
            'the original maintenance connection must close during web restart',
        )
        const reconnected = live(currentToken)
        try {
            const completed = await wait(async () =>
                reconnected.snapshots.find(
                    (snapshot) =>
                        snapshot.maintenance?.id === operation?.id &&
                        snapshot.maintenance.state === 'succeeded',
                ),
            )
            assert.equal(completed.maintenance?.phase, 'complete')
            assert.equal(completed.maintenance?.progressPercent, 100)
        } finally {
            reconnected.socket.close()
        }
        const response = await request(currentToken, '/api/admin/backups/status')
        assert.equal(
            response.status,
            200,
            'normal authenticated routes must be unfenced after confirmed recovery',
        )
        const ready = await fetch('http://127.0.0.1:3000/health/ready')
        await ready.body?.cancel()
        assert.equal(ready.status, 200)
        assert.equal(await readFile(markerPath, 'utf8'), before)
        assert.equal(
            await psql(
                `SELECT value::text FROM rentnerproxy.system_settings WHERE key='online_restore_fixture'`,
            ),
            JSON.stringify(before),
        )
        for (const [path, mode] of [
            ['proxy', 0o710],
            ['proxy/logs', 0o2750],
        ] as const) {
            const info = await lstat('/var/lib/rentnerproxy/' + path)
            assert.equal(info.uid, 10001)
            assert.equal(info.gid, 10003)
            assert.equal(info.mode & 0o7777, mode)
        }
        return { restored: true }
    } finally {
        observer.socket.close()
    }
}
