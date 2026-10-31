import { expect, test } from 'bun:test'
import { createBackupsController } from '@/server/Controller/backups.server.ts'
import type { controllerRequest } from '@/server/Controller/transport.server.ts'
import {
    managedBackupStartSchema,
    managedBackupConfigurationUpdateSchema,
} from '@/lib/Backups/validation.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const snapshot = {
    storeId: requestId,
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 5,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: [],
}

test('managed backup controller uses fixed authenticated bounded routes and validated replies', async () => {
    const calls: Parameters<typeof controllerRequest>[] = []
    const controller = createBackupsController(async (...args) => {
        calls.push(args)
        return snapshot
    })
    expect(await controller.status()).toEqual(snapshot)
    await controller.start({ actorId, requestId })
    await controller.configure({
        actorId,
        requestId,
        expectedRevision: 0,
        enabled: true,
        intervalHours: 12,
        retentionCount: 10,
    })
    expect(calls.map(([path]) => path)).toEqual([
        '/internal/v1/backups/status',
        '/internal/v1/backups/start',
        '/internal/v1/backups/config',
    ])
    expect(calls[1]?.[1]).toMatchObject({
        privileged: true,
        method: 'POST',
        body: JSON.stringify({ actorId, requestId }),
        responseLimit: 524288,
    })
    expect(calls[2]?.[1].method).toBe('PUT')
})

test('unavailable and malformed controller data cannot fabricate healthy backup status', async () => {
    const unavailable = createBackupsController(async () => null)
    await expect(unavailable.status()).rejects.toMatchObject({ code: 'unavailable' })
    const malformed = createBackupsController(async () => ({
        ...snapshot,
        jobs: [{ error: '/private/backup/key' }],
    }))
    await expect(malformed.status()).rejects.toMatchObject({ code: 'unavailable' })
    const conflict = createBackupsController(async () => ({ error: 'conflict' }))
    await expect(
        conflict.configure({
            actorId,
            requestId,
            expectedRevision: 1,
            enabled: false,
            intervalHours: 1,
            retentionCount: 1,
        }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
})

test('browser mutation schemas reject actor impersonation and invalid schedule bounds', () => {
    const start = managedBackupStartSchema.omit({ actorId: true })
    const configure = managedBackupConfigurationUpdateSchema.omit({ actorId: true })
    expect(start.safeParse({ requestId }).success).toBe(true)
    expect(start.safeParse({ requestId, actorId }).success).toBe(false)
    expect(
        configure.safeParse({
            requestId,
            expectedRevision: 0,
            enabled: true,
            intervalHours: 8761,
            retentionCount: 51,
        }).success,
    ).toBe(false)
})

test('busy controller admission remains a conflict rather than unavailable', async () => {
    const controller = createBackupsController(async () => ({ error: 'busy' }))
    await expect(controller.start({ actorId, requestId })).rejects.toMatchObject({ code: 'busy' })
})
