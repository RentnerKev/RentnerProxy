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

import { auditLogsQueryKeys } from '@/lib/Admin/AuditLogs/auditLogsCache.ts'
import { proxyAccessLogsQueryKeys } from '@/lib/Admin/ProxyAccessLogs/proxyAccessLogsCache.ts'
import { foundationStatusQueryKeys } from '@/lib/FoundationStatus/foundationStatusCache.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import useApplicationLiveSync from '@/shared/Live/Hooks/useApplicationLiveSync.ts'
import { securityQueryKeys } from '@/lib/UserSettings/userSettingsCache.ts'

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

function ActiveQueryProbe() {
    useQuery({
        queryKey: ['application-live', 'active'],
        queryFn: async () => {
            activeFetches += 1
            return activeFetches
        },
    })
    return null
}

function Probe() {
    const { isIdentityPending, hasIdentityError, retryIdentity } = useApplicationLiveSync()
    return (
        <div>
            {hasIdentityError ? (
                <button type="button" onClick={retryIdentity}>
                    Retry identity
                </button>
            ) : isIdentityPending ? (
                'Identity pending'
            ) : (
                <>
                    <ActiveQueryProbe />
                    Identity ready
                </>
            )}
        </div>
    )
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
    queryClient.setQueryData(crowdSecQueryKeys.configuration, 'websocket-owned')
    queryClient.setQueryData(crowdSecQueryKeys.forwardAuthSummary, 'websocket-owned')
    queryClient.setQueryData([...crowdSecQueryKeys.dashboard, { offset: 0 }], 'websocket-owned')

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
    expect(queryClient.getQueryState(crowdSecQueryKeys.configuration)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(crowdSecQueryKeys.forwardAuthSummary)?.isInvalidated).toBe(
        false,
    )
    expect(
        queryClient.getQueryCache().findAll({ queryKey: crowdSecQueryKeys.dashboard })[0]?.state
            .isInvalidated,
    ).toBe(false)
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

    expect(queryClient.getQueryData(['application-live', 'cached'])).toBeUndefined()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('Identity ready')
    expect(FakeSocket.instances).toHaveLength(2)
    expect(socket.closed).toBe(true)
})

test('keeps identity data hidden after revalidation fails and provides a successful retry', async () => {
    invalidateSpy = spyOn(router, 'invalidate')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined)
    queryClient.setQueryData(securityQueryKeys.status('old-user'), { passkeys: ['Private laptop'] })
    await act(async () =>
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        ),
    )
    await act(async () => FakeSocket.instances[0]!.deliverUnauthorized())
    await flush()
    expect(container.textContent).toBe('Retry identity')
    expect(queryClient.getQueryData(securityQueryKeys.status('old-user'))).toBeUndefined()
    await act(async () => container.querySelector('button')!.click())
    await flush()
    expect(container.textContent).toBe('Identity ready')
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(FakeSocket.instances).toHaveLength(2)
})

test('drops identity caches before waiting for a changed user route to revalidate', async () => {
    let finishInvalidation!: () => void
    const invalidation = new Promise<void>((resolve) => {
        finishInvalidation = resolve
    })
    invalidateSpy = spyOn(router, 'invalidate').mockReturnValue(invalidation)
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
    await act(async () => socket.deliver({ revision: 'r1', userVersion: 'old-user' }))
    queryClient.setQueryData(securityQueryKeys.status('old-user'), {
        passkeys: ['private-key-name'],
    })
    await act(async () => socket.deliver({ revision: 'r1', userVersion: 'new-user' }))
    expect(container.textContent).toBe('Identity pending')
    expect(queryClient.getQueryData(securityQueryKeys.status('old-user'))).toBeUndefined()
    expect(queryClient.getQueryData(securityQueryKeys.status('new-user'))).toBeUndefined()
    await act(async () => finishInvalidation())
    expect(container.textContent).toBe('Identity ready')
})

test('clears inactive identity data synchronously on tab resume', async () => {
    let finishInvalidation!: () => void
    const invalidation = new Promise<void>((resolve) => {
        finishInvalidation = resolve
    })
    invalidateSpy = spyOn(router, 'invalidate').mockReturnValue(invalidation)
    await act(async () => {
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        )
    })
    queryClient.setQueryData(securityQueryKeys.status('old-user'), {
        passkeys: ['private-key-name'],
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(queryClient.getQueryData(securityQueryKeys.status('old-user'))).toBeUndefined()
    expect(container.textContent).toBe('Identity pending')
    const resumedSocket = FakeSocket.instances.at(-1)!
    await act(async () => resumedSocket.deliver({ revision: 'resumed', userVersion: 'new-user' }))
    expect(container.textContent).toBe('Identity pending')
    await act(async () => finishInvalidation())
    expect(container.textContent).toBe('Identity ready')
})
