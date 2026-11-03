import { expect, mock, test } from 'bun:test'
import { createBackupsController } from '@/server/Controller/backups.server.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'

const id = '00000000-0000-4000-8000-000000000001'
const snapshot: ManagedBackupStatus = {
    storeId: id,
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 7,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: [],
}
test('backup controller preserves privileged API contracts for off-host, maintenance and audit acknowledgement', async () => {
    const request = mock(async () => snapshot as unknown)
    const controller = createBackupsController(request)
    const offHost = {
        requestId: id,
        actorId: id,
        expectedRevision: 0,
        enabled: false,
        endpoint: '',
        region: 'us-east-1',
        bucket: '',
        prefix: 'rentnerproxy',
    }
    expect(await controller.configureOffHost(offHost)).toEqual(snapshot)
    expect(request).toHaveBeenLastCalledWith('/internal/v1/backups/off-host', {
        timeoutMs: 15000,
        responseLimit: 524288,
        privileged: true,
        acceptErrorResponse: true,
        method: 'PUT',
        body: JSON.stringify(offHost),
    })
    const signal = new AbortController().signal
    await controller.acknowledgeAudit({ storeId: id, sequence: 7 }, signal)
    expect(request).toHaveBeenLastCalledWith('/internal/v1/backups/audit/ack', {
        timeoutMs: 5000,
        responseLimit: 524288,
        privileged: true,
        acceptErrorResponse: true,
        method: 'POST',
        body: JSON.stringify({ storeId: id, sequence: 7 }),
        signal,
    })
    request.mockResolvedValue({ maintenance: null })
    expect(await controller.maintenance()).toBeNull()
    expect(request).toHaveBeenLastCalledWith('/internal/v1/backups/maintenance', {
        timeoutMs: 5000,
        responseLimit: 524288,
        privileged: true,
        acceptErrorResponse: true,
    })
    request.mockResolvedValue({ maintenance: null, untrusted: true })
    await expect(controller.maintenance()).rejects.toThrow('unavailable')
    expect(request).toHaveBeenCalledTimes(4)
})

test('backup controller validates artifact ids and acknowledgement cursors before dispatch and maps strict failures', async () => {
    const request = mock(async () => snapshot as unknown)
    const controller = createBackupsController(request)
    await expect(
        controller.delete('../private', { requestId: id, actorId: id, metadataSha256: null }),
    ).rejects.toThrow('invalid_input')
    await expect(
        controller.restore('invalid', {
            requestId: id,
            actorId: id,
            actorName: 'Owner',
            metadataSha256: 'a'.repeat(64),
        }),
    ).rejects.toThrow('invalid_input')
    await expect(controller.acknowledgeAudit({ storeId: id, sequence: -1 })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValue({ error: 'conflict' })
    await expect(
        controller.configureOffHost({
            requestId: id,
            actorId: id,
            expectedRevision: 0,
            enabled: false,
            endpoint: '',
            region: '',
            bucket: '',
            prefix: '',
        }),
    ).rejects.toThrow('revision_conflict')
    request.mockResolvedValue({ error: 'unavailable', extra: true })
    await expect(controller.status()).rejects.toThrow('unavailable')
})
