import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { downloadBackupController } from '@/server/Controller/backups-download.server.ts'

const id = '00000000-0000-4000-8000-000000000001'
const variables = [
    'RENTNERPROXY_CONTROLLER_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'RENTNERPROXY_CONTROLLER_TOKEN_FILE',
] as const
const original = new Map(variables.map((name) => [name, process.env[name]]))
let fetchSpy: { mockRestore(): void } | undefined
beforeEach(() => {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'synthetic-backup-download-controller-token'
    delete process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE
})
afterEach(() => {
    fetchSpy?.mockRestore()
    for (const name of variables) {
        const value = original.get(name)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
})

test('download stream exceeds JSON limit and uses fixed authenticated controller URL without redirects', async () => {
    const payload = new Uint8Array(600_000).fill(42)
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(payload, {
            headers: {
                'content-type': 'application/x-tar',
                'content-length': String(payload.length),
            },
        }),
    )
    fetchSpy = fetch
    const response = await downloadBackupController(id, new AbortController().signal)
    expect(fetch.mock.calls[0]?.[0]).toBe(
        'http://127.0.0.1:8081/internal/v1/backups/' + id + '/download',
    )
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        redirect: 'error',
        headers: {
            authorization: 'Bearer synthetic-backup-download-controller-token',
            accept: 'application/x-tar',
        },
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload)
})

test('remote plaintext and invalid identifiers never dispatch privileged credentials', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    fetchSpy = fetch
    await expect(
        downloadBackupController('../private', new AbortController().signal),
    ).rejects.toThrow()
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example.test'
    await expect(downloadBackupController(id, new AbortController().signal)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
})

test.each([404, 409, 500])('status %s exposes only safe error codes', async (status) => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('/private/internal', { status }),
    )
    const response = await downloadBackupController(id, new AbortController().signal)
    expect(response.status).toBe(status === 500 ? 503 : status)
    expect(await response.json()).toEqual({
        error: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'unavailable',
    })
})

test('truncation fails closed and cancellation releases upstream despite hanging cancel', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Uint8Array(1024), {
            headers: { 'content-type': 'application/x-tar', 'content-length': '2048' },
        }),
    )
    const truncated = await downloadBackupController(id, new AbortController().signal)
    await expect(truncated.arrayBuffer()).rejects.toThrow('unavailable')
    fetchSpy.mockRestore()
    let cancelled = false
    const upstream = new ReadableStream<Uint8Array>({
        cancel() {
            cancelled = true
            return new Promise<void>(() => {})
        },
    })
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(upstream, {
            headers: { 'content-type': 'application/x-tar', 'content-length': '2048' },
        }),
    )
    const stop = new AbortController()
    const response = await downloadBackupController(id, stop.signal)
    const pending = response.arrayBuffer()
    stop.abort()
    await expect(pending).rejects.toThrow('unavailable')
    expect(cancelled).toBe(true)
    expect(upstream.locked).toBe(false)
}, 1000)
