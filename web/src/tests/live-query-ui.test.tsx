import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import useLiveQuery from '../shared/Live/useLiveQuery'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN
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
        this.dispatchEvent(new Event('open'))
    }
    close() {
        this.closed = true
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }
    deliver(data: unknown, query: object = {}) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({
                    type: 'snapshot',
                    topic: 'access-logs',
                    query,
                    payload: data,
                }),
            }),
        )
    }
}

const originalSocket = globalThis.WebSocket
let root: Root
let container: HTMLDivElement
let received: unknown[]
function Probe({ enabled = true, search = '' }: { enabled?: boolean; search?: string }) {
    const status = useLiveQuery({
        topic: 'access-logs',
        query: { search },
        enabled,
        onData: (data) => {
            received.push(data)
        },
    })
    return <span>{status}</span>
}

beforeEach(() => {
    window.location.href = 'http://localhost:5173/proxy-access-logs'
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    received = []
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('connects only when enabled and receives snapshots without HTTP polling', async () => {
    await act(async () => root.render(<Probe enabled={false} />))
    expect(FakeSocket.instances).toHaveLength(0)
    await act(async () => root.render(<Probe />))
    const socket = FakeSocket.instances[0]!
    socket.open()
    expect(socket.url.origin).toBe('ws://localhost:5173')
    expect(socket.url.pathname).toBe('/api/live')
    await act(async () => socket.deliver({ entries: ['new'] }, { search: '' }))
    expect(received).toEqual([{ entries: ['new'] }])
    expect(container.textContent).toBe('connected')
    await act(async () => root.render(<Probe enabled={false} />))
    expect(socket.closed).toBe(true)
    socket.deliver({ entries: ['late'] })
    expect(received).toHaveLength(1)
})

test('closes hidden pages, opens a fresh subscription on return and cleans up navigation', async () => {
    await act(async () => root.render(<Probe />))
    const first = FakeSocket.instances[0]!
    first.open()
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(first.closed).toBe(true)
    expect(container.textContent).toBe('inactive')
    first.deliver('late', { search: '' })
    expect(received).toHaveLength(0)
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(FakeSocket.instances).toHaveLength(2)
    await act(async () => root.render(<span>another page</span>))
    expect(FakeSocket.instances[1]!.closed).toBe(true)
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(FakeSocket.instances).toHaveLength(2)
})

test('replaces filters and rejects stale messages from the old subscription', async () => {
    await act(async () => root.render(<Probe search="first" />))
    const first = FakeSocket.instances[0]!
    first.open()
    await act(async () => root.render(<Probe search="ts-laser" />))
    expect(first.closed).toBe(true)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(JSON.parse(second.sent[0]!)).toEqual({
        type: 'subscribe',
        topic: 'access-logs',
        query: { search: 'ts-laser' },
    })
    await act(async () => {
        first.deliver('old', { search: 'first' })
        second.deliver('current', { search: 'ts-laser' })
    })
    expect(received).toEqual(['current'])
})

test('unmount cancels a pending reconnect', async () => {
    await act(async () => root.render(<Probe />))
    await act(async () => FakeSocket.instances[0]!.close())
    expect(container.textContent).toBe('disconnected')
    await act(async () => root.render(<span>left</span>))
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(FakeSocket.instances).toHaveLength(1)
})
