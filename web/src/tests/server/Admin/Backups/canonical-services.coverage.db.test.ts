import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, spyOn } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { systemSettings, auditEvents, userRoles } from '@/db/schema.ts'
import { BACKUPS_LOCAL_DEMO_KEY } from '@/config/backups.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createDemoBackupStatus } from '@/lib/Backups/demoStatus.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import { backupsController } from '@/server/Controller/backups.server.ts'
import * as downloadController from '@/server/Controller/backups-download.server.ts'
import * as limiter from '@/server/Valkey/rate-limiter.service.ts'
import * as services from '@/server/Admin/Backups/backups.service.ts'
import {
    getLocalBackupDemoStatus,
    deleteLocalBackupDemoService,
} from '@/server/Admin/Backups/backups-demo.server.ts'
import { backupOutcomesWorker } from '@/server/Admin/Backups/backup-outcomes.server.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'

const cursorKey = 'managed_backup_audit_cursor_v1'
const keys = [cursorKey, BACKUPS_LOCAL_DEMO_KEY]
const originalEnvironment = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL }
let saved: (typeof systemSettings.$inferSelect)[] = []
async function backupAudits(actor: string) {
    const rows = await database.select().from(auditEvents).where(eq(auditEvents.actorUserId, actor))
    return rows.filter(
        (row) =>
            row.result === 'success' &&
            ['config-export', 'security-settings'].includes(row.resource),
    )
}
const status = (): ManagedBackupStatus => ({
    storeId: '00000000-0000-4000-8000-000000000001',
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 7,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: [],
})
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
beforeEach(async () => {
    if (!backendCoverageEnabled) return
    saved = await database.select().from(systemSettings)
    await database.delete(systemSettings).where(eq(systemSettings.key, cursorKey))
    await database.delete(systemSettings).where(eq(systemSettings.key, BACKUPS_LOCAL_DEMO_KEY))
    spyOn(limiter, 'consumeRateLimit').mockResolvedValue({
        count: 1,
        limit: 10,
        remaining: 9,
        ttlMs: 60000,
    })
})
afterEach(async () => {
    mock.restore()
    for (const key of ['NODE_ENV', 'APP_URL'] as const) {
        const value = originalEnvironment[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    if (!backendCoverageEnabled) return
    await database.delete(systemSettings).where(inArray(systemSettings.key, keys))
    const previous = saved.filter((row) => keys.includes(row.key))
    if (previous.length) await database.insert(systemSettings).values(previous)
    await cleanupBackendCoverage()
})
afterAll(async () => {
    await backupOutcomesWorker.stop()
})

integrationTest(
    'canonical backup mutations bind the session actor and commit durable audit records',
    async () => {
        const actor = await createBackendActor()
        const snapshot = status()
        const start = spyOn(backupsController, 'start').mockResolvedValue(snapshot)
        const configure = spyOn(backupsController, 'configure').mockResolvedValue(snapshot)
        const remove = spyOn(backupsController, 'delete').mockResolvedValue(snapshot)
        const restore = spyOn(backupsController, 'restore').mockResolvedValue(snapshot)
        const offHost = spyOn(backupsController, 'configureOffHost').mockResolvedValue(snapshot)
        const read = spyOn(backupsController, 'status').mockResolvedValue(snapshot)
        const requestId = crypto.randomUUID()
        const jobId = crypto.randomUUID()
        await asBackendActor(actor, async () => {
            expect(await services.getBackupsStatusService()).toEqual(snapshot)
            await services.requestBackupService({ requestId })
            await services.updateBackupConfigurationService({
                requestId,
                expectedRevision: 0,
                enabled: true,
                intervalHours: 12,
                retentionCount: 3,
            })
            await services.deleteBackupService({ requestId, jobId, metadataSha256: null })
            await services.restoreBackupService({
                requestId,
                jobId,
                metadataSha256: 'a'.repeat(64),
            })
            await services.updateOffHostConfigurationService({
                requestId,
                expectedRevision: 0,
                enabled: false,
                endpoint: '',
                region: 'us-east-1',
                bucket: '',
                prefix: 'rentnerproxy',
            })
        })
        expect(read).toHaveBeenCalledTimes(1)
        expect(start).toHaveBeenCalledWith({ requestId, actorId: actor })
        expect(configure.mock.calls[0]?.[0]).toMatchObject({ actorId: actor, retentionCount: 3 })
        expect(remove).toHaveBeenCalledWith(jobId, {
            requestId,
            actorId: actor,
            metadataSha256: null,
        })
        expect(restore.mock.calls[0]?.[1]).toMatchObject({
            actorId: actor,
            actorName: 'Backend coverage fixture',
        })
        expect(offHost.mock.calls[0]?.[0]).toMatchObject({ actorId: actor, enabled: false })
        const audits = await backupAudits(actor)
        expect(audits).toHaveLength(5)
        expect(audits.map((row) => row.action).toSorted()).toEqual([
            'delete',
            'request',
            'request',
            'update',
            'update',
        ])
        expect(limiter.consumeRateLimit).toHaveBeenCalledWith({
            scope: 'backup-mutation',
            identifier: actor,
            limit: 10,
            windowMs: 60000,
        })
    },
)

integrationTest(
    'backup writes reject invalid, unauthorized and revoked actors without controller calls or audit writes',
    async () => {
        const actor = await createBackendActor([PERMISSIONS.BACKUPS_MANAGE])
        const viewer = await createBackendActor([PERMISSIONS.BACKUPS_VIEW])
        const start = spyOn(backupsController, 'start').mockResolvedValue(status())
        await expect(
            asBackendActor(viewer, () =>
                services.requestBackupService({ requestId: crypto.randomUUID() }),
            ),
        ).rejects.toThrow()
        await expect(
            asBackendActor(actor, () => services.requestBackupService({ requestId: 'invalid' })),
        ).rejects.toThrow('invalid_input')
        spyOn(limiter, 'consumeRateLimit').mockImplementation(async () => {
            await database.delete(userRoles).where(eq(userRoles.userId, actor))
            return { count: 1, limit: 10, remaining: 9, ttlMs: 60000 }
        })
        await expect(
            asBackendActor(actor, () =>
                services.requestBackupService({ requestId: crypto.randomUUID() }),
            ),
        ).rejects.toThrow()
        expect(start).not.toHaveBeenCalled()
        expect(await backupAudits(actor)).toHaveLength(0)
    },
)

integrationTest(
    'controller rejection rolls back application audit without hiding the error',
    async () => {
        const actor = await createBackendActor()
        spyOn(backupsController, 'start').mockRejectedValue(new Error('controller unavailable'))
        await expect(
            asBackendActor(actor, () =>
                services.requestBackupService({ requestId: crypto.randomUUID() }),
            ),
        ).rejects.toThrow('controller unavailable')
        expect(await backupAudits(actor)).toHaveLength(0)
    },
)

integrationTest(
    'canonical download authorizes, rate limits and audits only successful streams',
    async () => {
        const actor = await createBackendActor()
        const id = crypto.randomUUID()
        const download = spyOn(downloadController, 'downloadBackupController').mockResolvedValue(
            new Response('archive'),
        )
        const { downloadBackupService } =
            await import('@/server/Admin/Backups/backups-download.service.ts')
        await asBackendActor(actor, async () => {
            expect(
                await (await downloadBackupService(id, new AbortController().signal)).text(),
            ).toBe('archive')
            expect(
                (await downloadBackupService('invalid', new AbortController().signal)).status,
            ).toBe(404)
            download.mockResolvedValue(Response.json({ error: 'not_found' }, { status: 404 }))
            expect((await downloadBackupService(id, new AbortController().signal)).status).toBe(404)
        })
        expect(download).toHaveBeenCalledTimes(2)
        expect(limiter.consumeRateLimit).toHaveBeenCalledWith({
            scope: 'backup-download',
            identifier: actor,
            limit: 5,
            windowMs: 60000,
        })
        expect(await backupAudits(actor)).toHaveLength(1)
        const restricted = await createBackendActor([PERMISSIONS.BACKUPS_MANAGE])
        const cancel = mock(() => Promise.reject(new Error('transport already closed')))
        download.mockImplementation(async () => {
            await database.delete(userRoles).where(eq(userRoles.userId, restricted))
            return new Response(new ReadableStream({ cancel }))
        })
        await expect(
            asBackendActor(restricted, () =>
                downloadBackupService(crypto.randomUUID(), new AbortController().signal),
            ),
        ).rejects.toThrow()
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(await backupAudits(restricted)).toHaveLength(0)
    },
)

integrationTest(
    'backup outcome ingestion commits its cursor before acknowledgement and retries without duplicate audits',
    async () => {
        const actor = await createBackendActor()
        const snapshot = status()
        snapshot.auditEvents = [
            {
                sequence: 1,
                kind: 'requested',
                actorId: actor,
                jobId: crypto.randomUUID(),
                at: Date.now(),
            },
        ]
        spyOn(backupsController, 'status').mockResolvedValue(snapshot)
        const acknowledge = spyOn(backupsController, 'acknowledgeAudit')
            .mockRejectedValueOnce(new Error('temporary outage'))
            .mockResolvedValue(snapshot)
        await backupOutcomesWorker.runOnce()
        const [row] = await database
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, cursorKey))
        const cursor: unknown = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value
        expect(cursor).toEqual({ storeId: snapshot.storeId, sequence: 1 })
        await backupOutcomesWorker.runOnce()
        expect(acknowledge).toHaveBeenCalledTimes(2)
        expect(await backupAudits(actor)).toHaveLength(1)
        snapshot.auditEvents = [
            { sequence: 3, kind: 'requested', actorId: actor, jobId: null, at: Date.now() },
        ]
        await backupOutcomesWorker.runOnce()
        expect(acknowledge).toHaveBeenCalledTimes(2)
        expect(await backupAudits(actor)).toHaveLength(1)
    },
)

integrationTest(
    'development demo deletion is permission checked, durable and idempotent without appliance access',
    async () => {
        process.env.NODE_ENV = 'development'
        process.env.APP_URL = 'http://127.0.0.1:3000'
        const actor = await createBackendActor()
        const snapshot = createDemoBackupStatus()
        await database
            .insert(systemSettings)
            .values({ key: BACKUPS_LOCAL_DEMO_KEY, value: snapshot })
        expect((await getLocalBackupDemoStatus())?.jobs).toHaveLength(18)
        const job = snapshot.jobs[0]!
        const input = {
            actorId: actor,
            jobId: job.id,
            requestId: crypto.randomUUID(),
            metadataSha256: job.artifact?.metadataSha256 ?? null,
        }
        const result = await deleteLocalBackupDemoService(input)
        expect(result.jobs).toHaveLength(17)
        expect(await deleteLocalBackupDemoService(input)).toEqual(result)
        expect(await backupAudits(actor)).toHaveLength(1)
        const viewer = await createBackendActor([])
        await expect(
            deleteLocalBackupDemoService({
                ...input,
                actorId: viewer,
                requestId: crypto.randomUUID(),
            }),
        ).rejects.toThrow()
        await database
            .update(systemSettings)
            .set({ value: '{broken' })
            .where(eq(systemSettings.key, BACKUPS_LOCAL_DEMO_KEY))
        expect(await getLocalBackupDemoStatus()).toBeNull()
        await expect(deleteLocalBackupDemoService(input)).rejects.toThrow('unavailable')
        process.env.NODE_ENV = 'production'
        expect(await getLocalBackupDemoStatus()).toBeNull()
        await expect(deleteLocalBackupDemoService(input)).rejects.toThrow('unavailable')
    },
)
