import { afterEach, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN

    constructor(readonly url: URL) {
        super()
        FakeSocket.instances.push(this)
    }

    close() {
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }

    deliver(data: unknown, query: object = {}) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({
                    type: 'snapshot',
                    topic: 'proxy-hosts',
                    query,
                    payload: data,
                }),
            }),
        )
    }
}

const originalSocket = globalThis.WebSocket
let root: Root
let queryClient: QueryClient
let fetches: number
let rootFetches: number

function Probe() {
    useLiveInvalidation({
        topic: 'proxy-hosts',
        query: {},
        enabled: true,
        queryKeys: [['live-invalidation']],
    })
    useQuery({ queryKey: ['live-invalidation'], queryFn: async () => ++rootFetches })
    useQuery({
        queryKey: ['live-invalidation', 'target'],
        queryFn: async () => ++fetches,
    })
    return null
}

async function flush() {
    await act(async () => {
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

beforeEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('http://localhost:5173/'),
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    fetches = 0
    rootFetches = 0
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    root = createRoot(document.createElement('div'))
})

afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('invalidates polled queries once for each new live revision', async () => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={queryClient}>
                <Probe />
            </QueryClientProvider>,
        )
    })
    const socket = FakeSocket.instances[0]!
    await flush()
    expect(fetches).toBe(1)
    expect(rootFetches).toBe(1)

    await act(async () => socket.deliver({ revision: 'r1' }))
    await flush()
    expect(fetches).toBe(2)
    expect(rootFetches).toBe(2)

    await act(async () => socket.deliver({ revision: 'r1' }))
    await flush()
    expect(fetches).toBe(2)
    expect(rootFetches).toBe(2)

    await act(async () => socket.deliver({ revision: 'r2' }))
    await flush()
    expect(fetches).toBe(3)
    expect(rootFetches).toBe(3)
})

test('reconnect retries the current snapshot even when its server revision is unchanged', async () => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <Probe />
            </QueryClientProvider>,
        ),
    )
    await flush()
    await act(async () => FakeSocket.instances[0]!.deliver({ revision: 'same-revision' }))
    await flush()
    expect(fetches).toBe(2)
    expect(rootFetches).toBe(2)
    await act(async () => FakeSocket.instances[0]!.close())
    await flush()
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1100))
    })
    expect(FakeSocket.instances).toHaveLength(2)
    await act(async () => FakeSocket.instances[1]!.deliver({ revision: 'same-revision' }))
    await flush()
    expect(fetches).toBe(3)
    expect(rootFetches).toBe(3)
})
