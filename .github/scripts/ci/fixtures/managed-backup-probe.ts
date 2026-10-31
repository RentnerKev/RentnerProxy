// oxlint-disable no-await-in-loop -- Isolated appliance probes poll one bounded lifecycle transition at a time.
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { chmod, chown, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { notificationStateSchema } from '../../../../web/src/server/Notifications/notification-state.validation.ts'
import { storedNotificationConfigurationSchema } from '../../../../web/src/server/Notifications/notification-settings.validation.ts'
import {
    NOTIFICATION_SECRET_CONTEXT,
    NOTIFICATION_SETTINGS_KEY,
    NOTIFICATION_STATE_KEY,
} from '../../../../web/src/config/notifications.config.ts'
import {
    managedBackupJobSchema,
    managedBackupStateSchema,
    managedBackupStatusSchema,
} from '../../../../web/src/lib/Backups/validation.ts'
import { verifyPublishedBackup } from '../../../../scripts/backup/publication.ts'
import {
    OPAQUE_TOKEN_BYTES,
    OPAQUE_TOKEN_PATTERN,
    SESSION_COOKIE_NAME,
} from '../../../../web/src/config/auth.config.ts'
import { sqlQuote } from './appliance-storage.ts'
import { backupAuditCursorSchema as notificationCursorSchema } from '../../../../web/src/server/Admin/Backups/backup-outcomes.ts'

const statePath = '/var/lib/rentnerproxy/backups/jobs.json'
const artifacts = '/var/lib/rentnerproxy/backups/artifacts'
const markerPath = '/var/lib/rentnerproxy/proxy/managed-backup-smoke-marker'
const marker = 'isolated-managed-backup-fixture'
const actorId = '0198d98a-0000-7000-8000-000000000001'
const probeModes = [
    'auth',
    'web-isolation',
    'web-api',
    'notification-replay',
    'notification-restored',
    'audit-position',
    'audit-settled',
    'restore-progress',
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
    if (mode === 'web-api') return await webApiProbe()
    if (mode === 'notification-replay') return await verifyNotificationReplay()
    if (mode === 'audit-settled') {
        const deadline = Date.now() + 45_000
        while (Date.now() < deadline) {
            const state = managedBackupStateSchema.parse(
                JSON.parse(await readFile(statePath, 'utf8')),
            )
            if (state.auditEvents.length === 0) return { ok: true }
            await Bun.sleep(100)
        }
        throw new Error('initial backup audit acknowledgement unavailable')
    }
    if (mode === 'audit-position') {
        const state = managedBackupStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
        return { storeId: state.storeId, sequence: state.auditAcknowledged ?? 0 }
    }
    if (mode === 'restore-progress')
        return await verifyRestoredAuditProgress(
            managedBackupJobSchema.shape.id.parse(process.argv[3]),
        )
    if (mode === 'notification-restored') {
        const snapshot = await notificationSnapshot()
        const configuration = storedNotificationConfigurationSchema.parse(snapshot.configuration)
        assert.equal(configuration.enabled, false)
        assert.equal(configuration.pausedAfterRestore, true)
        assert.equal(snapshot.runtime, null)
        return { ok: true }
    }
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

async function webRequest(
    path: string,
    token?: string,
    body?: unknown,
    origin: string | null = 'https://managed-backup.invalid',
) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (token) headers.cookie = SESSION_COOKIE_NAME + '=' + token
    if (origin !== null) headers.origin = origin
    const response = await fetch('http://127.0.0.1:3000/api/admin/backups/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
    })
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    return { status: response.status, body: (await response.json()) as unknown }
}

async function webApiProbe() {
    const viewerId = randomUUID()
    const ownerToken = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url')
    const viewerToken = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url')
    assert.match(ownerToken, OPAQUE_TOKEN_PATTERN)
    assert.match(viewerToken, OPAQUE_TOKEN_PATTERN)
    // Normal active users, built-in roles and fresh opaque-token sessions; no authentication bypass.
    // Raw tokens stay in this process and never enter SQL, subprocess output, or host logs.
    await psql(`BEGIN;
        INSERT INTO rentnerproxy.users(id,display_name,email,status,email_verified_at)
        VALUES (${sqlQuote(actorId)},'Managed Backup Owner','managed-backup-owner@fixture.invalid','active',now()),
               (${sqlQuote(viewerId)},'Managed Backup Viewer','managed-backup-viewer@fixture.invalid','active',now());
        INSERT INTO rentnerproxy.user_roles(user_id,role_id)
        SELECT ${sqlQuote(actorId)},id FROM rentnerproxy.roles WHERE key='owner';
        INSERT INTO rentnerproxy.user_roles(user_id,role_id)
        SELECT ${sqlQuote(viewerId)},id FROM rentnerproxy.roles WHERE key='viewer';
        INSERT INTO rentnerproxy.sessions(user_id,token_hash,reauthenticated_at,expires_at)
        VALUES (${sqlQuote(actorId)},${sqlQuote(createHash('sha256').update(ownerToken).digest('hex'))},now(),now()+interval '1 hour'),
               (${sqlQuote(viewerId)},${sqlQuote(createHash('sha256').update(viewerToken).digest('hex'))},now(),now()+interval '1 hour');
        COMMIT;`)
    assert.equal((await webRequest('status')).status, 401)
    assert.equal((await webRequest('status', viewerToken)).status, 403)
    const ownerStatus = await webRequest('status', ownerToken)
    assert.equal(ownerStatus.status, 200)
    const before = managedBackupStatusSchema.parse(ownerStatus.body)
    const configuration = {
        requestId: randomUUID(),
        expectedRevision: before.configuration.revision,
        enabled: false,
        intervalHours: 1,
        retentionCount: 1,
    }
    assert.equal((await webRequest('start', viewerToken, { requestId: randomUUID() })).status, 403)
    assert.equal((await webRequest('config', viewerToken, configuration)).status, 403)
    for (const origin of [null, 'https://forged.invalid']) {
        assert.equal(
            (await webRequest('start', ownerToken, { requestId: randomUUID() }, origin)).status,
            403,
        )
        assert.equal((await webRequest('config', ownerToken, configuration, origin)).status, 403)
    }
    for (const extra of [{ actorId: viewerId }, { path: '/etc' }]) {
        assert.equal(
            (await webRequest('start', ownerToken, { requestId: randomUUID(), ...extra })).status,
            400,
        )
        assert.equal(
            (await webRequest('config', ownerToken, { ...configuration, ...extra })).status,
            400,
        )
    }
    const configured = await webRequest('config', ownerToken, configuration)
    assert.equal(configured.status, 200)
    const configuredStatus = managedBackupStatusSchema.parse(configured.body)
    assert.equal(configuredStatus.configuration.enabled, false)
    assert.equal(configuredStatus.configuration.retentionCount, 1)
    return await exerciseBackupNotifications(ownerToken, viewerId)
}

const notificationReceiptPath = '/tmp/managed-backup-notification-proof.json'
const cursorKey = 'managed_backup_audit_cursor_v1'
export const backupNotificationPayloadSchema = z
    .strictObject({
        schemaVersion: z.literal(1),
        id: z.uuid(),
        incidentId: z.uuid(),
        type: z.enum(['success', 'incident']),
        category: z.literal('backup'),
        severity: z.enum(['info', 'error']),
        resourceId: z.uuid(),
        code: z.enum(['backup_succeeded', 'backup_failed']),
        occurredAt: z.iso.datetime(),
        startedAt: z.iso.datetime(),
        failures: z.number().int().min(0).max(1),
    })
    .superRefine((payload, context) => {
        const success = payload.code === 'backup_succeeded'
        if (
            payload.type !== (success ? 'success' : 'incident') ||
            payload.severity !== (success ? 'info' : 'error') ||
            payload.failures !== (success ? 0 : 1)
        )
            context.addIssue({ code: 'custom', message: 'Invalid backup outcome payload' })
    })

function unwrapSetting(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value
}

async function notificationSnapshot() {
    const value: unknown = JSON.parse(
        await psql(`SELECT json_build_object(
        'configuration',(SELECT value FROM rentnerproxy.system_settings WHERE key=${sqlQuote(NOTIFICATION_SETTINGS_KEY)}),
        'runtime',(SELECT value FROM rentnerproxy.system_settings WHERE key=${sqlQuote(NOTIFICATION_STATE_KEY)}),
        'cursor',(SELECT value FROM rentnerproxy.system_settings WHERE key=${sqlQuote(cursorKey)})
    )`),
    )
    const row = z
        .strictObject({ configuration: z.unknown(), runtime: z.unknown(), cursor: z.unknown() })
        .parse(value)
    return {
        configuration: unwrapSetting(row.configuration),
        runtime: unwrapSetting(row.runtime),
        cursor: unwrapSetting(row.cursor),
    }
}

async function saveNotificationConfiguration(configuration: unknown) {
    const parsed = storedNotificationConfigurationSchema.parse(configuration)
    await psql(
        `INSERT INTO rentnerproxy.system_settings(key,value) VALUES (${sqlQuote(NOTIFICATION_SETTINGS_KEY)},${sqlQuote(JSON.stringify(parsed))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    )
}

async function waitTerminalJob(id: string, expected: 'succeeded' | 'failed') {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
        const state = managedBackupStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
        const job = state.jobs.find((entry) => entry.id === id)
        assert.ok(job)
        if (job.state === expected) return job
        assert.ok(
            job.state === 'queued' || job.state === 'running',
            'unexpected terminal backup outcome',
        )
        await Bun.sleep(100)
    }
    throw new Error('notification fixture backup deadline exceeded')
}

async function startOwnerWebBackup(ownerToken: string, blockCapture: boolean) {
    const requestId = randomUUID()
    const started = await webRequest('start', ownerToken, { requestId })
    assert.equal(started.status, 202)
    const job = managedBackupStatusSchema
        .parse(started.body)
        .jobs.find((entry) => entry.requestId === requestId)
    assert.ok(job)
    assert.equal(job.actorId, actorId)
    assert.equal(job.origin, 'manual')
    const durable = managedBackupStateSchema
        .parse(JSON.parse(await readFile(statePath, 'utf8')))
        .jobs.find((entry) => entry.id === job.id)
    assert.equal(durable?.requestId, requestId)
    assert.equal(durable?.actorId, actorId)
    if (blockCapture) {
        // An empty, root-private directory for this newly admitted fixture job makes
        // mkdir fail before capture; no existing artifact or application file changes.
        await mkdir(join(artifacts, '.staging-' + job.id), { mode: 0o700 })
    }
    return job.id
}

async function waitBackupNotification(
    jobId: string,
    ownerChannelId: string,
    viewerChannelId: string,
    code: 'backup_succeeded' | 'backup_failed',
) {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
        const snapshot = await notificationSnapshot()
        if (snapshot.runtime !== null && snapshot.cursor !== null) {
            const engine = notificationStateSchema.parse(
                z.object({ engine: z.unknown() }).parse(snapshot.runtime).engine,
            )
            const deliveries = engine.deliveries.filter(
                (delivery) =>
                    delivery.payload.category === 'backup' && delivery.payload.resourceId === jobId,
            )
            assert.equal(
                deliveries.some((delivery) => delivery.channelId === viewerChannelId),
                false,
            )
            assert.ok(deliveries.length <= 1, 'duplicate backup notification')
            const delivery = deliveries[0]
            if (delivery) {
                assert.equal(delivery.channelId, ownerChannelId)
                const payload = backupNotificationPayloadSchema.parse(delivery.payload)
                assert.equal(payload.code, code)
                assert.equal(
                    engine.incidents.some((incident) => incident.id === payload.incidentId),
                    false,
                )
                assert.ok(
                    !['failed', 'cancelled'].includes(delivery.status),
                    'backup notification delivery rejected',
                )
                if (delivery.status === 'succeeded') {
                    assert.equal(delivery.attempts, 1)
                    assert.equal(delivery.leaseToken, null)
                    assert.equal(delivery.leaseExpiresAt, null)
                    assert.equal(delivery.error, null)
                    const action = code === 'backup_succeeded' ? 'save' : 'failed'
                    const result = code === 'backup_succeeded' ? 'success' : 'failure'
                    assert.equal(
                        await psql(
                            `SELECT count(*) FROM rentnerproxy.audit_events WHERE resource='config-export' AND target_id=${sqlQuote(jobId)} AND action=${sqlQuote(action)} AND result=${sqlQuote(result)}`,
                        ),
                        '1',
                    )
                    const cursor = notificationCursorSchema.parse(snapshot.cursor)
                    const root = managedBackupStateSchema.parse(
                        JSON.parse(await readFile(statePath, 'utf8')),
                    )
                    assert.equal(cursor.storeId, root.storeId)
                    if ((root.auditAcknowledged ?? 0) >= cursor.sequence)
                        return { delivery, cursor }
                }
            }
        }
        await Bun.sleep(250)
    }
    throw new Error('backup notification queue or root acknowledgement unavailable')
}

async function exerciseBackupNotifications(ownerToken: string, viewerId: string) {
    const received: z.infer<typeof backupNotificationPayloadSchema>[] = []
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        maxRequestBodySize: 16_384,
        async fetch(request) {
            if (request.method !== 'POST' || new URL(request.url).pathname !== '/notifications')
                return new Response(null, { status: 404 })
            try {
                assert.equal(request.headers.get('authorization'), null)
                const payload = backupNotificationPayloadSchema.parse(await request.json())
                assert.ok(received.length < 128)
                received.push(payload)
                return new Response(null, { status: 204 })
            } catch {
                return new Response(null, { status: 400 })
            }
        },
    })
    try {
        const current = await notificationSnapshot()
        const revision =
            current.configuration === null
                ? 1
                : storedNotificationConfigurationSchema.parse(current.configuration).revision + 1
        const key = Buffer.from(
            (await readFile('/run/rentnerproxy/app-key/value', 'utf8')).trim(),
            'base64',
        )
        assert.equal(key.length, 32)
        const channel = (ownerUserId: string) => {
            const id = randomUUID()
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', key, iv)
            cipher.setAAD(Buffer.from(NOTIFICATION_SECRET_CONTEXT + id))
            const destination = {
                kind: 'webhook',
                url: 'http://127.0.0.1:' + server.port + '/notifications',
                authorizationToken: null,
                allowedPrivateCidrs: ['127.0.0.1/32'],
            }
            const ciphertext = Buffer.concat([
                cipher.update(JSON.stringify(destination), 'utf8'),
                cipher.final(),
                cipher.getAuthTag(),
            ])
            return {
                id,
                name: 'Isolated backup outcome receiver',
                kind: 'webhook' as const,
                enabled: true,
                events: ['backup' as const],
                minimumSeverity: 'warning' as const,
                thresholdSeconds: 0,
                recovery: true,
                revision,
                ownerUserId,
                hasAuthorization: false,
                destination: {
                    iv: iv.toString('base64url'),
                    ciphertext: ciphertext.toString('base64url'),
                },
            }
        }
        const ownerChannel = channel(actorId)
        const viewerChannel = channel(viewerId)
        key.fill(0)
        const configuration = storedNotificationConfigurationSchema.parse({
            version: 1,
            revision,
            enabled: true,
            pausedAfterRestore: false,
            channels: [ownerChannel, viewerChannel],
        })
        await saveNotificationConfiguration(configuration)
        const successId = await startOwnerWebBackup(ownerToken, false)
        await waitTerminalJob(successId, 'succeeded')
        const success = await waitBackupNotification(
            successId,
            ownerChannel.id,
            viewerChannel.id,
            'backup_succeeded',
        )
        const failureId = await startOwnerWebBackup(ownerToken, true)
        const failed = await waitTerminalJob(failureId, 'failed')
        assert.equal(failed.error, 'execution_failed')
        const failure = await waitBackupNotification(
            failureId,
            ownerChannel.id,
            viewerChannel.id,
            'backup_failed',
        )
        for (const [jobId, delivery] of [
            [successId, success.delivery],
            [failureId, failure.delivery],
        ] as const) {
            const observations = received.filter((payload) => payload.resourceId === jobId)
            assert.equal(observations.length, 1)
            assert.equal(observations[0]?.id, delivery.id)
        }
        const statusAfterFailure = await status()
        assert.equal(statusAfterFailure.jobs.find((job) => job.id === successId)?.retained, true)
        await saveNotificationConfiguration({
            ...configuration,
            revision: revision + 1,
            enabled: false,
        })
        await writeFile(
            notificationReceiptPath,
            JSON.stringify({
                successId,
                failureId,
                ownerChannelId: ownerChannel.id,
                viewerChannelId: viewerChannel.id,
                deliveryIds: [success.delivery.id, failure.delivery.id],
                cursor: failure.cursor,
            }),
            { flag: 'wx', mode: 0o600 },
        )
        return { id: successId }
    } finally {
        await server.stop(true)
    }
}

async function verifyNotificationReplay() {
    const proof = z
        .strictObject({
            successId: z.uuid(),
            failureId: z.uuid(),
            ownerChannelId: z.uuid(),
            viewerChannelId: z.uuid(),
            deliveryIds: z.array(z.uuid()).length(2),
            cursor: notificationCursorSchema,
        })
        .parse(JSON.parse(await readFile(notificationReceiptPath, 'utf8')))
    // One fresh startup ingest and its next normal 15s poll must not re-admit
    // acknowledged outcomes; disabled delivery policy prevents any transport.
    await Bun.sleep(16_000)
    const snapshot = await notificationSnapshot()
    const configuration = storedNotificationConfigurationSchema.parse(snapshot.configuration)
    assert.equal(configuration.enabled, false)
    const cursor = notificationCursorSchema.parse(snapshot.cursor)
    assert.deepEqual(cursor, proof.cursor)
    const engine = notificationStateSchema.parse(
        z.object({ engine: z.unknown() }).parse(snapshot.runtime).engine,
    )
    const deliveries = engine.deliveries.filter((delivery) =>
        [proof.successId, proof.failureId].includes(delivery.payload.resourceId),
    )
    assert.deepEqual(
        deliveries.map((delivery) => delivery.id).toSorted(),
        proof.deliveryIds.toSorted(),
    )
    assert.ok(
        deliveries.every(
            (delivery) =>
                delivery.status === 'succeeded' &&
                delivery.attempts === 1 &&
                delivery.channelId === proof.ownerChannelId &&
                delivery.leaseToken === null,
        ),
    )
    const root = managedBackupStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
    assert.equal(cursor.storeId, root.storeId)
    assert.ok((root.auditAcknowledged ?? 0) >= cursor.sequence)
    for (const [jobId, action, result] of [
        [proof.successId, 'save', 'success'],
        [proof.failureId, 'failed', 'failure'],
    ] as const)
        assert.equal(
            await psql(
                `SELECT count(*) FROM rentnerproxy.audit_events WHERE resource='config-export' AND target_id=${sqlQuote(jobId)} AND action=${sqlQuote(action)} AND result=${sqlQuote(result)}`,
            ),
            '1',
        )
    return { ok: true }
}

async function verifyRestoredAuditProgress(jobId: string) {
    await waitTerminalJob(jobId, 'succeeded')
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
        const snapshot = await notificationSnapshot()
        const configuration = storedNotificationConfigurationSchema.parse(snapshot.configuration)
        assert.equal(configuration.enabled, false)
        assert.equal(configuration.pausedAfterRestore, true)
        assert.equal(snapshot.runtime, null)
        if (snapshot.cursor !== null) {
            const cursor = notificationCursorSchema.parse(snapshot.cursor)
            const root = managedBackupStateSchema.parse(
                JSON.parse(await readFile(statePath, 'utf8')),
            )
            const count = await psql(
                `SELECT count(*) FROM rentnerproxy.audit_events WHERE resource='config-export' AND target_id=${sqlQuote(jobId)} AND action='save' AND result='success'`,
            )
            if (
                cursor.storeId === root.storeId &&
                !('restorePending' in cursor) &&
                count === '1' &&
                (root.auditAcknowledged ?? 0) >= cursor.sequence
            )
                return { storeId: root.storeId, sequence: cursor.sequence }
        }
        await Bun.sleep(250)
    }
    throw new Error('restored backup audit progress unavailable')
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
