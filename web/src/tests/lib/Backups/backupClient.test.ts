import { afterEach, expect, spyOn, test } from 'bun:test'
import {
    BackupClientError,
    getBackupsStatus,
    requestBackup,
    saveBackupConfiguration,
    deleteBackup,
    restoreBackup,
    saveOffHostConfiguration,
} from '@/lib/Backups/backupClient.ts'
import { createDemoOffHostStatus } from '@/lib/Backups/demoStatus.ts'
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

test('restore rejects an absent artifact digest and an unrelated admission receipt', async () => {
    const fetchSpy = respond(Response.json(status))
    const input = { jobId: id, requestId: id, metadataSha256: null }
    await expect(restoreBackup(input)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(restoreBackup({ ...input, metadataSha256: 'c'.repeat(64) })).rejects.toMatchObject(
        { code: 'invalid_response' },
    )
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/admin/backups/restore')
    fetchSpy.mockResolvedValue(Response.json({ error: 'artifact_invalid' }, { status: 409 }))
    await expect(restoreBackup({ ...input, metadataSha256: 'c'.repeat(64) })).rejects.toMatchObject(
        { code: 'artifact_invalid' },
    )
})

test('deletion accepts a confirmed absent history entry without requiring a nonexistent archive', async () => {
    const fetchSpy = respond(Response.json(status))
    const input = { jobId: id, requestId: id, metadataSha256: null }
    expect(await deleteBackup(input)).toEqual(status)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/admin/backups/delete')
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual(input)
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
    const configuration = {
        requestId: id,
        expectedRevision: 0,
        enabled: true,
        intervalHours: 12,
        retentionCount: 7,
    }
    fetchSpy.mockResolvedValue(Response.json(status))
    await expect(saveBackupConfiguration(configuration)).rejects.toMatchObject({
        code: 'invalid_response',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const saved = {
        ...status,
        configuration: {
            ...status.configuration,
            revision: 1,
            enabled: configuration.enabled,
            intervalHours: configuration.intervalHours,
            retentionCount: configuration.retentionCount,
        },
    }
    fetchSpy.mockResolvedValue(Response.json(saved))
    expect(await saveBackupConfiguration(configuration)).toEqual(saved)
})

test('off-host updates validate input and require an advanced verified server revision', async () => {
    const fetchSpy = respond(Response.json(status))
    const input = {
        requestId: id,
        expectedRevision: 0,
        enabled: false,
        endpoint: '',
        region: '',
        bucket: '',
        prefix: '',
    }
    await expect(saveOffHostConfiguration({ ...input, endpoint: '\n' })).rejects.toMatchObject({
        code: 'invalid_input',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(saveOffHostConfiguration(input)).rejects.toMatchObject({
        code: 'invalid_response',
    })
    fetchSpy.mockResolvedValue(Response.json({ ...status, offHost: createDemoOffHostStatus() }))
    await expect(
        saveOffHostConfiguration({
            ...input,
            expectedRevision: createDemoOffHostStatus().revision,
        }),
    ).rejects.toMatchObject({ code: 'invalid_response' })
    const advanced = {
        ...status,
        offHost: { ...createDemoOffHostStatus(), revision: 1, enabled: false },
    }
    fetchSpy.mockResolvedValue(Response.json(advanced))
    expect(await saveOffHostConfiguration(input)).toEqual(advanced)
    expect(fetchSpy.mock.calls.at(-1)).toMatchObject([
        '/api/admin/backups/off-host',
        { method: 'POST', body: JSON.stringify(input) },
    ])
})

test.each([401, 200])(
    'HTTP %s preserves domain errors even if canceling an unreadable response body rejects',
    async (code) => {
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                throw new Error('synthetic transport cancellation failure')
            },
        })
        respond(new Response(body, { status: code, headers: { 'content-type': 'text/plain' } }))
        await expect(getBackupsStatus()).rejects.toMatchObject({
            code: code === 401 ? 'authentication_required' : 'invalid_response',
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(body.locked).toBe(false)
    },
)
