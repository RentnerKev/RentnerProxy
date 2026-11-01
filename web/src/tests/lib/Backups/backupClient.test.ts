import { afterEach, expect, spyOn, test } from 'bun:test'
import {
    BackupClientError,
    getBackupsStatus,
    requestBackup,
    saveBackupConfiguration,
} from '@/lib/Backups/backupClient.ts'
import { BACKUP_UI_POLICY } from '@/config/backups.config.ts'

const id = '00000000-0000-4000-8000-000000000001'
const status = {
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
let restore: (() => void) | undefined
function respond(response: Response) {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response)
    restore = () => fetchSpy.mockRestore()
    return fetchSpy
}
afterEach(() => {
    restore?.()
    restore = undefined
})

test('status is fetched through the same-origin private JSON boundary with caller cancellation', async () => {
    const fetchSpy = respond(Response.json(status))
    const signal = new AbortController().signal
    expect(await getBackupsStatus(signal)).toEqual(status)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/admin/backups/status')
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        method: 'GET',
    })
})
test('unknown fields and oversized or malformed payloads never expose private server details', async () => {
    const fetchSpy = respond(Response.json({ ...status, secret: 'private-server-detail' }))
    await expect(getBackupsStatus()).rejects.toMatchObject({ code: 'invalid_response' })
    fetchSpy.mockResolvedValue(
        Response.json({ detail: 'x'.repeat(BACKUP_UI_POLICY.responseLimitBytes) }),
    )
    await expect(getBackupsStatus()).rejects.toMatchObject({ code: 'invalid_response' })
    fetchSpy.mockResolvedValue(
        new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    )
    await expect(getBackupsStatus()).rejects.toMatchObject({ code: 'invalid_response' })
    fetchSpy.mockResolvedValue(Response.json({ error: '/private/server-path' }, { status: 500 }))
    await expect(getBackupsStatus()).rejects.toThrow(new BackupClientError('unavailable'))
})
test.each([401, 403])(
    'HTTP %s revokes private client access even without a readable JSON response',
    async (code) => {
        respond(new Response('private upstream text', { status: code }))
        await expect(getBackupsStatus()).rejects.toMatchObject({
            code: code === 401 ? 'authentication_required' : 'permission_denied',
        })
    },
)
test('invalid identifiers and already-aborted reads never dispatch a request', async () => {
    const fetchSpy = respond(Response.json(status))
    await expect(requestBackup({ requestId: '../private' })).rejects.toMatchObject({
        code: 'invalid_input',
    })
    const controller = new AbortController()
    controller.abort()
    await expect(getBackupsStatus(controller.signal)).rejects.toMatchObject({ code: 'aborted' })
    expect(fetchSpy).not.toHaveBeenCalled()
})
test('mutations require a matching admission receipt or an advanced configuration revision', async () => {
    const fetchSpy = respond(Response.json(status))
    await expect(requestBackup({ requestId: id })).rejects.toMatchObject({
        code: 'invalid_response',
    })
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ requestId: id }),
    })
    await expect(
        saveBackupConfiguration({
            requestId: id,
            expectedRevision: 0,
            enabled: true,
            intervalHours: 12,
            retentionCount: 7,
        }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
})
