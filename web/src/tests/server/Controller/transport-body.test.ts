import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { controllerRequest } from '@/server/Controller/transport.server.ts'
import type { ControllerRequestOptions } from '@/server/Controller/Types/transport.types.ts'

const originalUrl = process.env.RENTNERPROXY_CONTROLLER_URL
const originalToken = process.env.RENTNERPROXY_CONTROLLER_TOKEN
let fetchSpy: { mockRestore(): void } | undefined

beforeEach(() => {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'T'.repeat(32)
})

afterEach(() => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined
    if (originalUrl === undefined) delete process.env.RENTNERPROXY_CONTROLLER_URL
    else process.env.RENTNERPROXY_CONTROLLER_URL = originalUrl
    if (originalToken === undefined) delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
    else process.env.RENTNERPROXY_CONTROLLER_TOKEN = originalToken
})

function read(response: Response, options: ControllerRequestOptions = { timeoutMs: 20 }) {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response)
    return controllerRequest('/health', options)
}

test('Controller preserves replacement UTF-8, rejects BOM and ignores Content-Length', async () => {
    const bytes = Uint8Array.of(123, 34, 118, 34, 58, 34, 255, 34, 125)
    expect(
        await read(
            new Response(bytes, {
                headers: { 'content-type': 'application/json', 'content-length': '999' },
            }),
        ),
    ).toEqual({ v: '\uFFFD' })
    fetchSpy?.mockRestore()
    expect(
        await read(new Response('\uFEFF{}', { headers: { 'content-type': 'application/json' } })),
    ).toBeNull()
})

test('a missing JSON body remains null', async () => {
    expect(
        await read(new Response(null, { headers: { 'content-type': 'application/json' } })),
    ).toBeNull()
})

test.each(['http://controller.example:8081', 'http://192.0.2.1:8081'])(
    'never transmits a controller token to remote plaintext HTTP: %s',
    async (url) => {
        process.env.RENTNERPROXY_CONTROLLER_URL = url
        const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}))
        fetchSpy = request
        expect(
            await controllerRequest('/internal/v1/proxy/access-logs', {
                privileged: true,
                timeoutMs: 20,
            }),
        ).toBeNull()
        expect(request).not.toHaveBeenCalled()
    },
)

test('internal loopback requests require credentials independently of caller flags', async () => {
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = ''
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}))
    fetchSpy = request
    expect(await controllerRequest('/internal/v1/proxy/status', { timeoutMs: 20 })).toBeNull()
    expect(request).not.toHaveBeenCalled()
})

test.each(['http://127.0.0.1:8081', 'https://controller.example:8443'])(
    'authenticates internal requests over supported transport: %s',
    async (url) => {
        process.env.RENTNERPROXY_CONTROLLER_URL = url
        const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ready: true }))
        fetchSpy = request
        expect(await controllerRequest('/internal/v1/proxy/status', { timeoutMs: 20 })).toEqual({
            ready: true,
        })
        expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
            authorization: `Bearer ${'T'.repeat(32)}`,
        })
    },
)

test('an exact byte-limit response succeeds', async () => {
    expect(await read(Response.json({ v: 1 }), { timeoutMs: 100, responseLimit: 7 })).toEqual({
        v: 1,
    })
})

test.each(['hang', 'reject'] as const)(
    'overflow cancels and releases even when cleanup will %s',
    async (mode) => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(new TextEncoder().encode('{"v":1}')),
            cancel() {
                cancelled = true
                return mode === 'hang'
                    ? new Promise<void>(() => {})
                    : Promise.reject(new Error('cleanup failed'))
            },
        })
        expect(
            await read(new Response(body, { headers: { 'content-type': 'application/json' } }), {
                timeoutMs: 20,
                responseLimit: 6,
            }),
        ).toBeNull()
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
    },
    1_000,
)

test('request deadline aborts an incomplete body and releases its reader despite hanging cancel', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
        cancel() {
            cancelled = true
            return new Promise<void>(() => {})
        },
    })
    expect(
        await read(new Response(body, { headers: { 'content-type': 'application/json' } })),
    ).toBeNull()
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
}, 1_000)

test.each([
    [503, 'application/json'],
    [200, 'text/plain'],
] as const)(
    'status %s with %s returns without awaiting hanging cancellation',
    async (status, contentType) => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true
                return new Promise<void>(() => {})
            },
        })
        const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            expect(
                await read(
                    new Response(body, { status, headers: { 'content-type': contentType } }),
                ),
            ).toBeNull()
            expect(warning).toHaveBeenCalledWith('[controller] request unavailable', {
                path: '/health',
                status,
            })
            expect(cancelled).toBe(true)
            expect(body.locked).toBe(false)
        } finally {
            warning.mockRestore()
        }
    },
    1_000,
)

test('stream read failures still return null and release the reader', async () => {
    const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.error(new Error('upstream failure')),
    })
    expect(
        await read(new Response(body, { headers: { 'content-type': 'application/json' } })),
    ).toBeNull()
    expect(body.locked).toBe(false)
})
