import { expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'

import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'

const token = 'a'.repeat(43)
const tokenHash = createHash('sha256').update(token).digest('hex')
const initial: ManagedBackupMaintenance = {
    id: '01900000-0000-7000-8000-000000000001',
    requestId: '01900000-0000-7000-8000-000000000002',
    actorId: '01900000-0000-7000-8000-000000000003',
    actorName: 'Restore operator',
    artifactId: '01900000-0000-7000-8000-000000000004',
    metadataSha256: 'a'.repeat(64),
    operation: 'restore',
    state: 'queued',
    phase: 'queued',
    progressPercent: 0,
    requestedAt: 100,
    startedAt: null,
    finishedAt: null,
    error: null,
}
let status = initial
const stopWorkers = mock(async () => undefined)
const closeDatabase = mock(async () => undefined)
const execute = mock(async () => [{ tokenHash, expiresAt: new Date(Date.now() + 60_000) }])
const writeFile = mock(async (_contents: string) => undefined)
const sync = mock(async () => undefined)
const close = mock(async () => undefined)
const open = mock(async (_path: string, _flags: string, _mode: number) => ({
    writeFile,
    sync,
    close,
}))
const rename = mock(async (_from: string, _to: string) => undefined)
mock.module('node:fs/promises', () => ({ open, rename, unlink: async () => undefined }))
mock.module('@/server/Backups/restore-maintenance-status.server.ts', () => ({
    readRestoreMaintenanceStatus: async () => status,
}))
mock.module('@/server/Foundation/worker-lifecycle.server.ts', () => ({
    stopWorkersForRestoreMaintenance: stopWorkers,
}))
mock.module('@/db/index.ts', () => ({
    db: { execute },
    closeDatabaseForRestoreMaintenance: closeDatabase,
}))

const runtime = await import('@/server/Backups/restore-maintenance.server.ts')
const next = async () => new Response('normal operation')

test('validation failures release the admission fence without stopping services; destructive acknowledgement follows an actual drain', async () => {
    const viewer = new Request('http://localhost/api/live-snapshot', {
        headers: { cookie: 'rentnerproxy_session=' + token },
    })
    const mutation = new Request('http://localhost/change', { method: 'POST' })
    await runtime.getActiveRestoreMaintenance()
    await Bun.sleep(1)
    expect(runtime.isRestoreMaintenanceFenced()).toBe(true)
    expect(runtime.authorizeMaintenanceSnapshot(viewer)).toBe(true)
    expect((await runtime.withRestoreMaintenanceFence(mutation, next)).status).toBe(503)
    expect(stopWorkers).not.toHaveBeenCalled()
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    status = {
        ...initial,
        state: 'failed',
        phase: 'validating',
        error: 'artifact_invalid',
        finishedAt: 200,
    }
    await runtime.getActiveRestoreMaintenance()
    expect(runtime.isRestoreMaintenanceFenced()).toBe(false)
    expect(runtime.authorizeMaintenanceSnapshot(viewer)).toBe(false)
    expect((await runtime.withRestoreMaintenanceFence(mutation, next)).status).toBe(200)
    expect(stopWorkers).not.toHaveBeenCalled()
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()

    status = { ...initial, id: '01900000-0000-7000-8000-000000000005' }
    await runtime.getActiveRestoreMaintenance()
    await Bun.sleep(1)
    status = { ...status, state: 'running', phase: 'quiescing', progressPercent: 20 }
    await runtime.getActiveRestoreMaintenance()
    await Bun.sleep(1)
    expect(stopWorkers).toHaveBeenCalledTimes(1)
    expect(closeDatabase).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(JSON.parse(writeFile.mock.calls[0]![0])).toMatchObject({ id: status.id })
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename.mock.calls[0]![1]).toBe('/run/rentnerproxy/maintenance/web-quiesced.json')
    expect(runtime.authorizeMaintenanceSnapshot(viewer)).toBe(true)
    expect(stopWorkers.mock.invocationCallOrder[0]!).toBeLessThan(
        closeDatabase.mock.invocationCallOrder[0]!,
    )
    expect(closeDatabase.mock.invocationCallOrder[0]!).toBeLessThan(
        writeFile.mock.invocationCallOrder[0]!,
    )
    status = { ...status, state: 'failed', error: 'execution_failed' }
    await runtime.getActiveRestoreMaintenance()
    expect(runtime.isRestoreMaintenanceFenced()).toBe(true)
    expect((await runtime.withRestoreMaintenanceFence(mutation, next)).status).toBe(503)
})
