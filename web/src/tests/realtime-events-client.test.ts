import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { subscribeToRealtimeEvents } from '../websockets/Client/realtimeEventsClient'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = 0
    sent: string[] = []
    closed = false

    constructor(readonly url: URL) {
        super()
        FakeSocket.instances.push(this)
    }

    send(value: string) {
        this.sent.push(value)
    }

    open() {
        this.readyState = FakeSocket.OPEN
        this.dispatchEvent(new Event('open'))
    }

    close() {
        this.closed = true
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }

    deliver(value: unknown, query: object = {}, topic = 'app-events') {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({
                    type: 'snapshot',
                    topic,
                    query,
                    payload: value,
                }),
            }),
        )
    }

    deliverUnauthorized() {
        this.dispatchEvent(
            new MessageEvent('message', { data: JSON.stringify({ type: 'unauthorized' }) }),
        )
    }
}

const originalSocket = globalThis.WebSocket
let cleanups: Array<() => void> = []

beforeEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('http://localhost:5173/'),
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    cleanups = []
})

afterEach(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups = []
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('shares a topic query and unsubscribes after the last listener leaves', async () => {
    const received: unknown[] = []
    cleanups.push(
        subscribeToRealtimeEvents({
            topic: 'app-events',
            query: { user: 'current' },
            onData: (data) => {
                received.push(['first', data])
            },
        }),
    )
    const secondCleanup = subscribeToRealtimeEvents({
        topic: 'app-events',
        query: { user: 'current' },
        onData: (data) => {
            received.push(['second', data])
        },
    })
    cleanups.push(secondCleanup)

    const socket = FakeSocket.instances[0]!
    socket.open()
    expect(socket.sent).toEqual([
        JSON.stringify({ type: 'subscribe', topic: 'app-events', query: { user: 'current' } }),
    ])
    socket.deliver({ revision: 'r1', userVersion: 'u1' }, { user: 'current' })
    await Promise.resolve()
    expect(received).toEqual([
        ['first', { revision: 'r1', userVersion: 'u1' }],
        ['second', { revision: 'r1', userVersion: 'u1' }],
    ])

    secondCleanup()
    expect(socket.sent).toHaveLength(1)
    cleanups[0]!()
    expect(socket.sent).toEqual([
        JSON.stringify({ type: 'subscribe', topic: 'app-events', query: { user: 'current' } }),
        JSON.stringify({ type: 'unsubscribe', topic: 'app-events' }),
    ])
    expect(socket.closed).toBe(true)
})

test('ignores messages from a closed socket and forwards unauthorized frames', async () => {
    const received: unknown[] = []
    let unauthorized = 0
    cleanups.push(
        subscribeToRealtimeEvents({
            topic: 'app-events',
            query: {},
            onData: (data) => {
                received.push(data)
            },
            onUnauthorized: () => {
                unauthorized += 1
            },
        }),
    )
    const first = FakeSocket.instances[0]!
    first.open()
    cleanups[0]!()

    cleanups = [
        subscribeToRealtimeEvents({
            topic: 'app-events',
            query: {},
            onData: (data) => {
                received.push(data)
            },
            onUnauthorized: () => {
                unauthorized += 1
            },
        }),
    ]
    const second = FakeSocket.instances[1]!
    second.open()
    first.deliver('old')
    second.deliver('current')
    await Promise.resolve()
    expect(received).toEqual(['current'])

    second.deliverUnauthorized()
    expect(unauthorized).toBe(1)
    expect(second.closed).toBe(true)
})

test('resubscribes and calls resume handlers after a hidden page returns', () => {
    let resumed = 0
    cleanups.push(
        subscribeToRealtimeEvents({
            topic: 'app-events',
            query: {},
            onData: () => {},
            onResume: () => {
                resumed += 1
            },
        }),
    )
    const first = FakeSocket.instances[0]!
    first.open()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(first.closed).toBe(true)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(resumed).toBe(1)
    expect(FakeSocket.instances).toHaveLength(2)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(JSON.parse(second.sent[0]!)).toEqual({
        type: 'subscribe',
        topic: 'app-events',
        query: {},
    })

    document.dispatchEvent(new Event('visibilitychange'))
    expect(resumed).toBe(1)
})

test('routes buffered snapshots by query while a socket is shared', async () => {
    const received: unknown[] = []
    const holder = subscribeToRealtimeEvents({
        topic: 'app-events',
        query: {},
        onData: () => {},
    })
    cleanups.push(holder)
    const oldCleanup = subscribeToRealtimeEvents({
        topic: 'access-logs',
        query: { search: 'first' },
        onData: (data) => {
            received.push(['old', data])
        },
    })
    const socket = FakeSocket.instances[0]!
    socket.open()
    oldCleanup()
    const currentCleanup = subscribeToRealtimeEvents({
        topic: 'access-logs',
        query: { search: 'current' },
        onData: (data) => {
            received.push(['current', data])
        },
    })
    cleanups.push(currentCleanup)
    expect(FakeSocket.instances).toHaveLength(1)

    socket.deliver('old', { search: 'first' }, 'access-logs')
    socket.deliver('current', { search: 'current' }, 'access-logs')
    await Promise.resolve()
    expect(received).toEqual([['current', 'current']])
})

test('does not open a socket until a hidden page becomes visible', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    cleanups.push(
        subscribeToRealtimeEvents({
            topic: 'app-events',
            query: {},
            onData: () => {},
        }),
    )
    expect(FakeSocket.instances).toHaveLength(0)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeSocket.instances).toHaveLength(1)
})
