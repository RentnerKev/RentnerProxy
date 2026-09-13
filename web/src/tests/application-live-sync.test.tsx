import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider,
} from '@tanstack/react-router'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { auditLogsQueryKeys } from '../features/Admin/AuditLogs/queryKeys'
import { proxyAccessLogsQueryKeys } from '../features/Admin/ProxyAccessLogs/queryKeys'
import { foundationStatusQueryKeys } from '../features/FoundationStatus/queryKeys'
import useApplicationLiveSync from '../shared/Live/useApplicationLiveSync'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN
    closed = false

    constructor(readonly url: URL) {
        super()
        FakeSocket.instances.push(this)
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
                    topic: 'app-events',
                    query,
                    payload: data,
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
let root: Root
let queryClient: QueryClient
const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
})
let invalidateSpy: ReturnType<typeof spyOn> | undefined
let container: HTMLDivElement
let activeFetches: number

function Probe() {
    useApplicationLiveSync()
    useQuery({
        queryKey: ['application-live', 'active'],
        queryFn: async () => {
            activeFetches += 1
            return activeFetches
        },
    })
    return null
}

async function flush() {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
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
    activeFetches = 0
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    invalidateSpy?.mockRestore()
    invalidateSpy = undefined
    container.remove()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('refreshes active queries and marks inactive queries stale when the application changes', async () => {
    const invalidate = spyOn(router, 'invalidate').mockResolvedValue(undefined)
    invalidateSpy = invalidate
    queryClient.setQueryData(['application-live', 'inactive'], 'stale')
    queryClient.setQueryData(proxyAccessLogsQueryKeys.list({ offset: 0 }), 'websocket-owned')
    queryClient.setQueryData(auditLogsQueryKeys.list({}), 'websocket-owned')
    queryClient.setQueryData(auditLogsQueryKeys.actors(), 'http-owned')
    queryClient.setQueryData(foundationStatusQueryKeys.all, 'websocket-owned')

    await act(async () => {
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        )
    })
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.deliver({ revision: 'r1', userVersion: 'u1' }))
    await flush()
    expect(activeFetches).toBe(2)
    expect(queryClient.getQueryState(['application-live', 'inactive'])?.isInvalidated).toBe(true)
    expect(
        queryClient.getQueryCache().findAll({ queryKey: proxyAccessLogsQueryKeys.all })[0]?.state
            .isInvalidated,
    ).toBe(false)
    expect(
        queryClient.getQueryCache().findAll({ queryKey: auditLogsQueryKeys.all })[0]?.state
            .isInvalidated,
    ).toBe(false)
    expect(queryClient.getQueryState(auditLogsQueryKeys.actors())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(foundationStatusQueryKeys.all)?.isInvalidated).toBe(false)
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => socket.deliver({ revision: 'r1', userVersion: 'u1' }))
    await flush()
    expect(activeFetches).toBe(2)
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => socket.deliver({ revision: 'r2', userVersion: 'u1' }))
    await flush()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(activeFetches).toBe(3)

    await act(async () => socket.deliver({ revision: 'r2', userVersion: 'u2' }))
    await flush()
    expect(invalidate).toHaveBeenCalledTimes(2)
})

test('clears queries and revalidates the router when the live connection is unauthorized', async () => {
    const invalidate = spyOn(router, 'invalidate').mockResolvedValue(undefined)
    invalidateSpy = invalidate
    queryClient.setQueryData(['application-live', 'cached'], 'value')

    await act(async () => {
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        )
    })
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.deliverUnauthorized())
    await flush()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(invalidate).toHaveBeenCalledTimes(1)
})
