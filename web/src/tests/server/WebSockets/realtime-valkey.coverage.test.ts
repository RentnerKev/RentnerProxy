import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test'
import { LIVE_CHANGE_COALESCE_MS } from '@/config/realtime.config.ts'
import {
    getApplicationRevision,
    publishApplicationChange,
} from '@/server/WebSockets/applicationChanges.ts'
import { createLiveWebSocketRuntime } from '@/server/WebSockets/realtimeWebSocket.ts'
import type { LiveSocketData } from '@/server/WebSockets/Types/bun.types.ts'
const existingShutdownListeners = new Set(process.listeners('rentnerproxy:shutdown'))
let available = true
let listener: ((message: string) => void) | undefined
const connection = {
    onclose: null as (() => void) | null,
    onconnect: null as (() => void) | null,
    close: mock(() => undefined),
    subscribe: mock(async (_channel: string, callback: (message: string) => void) => {
        listener = callback
    }),
}
const publisher = {
    duplicate: mock(async () => connection),
    publish: mock(async (_channel: string, _message: string) => 1),
}
mock.module('@/server/Valkey/client.server.ts', () => ({
    getValkeyClient: () => (available ? publisher : null),
}))
const { startRealtimeValkey } = await import('@/server/WebSockets/realtimeValkey.service.ts')
async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}
beforeEach(() => {
    jest.useFakeTimers()
    available = true
    listener = undefined
    connection.close.mockClear()
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Reset the Bun RedisClient callback mock.
    connection.onclose = null
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Reset the Bun RedisClient callback mock.
    connection.onconnect = null
    connection.subscribe.mockReset()
    publisher.duplicate.mockReset()
    publisher.publish.mockClear()
    connection.subscribe.mockImplementation(async (_channel, callback) => {
        listener = callback
    })
    publisher.duplicate.mockResolvedValue(connection)
})
afterEach(() => {
    const lifecycle = globalThis.rentnerproxyRealtimeValkey
    lifecycle?.stop()
    if (lifecycle) process.removeListener('rentnerproxy:shutdown', lifecycle.stop)
    for (const shutdown of process.listeners('rentnerproxy:shutdown')) {
        if (!existingShutdownListeners.has(shutdown))
            process.removeListener('rentnerproxy:shutdown', shutdown)
    }
    jest.clearAllTimers()
    globalThis.rentnerproxyRealtimeEvents = undefined
    jest.useRealTimers()
})

test('realtime Valkey subscribes once, drops malformed events and publishes coalesced changes on its owned channel', async () => {
    startRealtimeValkey()
    startRealtimeValkey()
    await settle()
    expect(publisher.duplicate).toHaveBeenCalledTimes(1)
    expect(connection.subscribe).toHaveBeenCalledWith('rentnerproxy:realtime', expect.any(Function))
    const before = getApplicationRevision()
    listener?.('not-json')
    listener?.(JSON.stringify({ type: 'unexpected', payload: { version: 'ignored' } }))
    expect(getApplicationRevision()).toBe(before)
    const incoming = crypto.randomUUID()
    listener?.(JSON.stringify({ type: 'application.updated', payload: { version: incoming } }))
    expect(getApplicationRevision()).toBe(incoming)
    publishApplicationChange()
    publishApplicationChange()
    const current = getApplicationRevision()
    jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
    await settle()
    expect(publisher.publish).toHaveBeenCalledTimes(1)
    expect(publisher.publish).toHaveBeenLastCalledWith(
        'rentnerproxy:realtime',
        JSON.stringify({ type: 'application.updated', payload: { version: current } }),
    )
    globalThis.rentnerproxyRealtimeValkey?.stop()
    expect(connection.close).toHaveBeenCalledTimes(1)
    publishApplicationChange()
    jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
    await settle()
    expect(publisher.publish).toHaveBeenCalledTimes(1)
})

test('failed subscriptions close their connection and retry only after the backoff interval', async () => {
    connection.subscribe.mockRejectedValueOnce(new Error('subscription unavailable'))
    startRealtimeValkey()
    await settle()
    expect(connection.close).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(4999)
    await settle()
    expect(publisher.duplicate).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(1)
    await settle()
    expect(publisher.duplicate).toHaveBeenCalledTimes(2)
    expect(connection.subscribe).toHaveBeenCalledTimes(2)
    globalThis.rentnerproxyRealtimeValkey?.stop()
    jest.advanceTimersByTime(15000)
    await settle()
    expect(publisher.duplicate).toHaveBeenCalledTimes(2)
})

test.each(['subscriber-close', 'subscription-failure', 'duplicate-failure'] as const)(
    'healthy publisher forwards committed changes during %s backoff without echoing local recovery',
    async (failure) => {
        if (failure === 'subscription-failure')
            connection.subscribe.mockRejectedValueOnce(new Error('subscription unavailable'))
        if (failure === 'duplicate-failure')
            publisher.duplicate.mockRejectedValueOnce(
                new Error('subscriber connection unavailable'),
            )
        startRealtimeValkey()
        await settle()
        if (failure === 'subscriber-close') connection.onclose?.()
        expect(publisher.duplicate).toHaveBeenCalledTimes(1)
        publishApplicationChange()
        const mutationRevision = getApplicationRevision()
        jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
        await settle()
        expect(publisher.publish).toHaveBeenCalledTimes(1)
        expect(publisher.publish).toHaveBeenCalledWith(
            'rentnerproxy:realtime',
            JSON.stringify({ type: 'application.updated', payload: { version: mutationRevision } }),
        )
        // A healthy peer consumes this publication even while the local subscriber is down.
        expect(publisher.duplicate).toHaveBeenCalledTimes(1)
        jest.advanceTimersByTime(5000)
        await settle()
        expect(publisher.duplicate).toHaveBeenCalledTimes(2)
        expect(getApplicationRevision()).not.toBe(mutationRevision)
        jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
        await settle()
        expect(publisher.publish).toHaveBeenCalledTimes(1)
        globalThis.rentnerproxyRealtimeValkey?.stop()
        publishApplicationChange()
        jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
        await settle()
        expect(publisher.publish).toHaveBeenCalledTimes(1)
    },
)

test('a remote Valkey event pushes a fresh snapshot to an authorized local subscription', async () => {
    startRealtimeValkey()
    await settle()
    let persistedRevision = 'before-remote-commit'
    const runtime = createLiveWebSocketRuntime({
        allowedOrigin: 'https://proxy.example',
        readSnapshot: async () => Response.json({ revision: persistedRevision }),
    })
    let data: LiveSocketData | undefined
    const messages: string[] = []
    const initialSnapshot = Promise.withResolvers<void>()
    const updatedSnapshot = Promise.withResolvers<void>()
    try {
        await runtime.handle(
            new Request('https://proxy.example/api/live', {
                headers: { upgrade: 'websocket', origin: 'https://proxy.example' },
            }),
            {
                upgrade: (_request, options) => {
                    data = options?.data
                    return true
                },
            } as Bun.Server<LiveSocketData>,
        )
        const socket = {
            data: data!,
            sendText: (message: string) => {
                messages.push(message)
                if (messages.length === 1) initialSnapshot.resolve()
                else updatedSnapshot.resolve()
                return message.length
            },
            close: mock(() => undefined),
        } as unknown as Bun.ServerWebSocket<LiveSocketData>
        runtime.websocket.open?.(socket)
        runtime.websocket.message?.(
            socket,
            JSON.stringify({ type: 'subscribe', topic: 'app-events', query: {} }),
        )
        await initialSnapshot.promise
        expect(JSON.parse(messages.at(-1)!)).toMatchObject({
            payload: { revision: 'before-remote-commit' },
        })
        persistedRevision = 'after-remote-commit'
        listener?.(
            JSON.stringify({
                type: 'application.updated',
                payload: { version: crypto.randomUUID() },
            }),
        )
        jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
        await updatedSnapshot.promise
        expect(JSON.parse(messages.at(-1)!)).toEqual({
            type: 'snapshot',
            topic: 'app-events',
            query: {},
            payload: { revision: 'after-remote-commit' },
        })
        expect(messages).toHaveLength(2)
        expect(publisher.publish).not.toHaveBeenCalled()
    } finally {
        await runtime.shutdown()
    }
})

test.each(['terminal-close', 'automatic-reconnect'] as const)(
    'Valkey %s recovery resamples missed changes with a new local revision and no bus echo',
    async (failure) => {
        startRealtimeValkey()
        await settle()
        jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
        let persistedValue = 'before-missed-commit'
        const runtime = createLiveWebSocketRuntime({
            allowedOrigin: 'https://proxy.example',
            readSnapshot: async () =>
                Response.json({
                    revision: getApplicationRevision(),
                    userVersion: 'unchanged-user',
                    value: persistedValue,
                }),
        })
        let data: LiveSocketData | undefined
        const messages: string[] = []
        const initialSnapshot = Promise.withResolvers<void>()
        const recoveredSnapshot = Promise.withResolvers<void>()
        try {
            await runtime.handle(
                new Request('https://proxy.example/api/live', {
                    headers: { upgrade: 'websocket', origin: 'https://proxy.example' },
                }),
                {
                    upgrade: (_request, options) => {
                        data = options?.data
                        return true
                    },
                } as Bun.Server<LiveSocketData>,
            )
            const socket = {
                data: data!,
                sendText: (message: string) => {
                    messages.push(message)
                    if (messages.length === 1) initialSnapshot.resolve()
                    else recoveredSnapshot.resolve()
                    return message.length
                },
                close: mock(() => undefined),
            } as unknown as Bun.ServerWebSocket<LiveSocketData>
            runtime.websocket.open?.(socket)
            runtime.websocket.message?.(
                socket,
                JSON.stringify({ type: 'subscribe', topic: 'app-events', query: {} }),
            )
            await initialSnapshot.promise
            const before = getApplicationRevision()
            const staleMessage = listener
            const staleClose = connection.onclose
            if (failure === 'terminal-close') connection.onclose?.()
            else connection.onconnect?.()
            persistedValue = 'after-missed-commit'
            expect(getApplicationRevision()).toBe(before)
            expect(connection.close).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(5000)
            await settle()
            const recovered = getApplicationRevision()
            expect(recovered).not.toBe(before)
            staleMessage?.(
                JSON.stringify({ type: 'application.updated', payload: { version: 'stale' } }),
            )
            staleClose?.()
            expect(getApplicationRevision()).toBe(recovered)
            expect(connection.close).toHaveBeenCalledTimes(1)
            jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
            await recoveredSnapshot.promise
            expect(messages).toHaveLength(2)
            expect(JSON.parse(messages.at(-1)!)).toMatchObject({
                topic: 'app-events',
                payload: {
                    revision: recovered,
                    userVersion: 'unchanged-user',
                    value: 'after-missed-commit',
                },
            })
            expect(publisher.publish).not.toHaveBeenCalled()
            globalThis.rentnerproxyRealtimeValkey?.stop()
            const stopped = getApplicationRevision()
            staleMessage?.(
                JSON.stringify({ type: 'application.updated', payload: { version: 'late' } }),
            )
            jest.advanceTimersByTime(15000)
            await settle()
            expect(getApplicationRevision()).toBe(stopped)
            expect(publisher.duplicate).toHaveBeenCalledTimes(2)
        } finally {
            await runtime.shutdown()
        }
    },
)

test('shutdown during duplicate or subscription prevents installing a publisher and releases the late connection', async () => {
    const pending = Promise.withResolvers<typeof connection>()
    publisher.duplicate.mockReturnValueOnce(pending.promise)
    startRealtimeValkey()
    const lifecycle = globalThis.rentnerproxyRealtimeValkey
    lifecycle?.stop()
    if (lifecycle) process.removeListener('rentnerproxy:shutdown', lifecycle.stop)
    pending.resolve(connection)
    await settle()
    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(connection.subscribe).not.toHaveBeenCalled()
    const subscribed = Promise.withResolvers<void>()
    connection.subscribe.mockReturnValueOnce(subscribed.promise)
    startRealtimeValkey()
    await settle()
    globalThis.rentnerproxyRealtimeValkey?.stop()
    subscribed.resolve()
    await settle()
    publishApplicationChange()
    jest.advanceTimersByTime(LIVE_CHANGE_COALESCE_MS)
    await settle()
    expect(publisher.publish).not.toHaveBeenCalled()
})

test('missing Valkey configuration leaves no subscriber and stop cancels a scheduled reconnect', async () => {
    available = false
    startRealtimeValkey()
    await settle()
    expect(publisher.duplicate).not.toHaveBeenCalled()
    const lifecycle = globalThis.rentnerproxyRealtimeValkey
    lifecycle?.stop()
    if (lifecycle) process.removeListener('rentnerproxy:shutdown', lifecycle.stop)
    available = true
    publisher.duplicate.mockRejectedValueOnce(new Error('transport unavailable'))
    startRealtimeValkey()
    await settle()
    globalThis.rentnerproxyRealtimeValkey?.stop()
    jest.advanceTimersByTime(5000)
    await settle()
    expect(publisher.duplicate).toHaveBeenCalledTimes(1)
})
