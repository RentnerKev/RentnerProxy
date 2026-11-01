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

test('real Bun streaming responses retain verified size when transport omits Content-Length', async () => {
    const payloadSize = 131_072
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            expect(new URL(request.url).pathname).toBe('/internal/v1/backups/' + id + '/download')
            expect(request.headers.get('authorization')).toBe(
                'Bearer synthetic-backup-download-controller-token',
            )
            let offset = 0
            return new Response(
                new ReadableStream<Uint8Array>({
                    pull(controller) {
                        const size = Math.min(65_536, payloadSize - offset)
                        controller.enqueue(new Uint8Array(size).fill(42))
                        offset += size
                        if (offset === payloadSize) controller.close()
                    },
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-tar',
                        'Content-Length': String(payloadSize),
                        'X-Rentnerproxy-Backup-Bytes': String(payloadSize),
                    },
                },
            )
        },
    })
    try {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:' + server.port
        const response = await downloadBackupController(id, new AbortController().signal)
        expect(response.headers.get('x-rentnerproxy-backup-bytes')).toBe(String(payloadSize))
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(
            new Uint8Array(payloadSize).fill(42),
        )
    } finally {
        await server.stop(true)
    }
})

test('silent preparation has its own allowance and active HTTP transfer outlives that entire budget', async () => {
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch() {
            await Bun.sleep(200)
            let chunks = 0
            return new Response(
                new ReadableStream<Uint8Array>({
                    async pull(controller) {
                        await Bun.sleep(60)
                        controller.enqueue(new Uint8Array(256).fill(42))
                        if (++chunks === 8) controller.close()
                    },
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-tar',
                        'X-Rentnerproxy-Backup-Bytes': '2048',
                    },
                },
            )
        },
    })
    try {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:' + server.port
        const response = await downloadBackupController(id, new AbortController().signal, {
            preparationMs: 300,
            idleMs: 150,
            connectionMs: 5,
        })
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(2048).fill(42))
    } finally {
        await server.stop(true)
    }
}, 3000)

test('unconsumed stalled web body expires and releases a pending upstream reader despite hanging cancel', async () => {
    let cancelled = false
    const upstream = new ReadableStream<Uint8Array>({
        cancel() {
            cancelled = true
            return new Promise<void>(() => {})
        },
    })
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(upstream, {
            headers: { 'Content-Type': 'application/x-tar', 'X-Rentnerproxy-Backup-Bytes': '2048' },
        }),
    )
    const response = await downloadBackupController(id, new AbortController().signal, {
        preparationMs: 1000,
        idleMs: 30,
        connectionMs: 1,
    })
    await Bun.sleep(60)
    await expect(response.arrayBuffer()).rejects.toThrow('unavailable')
    expect(cancelled).toBe(true)
    expect(upstream.locked).toBe(false)
}, 1000)

test('silent header stall still exhausts its bounded preparation allowance', async () => {
    let unblock: (() => void) | undefined
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch() {
            await new Promise<void>((resolve) => {
                unblock = resolve
            })
            return new Response(null)
        },
    })
    try {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:' + server.port
        await expect(
            downloadBackupController(id, new AbortController().signal, {
                preparationMs: 30,
                idleMs: 100,
                connectionMs: 1,
            }),
        ).rejects.toThrow('unavailable')
    } finally {
        unblock?.()
        await server.stop(true)
    }
}, 1000)

test.each([
    { 'content-length': '2048', 'x-rentnerproxy-backup-bytes': '1024' },
    { 'x-rentnerproxy-backup-bytes': '0' },
    { 'x-rentnerproxy-backup-bytes': '34359938368' },
    { 'x-rentnerproxy-backup-bytes': '+2048' },
])('rejects invalid or inconsistent verified size headers', async (headers) => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(new Uint8Array(2048), {
            headers: { 'content-type': 'application/x-tar', ...headers },
        }),
    )
    await expect(downloadBackupController(id, new AbortController().signal)).rejects.toThrow(
        'unavailable',
    )
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
