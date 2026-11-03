import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import * as environment from '@/server/env.server.ts'
import { downloadBackupController } from '@/server/Controller/backups-download.server.ts'
const id = '00000000-0000-4000-8000-000000000001'
beforeEach(() => {
    spyOn(environment, 'getControllerBaseUrl').mockReturnValue('http://127.0.0.1:8081')
    spyOn(environment, 'getControllerToken').mockReturnValue('synthetic-backup-stream-token')
})
afterEach(() => mock.restore())
function archive(body: ReadableStream<Uint8Array>) {
    return new Response(body, {
        headers: { 'Content-Type': 'application/x-tar', 'Content-Length': '1024' },
    })
}
test('aborting an acquired download errors its consumer and cancels the controller body', async () => {
    const cancel = mock(() => Promise.reject(new Error('already disconnected')))
    spyOn(globalThis, 'fetch').mockResolvedValue(archive(new ReadableStream({ cancel })))
    const abort = new AbortController()
    const response = await downloadBackupController(id, abort.signal)
    abort.abort()
    await expect(response.arrayBuffer()).rejects.toThrow('backup download unavailable')
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
})
test('consumer cancellation propagates to the privileged controller stream', async () => {
    const cancel = mock(() => Promise.resolve())
    spyOn(globalThis, 'fetch').mockResolvedValue(archive(new ReadableStream({ cancel })))
    const response = await downloadBackupController(id, new AbortController().signal)
    await response.body?.cancel()
    expect(cancel).toHaveBeenCalledTimes(1)
})
test('failed controller response disposal tolerates a transport cancellation error', async () => {
    const cancel = mock(() => Promise.reject(new Error('closed transport')))
    spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { status: 409 }),
    )
    const response = await downloadBackupController(id, new AbortController().signal)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
})
