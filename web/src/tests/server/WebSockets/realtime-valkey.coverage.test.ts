import { afterEach, beforeEach, expect, jest, mock, test } from 'bun:test'
import { LIVE_CHANGE_COALESCE_MS } from '@/config/realtime.config.ts'
import {
    getApplicationRevision,
    publishApplicationChange,
} from '@/server/WebSockets/applicationChanges.ts'
const existingShutdownListeners = new Set(process.listeners('rentnerproxy:shutdown'))
let available = true
let listener: ((message: string) => void) | undefined
const connection = {
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
