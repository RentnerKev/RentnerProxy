import { expect, test } from 'bun:test'
import { readLiveHandshake } from '@/server/WebSockets/liveReader.ts'
import type { LiveConnectionData } from '@/server/WebSockets/Types/realtime-subscriptions.types.ts'

function connection(): LiveConnectionData {
    return {
        origin: 'http://allowed.test',
        cookie: null,
        ws: null,
        requestUrl: 'http://allowed.test/api/live',
        handshakeAbortController: null,
        subscriptions: new Map(),
        closed: false,
        messageWindowStarted: 0,
        messageCount: 0,
    }
}

test.each([401, 403, 503])(
    'snapshot HTTP status %s does not wait for hanging body cancellation',
    async (status) => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true
                return new Promise<void>(() => {})
            },
        })
        const state = connection()
        expect(
            await readLiveHandshake(
                state,
                '/api/live-snapshot',
                20,
                100,
                () => new Response(body, { status }),
            ),
        ).toBe(status)
        expect(cancelled).toBe(true)
        expect(body.locked).toBe(false)
        expect(state.handshakeAbortController).toBeNull()
    },
    1_000,
)

test('snapshot deadline cancels a locked pending body and releases its reader', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
        cancel() {
            cancelled = true
            return new Promise<void>(() => {})
        },
    })
    const state = connection()
    expect(
        await readLiveHandshake(state, '/api/live-snapshot', 20, 100, () => new Response(body)),
    ).toBe(503)
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
    expect(state.handshakeAbortController).toBeNull()
}, 1_000)

test('overflow keeps status 413 even when cancellation hangs', async () => {
    const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode('{"value":1}')),
        cancel: () => new Promise<void>(() => {}),
    })
    expect(
        await readLiveHandshake(
            connection(),
            '/api/live-snapshot',
            100,
            10,
            () => new Response(body),
        ),
    ).toBe(413)
    expect(body.locked).toBe(false)
}, 1_000)

test('invalid JSON keeps status 413 and releases its reader', async () => {
    const body = new Response('{')
    expect(await readLiveHandshake(connection(), '/api/live-snapshot', 100, 100, () => body)).toBe(
        413,
    )
    expect(body.body?.locked).toBe(false)
})
