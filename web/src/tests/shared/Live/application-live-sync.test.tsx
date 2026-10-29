import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
    RouterContextProvider,
} from '@tanstack/react-router'
import { Activity, act, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

import { auditLogsQueryKeys } from '@/lib/Admin/AuditLogs/auditLogsCache.ts'
import { proxyAccessLogsQueryKeys } from '@/lib/Admin/ProxyAccessLogs/proxyAccessLogsCache.ts'
import { foundationStatusQueryKeys } from '@/lib/FoundationStatus/foundationStatusCache.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import useApplicationLiveSync from '@/shared/Live/Hooks/useApplicationLiveSync.ts'
import { securityQueryKeys } from '@/lib/UserSettings/userSettingsCache.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

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
let retryIdentityForTest: (() => void) | undefined
const initialRouterState = router.state
const originalStateDescriptor = Object.getOwnPropertyDescriptor(router, 'state')
const user: AuthenticatedUser = {
    id: 'old-user',
    displayName: 'User',
    email: 'user@example.test',
    profileImageVersion: null,
    roles: ['owner'],
    permissions: ['app.access'],
    language: 'en',
    themeMode: 'dark',
}
let confirmedContext = { user, sessionId: 'session-a' }
let authMatchStatus: 'success' | 'error' | 'pending' = 'success'
let authMatchInvalid = false
let routerLoading = false

function ActiveQueryProbe() {
    const [mfa, setMfa] = useState('')
    useQuery({
        queryKey: ['application-live', 'active'],
        queryFn: async () => {
            activeFetches += 1
            return activeFetches
        },
    })
    return (
        <>
            <input aria-label="Draft" defaultValue="" />
            <button type="button" data-stage-mfa onClick={() => setMfa('private-mfa-secret')}>
                Stage MFA
            </button>
            <span data-mfa>{mfa}</span>
            {mfa ? createPortal(<div data-private-portal>{mfa}</div>, document.body) : null}
        </>
    )
}

function Probe() {
    const { isIdentityPending, identityGeneration, hasIdentityError, retryIdentity } =
        useApplicationLiveSync()
    useEffect(() => {
        retryIdentityForTest = retryIdentity
        return () => {
            if (retryIdentityForTest === retryIdentity) retryIdentityForTest = undefined
        }
    }, [retryIdentity])
    return (
        <div>
            {hasIdentityError ? (
                <button type="button" onClick={retryIdentity}>
                    Retry identity
                </button>
            ) : isIdentityPending ? (
                <output>Identity pending</output>
            ) : null}
            <Activity mode={isIdentityPending ? 'hidden' : 'visible'} key={identityGeneration}>
                <div data-protected hidden={isIdentityPending} inert={isIdentityPending}>
                    <ActiveQueryProbe />
                    Identity ready
                </div>
            </Activity>
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
    confirmedContext = { user, sessionId: 'session-a' }
    authMatchStatus = 'success'
    authMatchInvalid = false
    routerLoading = false
    Object.defineProperty(router, 'state', {
        configurable: true,
        get: () => ({
            ...initialRouterState,
            status: routerLoading ? 'pending' : 'idle',
            isLoading: routerLoading,
            matches: [
                {
                    routeId: '/_authenticated',
                    status: authMatchStatus,
                    invalid: authMatchInvalid,
                    context: confirmedContext,
                },
            ],
        }),
    })
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
    if (originalStateDescriptor) Object.defineProperty(router, 'state', originalStateDescriptor)
    else Reflect.deleteProperty(router, 'state')
})

test('refreshes active queries and marks inactive queries stale when the application changes', async () => {
    const invalidate = spyOn(router, 'invalidate').mockResolvedValue(undefined)
    invalidateSpy = invalidate
    await act(async () => {
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        )
    })
    queryClient.setQueryData(['application-live', 'inactive'], 'stale')
    queryClient.setQueryData(proxyAccessLogsQueryKeys.list({ offset: 0 }), 'websocket-owned')
    queryClient.setQueryData(auditLogsQueryKeys.list({}), 'websocket-owned')
    queryClient.setQueryData(auditLogsQueryKeys.actors(), 'http-owned')
    queryClient.setQueryData(foundationStatusQueryKeys.all, 'websocket-owned')
    queryClient.setQueryData(crowdSecQueryKeys.configuration, 'websocket-owned')
    queryClient.setQueryData(crowdSecQueryKeys.forwardAuthSummary, 'websocket-owned')
    queryClient.setQueryData([...crowdSecQueryKeys.dashboard, { offset: 0 }], 'websocket-owned')

    const baselineFetches = activeFetches
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.deliver({ revision: 'r1', userVersion: 'u1' }))
    await flush()
    expect(activeFetches).toBe(baselineFetches + 1)
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
    expect(activeFetches).toBe(baselineFetches + 1)
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => socket.deliver({ revision: 'r2', userVersion: 'u1' }))
    await flush()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(activeFetches).toBe(baselineFetches + 2)

    await act(async () =>
        FakeSocket.instances.at(-1)!.deliver({ revision: 'r2', userVersion: 'u2' }),
    )
    await flush()
    expect(invalidate).toHaveBeenCalledTimes(2)
})

test('revalidates and reconnects without clearing a still-authorized identity after a topic denial', async () => {
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
    queryClient.setQueryData(['application-live', 'cached'], 'value')
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.deliverUnauthorized())
    await flush()

    expect(queryClient.getQueryData(['application-live', 'cached'])).toBe('value')
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(socket.closed).toBe(true)
})

async function mountProbe() {
    await act(async () =>
        root.render(
            <RouterContextProvider router={router}>
                <QueryClientProvider client={queryClient}>
                    <Probe />
                </QueryClientProvider>
            </RouterContextProvider>,
        ),
    )
}

async function resumeTab() {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
}

function expectProtectedHidden() {
    const protectedContent = container.querySelector<HTMLElement>('[data-protected]')
    expect(
        protectedContent === null ||
            protectedContent.hidden ||
            protectedContent.style.display === 'none',
    ).toBe(true)
    const portal = document.querySelector<HTMLElement>('[data-private-portal]')
    expect(portal === null || portal.style.display === 'none').toBe(true)
}

test('keeps identity data hidden after revalidation fails and provides a successful retry', async () => {
    invalidateSpy = spyOn(router, 'invalidate')
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined)
    await mountProbe()
    queryClient.setQueryData([...securityQueryKeys.status, 'old-user'], {
        passkeys: ['Private laptop'],
    })
    const draft = container.querySelector<HTMLInputElement>('input')!
    draft.value = 'unfinished draft'
    await act(async () => container.querySelector<HTMLButtonElement>('[data-stage-mfa]')!.click())
    await act(async () => FakeSocket.instances[0]!.deliverUnauthorized())
    await flush()
    expect(container.querySelector('button')?.textContent).toBe('Retry identity')
    expectProtectedHidden()
    expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toEqual({
        passkeys: ['Private laptop'],
    })
    await act(async () => container.querySelector('button')!.click())
    await flush()
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
    expect(container.querySelector('input') === draft).toBe(true)
    expect(draft.value).toBe('unfinished draft')
    expect(container.querySelector('[data-mfa]')?.textContent).toBe('private-mfa-secret')
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(FakeSocket.instances).toHaveLength(2)
})

test.each(['account', 'session', 'permissions'] as const)(
    'clears and remounts private state only after a confirmed %s change',
    async (kind) => {
        let finishInvalidation!: () => void
        const invalidation = new Promise<void>((resolve) => {
            finishInvalidation = resolve
        })
        invalidateSpy = spyOn(router, 'invalidate').mockReturnValue(invalidation)
        await mountProbe()
        const draft = container.querySelector<HTMLInputElement>('input')!
        draft.value = 'private draft'
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[data-stage-mfa]')!.click(),
        )
        queryClient.setQueryData([...securityQueryKeys.status, 'old-user'], {
            passkeys: ['private-key-name'],
        })
        await resumeTab()
        expectProtectedHidden()
        expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toEqual({
            passkeys: ['private-key-name'],
        })
        confirmedContext =
            kind === 'account'
                ? { user: { ...user, id: 'new-user' }, sessionId: 'session-b' }
                : kind === 'session'
                  ? { user, sessionId: 'session-b' }
                  : {
                        user: { ...user, permissions: [...user.permissions, 'account.view'] },
                        sessionId: 'session-a',
                    }
        await act(async () => finishInvalidation())
        expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toBeUndefined()
        expect(queryClient.getQueryData([...securityQueryKeys.status, 'new-user'])).toBeUndefined()
        expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
        expect(container.querySelector('input') === draft).toBe(false)
        expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('')
        expect(container.querySelector('[data-mfa]')?.textContent).toBe('')
        expect(document.querySelector('[data-private-portal]') === null).toBe(true)
    },
)

test('preserves drafts, local MFA and cached query objects across a same-session resume', async () => {
    let finishInvalidation!: () => void
    const invalidation = new Promise<void>((resolve) => {
        finishInvalidation = resolve
    })
    invalidateSpy = spyOn(router, 'invalidate').mockReturnValue(invalidation)
    await mountProbe()
    const draft = container.querySelector<HTMLInputElement>('input')!
    draft.value = 'unfinished draft'
    await act(async () => container.querySelector<HTMLButtonElement>('[data-stage-mfa]')!.click())
    queryClient.setQueryData([...securityQueryKeys.status, 'old-user'], {
        passkeys: ['private-key-name'],
    })
    const cachedQuery = queryClient
        .getQueryCache()
        .find({ queryKey: [...securityQueryKeys.status, 'old-user'] })
    const activeQuery = queryClient
        .getQueryCache()
        .find({ queryKey: ['application-live', 'active'] })
    await resumeTab()
    expectProtectedHidden()
    expect(container.querySelector('output')?.textContent).toBe('Identity pending')
    const resumedSocket = FakeSocket.instances.at(-1)!
    await act(async () =>
        resumedSocket.deliver({ revision: 'raced-snapshot', userVersion: 'unverified-user' }),
    )
    expectProtectedHidden()
    await act(async () => finishInvalidation())
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
    expect(container.querySelector('input') === draft).toBe(true)
    expect(draft.value).toBe('unfinished draft')
    expect(container.querySelector('[data-mfa]')?.textContent).toBe('private-mfa-secret')
    expect(
        queryClient.getQueryCache().find({ queryKey: [...securityQueryKeys.status, 'old-user'] }),
    ).toBe(cachedQuery)
    expect(queryClient.getQueryCache().find({ queryKey: ['application-live', 'active'] })).toBe(
        activeQuery,
    )
    expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toEqual({
        passkeys: ['private-key-name'],
    })
})

test('isolates unknown initial account caches before the first protected render', async () => {
    queryClient.setQueryData([...securityQueryKeys.status, 'unconfirmed-user'], {
        passkeys: ['never reveal'],
    })
    await mountProbe()
    expect(
        queryClient.getQueryData([...securityQueryKeys.status, 'unconfirmed-user']),
    ).toBeUndefined()
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
    expect(container.textContent).not.toContain('never reveal')
})

test.each([false, true])(
    'an obsolete overlapping resume cannot clear caches or release a newer check (rejected: %s)',
    async (rejected) => {
        let finishFirst!: () => void
        let rejectFirst!: (error: Error) => void
        let finishSecond!: () => void
        const first = new Promise<void>((resolve, reject) => {
            finishFirst = resolve
            rejectFirst = reject
        })
        const second = new Promise<void>((resolve) => {
            finishSecond = resolve
        })
        invalidateSpy = spyOn(router, 'invalidate')
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(second)
        await mountProbe()
        const draft = container.querySelector<HTMLInputElement>('input')!
        draft.value = 'keep this draft'
        queryClient.setQueryData([...securityQueryKeys.status, 'old-user'], {
            passkeys: ['cached'],
        })
        await resumeTab()
        await act(async () => retryIdentityForTest!())
        confirmedContext = { user: { ...user, id: 'obsolete-user' }, sessionId: 'obsolete-session' }
        await act(async () => {
            if (rejected) rejectFirst(new Error('obsolete failure'))
            else finishFirst()
        })
        expectProtectedHidden()
        expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toEqual({
            passkeys: ['cached'],
        })
        confirmedContext = { user, sessionId: 'session-a' }
        await act(async () => finishSecond())
        expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
        expect(container.querySelector('input') === draft).toBe(true)
        expect(draft.value).toBe('keep this draft')
        expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toEqual({
            passkeys: ['cached'],
        })
    },
)

test.each(['error', 'pending', 'invalid', 'redirect'] as const)(
    'a fulfilled invalidate with an unconfirmed %s auth match stays hidden and can retry',
    async (kind) => {
        invalidateSpy = spyOn(router, 'invalidate').mockResolvedValue(undefined)
        await mountProbe()
        await act(async () =>
            container.querySelector<HTMLButtonElement>('[data-stage-mfa]')!.click(),
        )
        authMatchStatus = kind === 'error' || kind === 'pending' ? kind : 'success'
        authMatchInvalid = kind === 'invalid'
        routerLoading = kind === 'redirect'
        await resumeTab()
        expectProtectedHidden()
        expect(container.querySelector('button')?.textContent).toBe('Retry identity')
        authMatchStatus = 'success'
        authMatchInvalid = false
        routerLoading = false
        await act(async () => container.querySelector('button')!.click())
        expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
        expect(invalidateSpy).toHaveBeenCalledTimes(2)
    },
)

test('initial stale context from an unsuccessful match cannot reveal inherited caches', async () => {
    invalidateSpy = spyOn(router, 'invalidate').mockResolvedValue(undefined)
    authMatchStatus = 'error'
    queryClient.setQueryData([...securityQueryKeys.status, 'old-user'], {
        passkeys: ['never reveal'],
    })
    await mountProbe()
    expectProtectedHidden()
    expect(queryClient.getQueryData([...securityQueryKeys.status, 'old-user'])).toBeUndefined()
    expect(container.querySelector('button')?.textContent).toBe('Retry identity')
    authMatchStatus = 'success'
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
})

test('a real memory router completes first auth verification after its initial rendered transition', async () => {
    const observedErrors: boolean[] = []
    const observedPending: boolean[] = []
    function InitialRouteProbe() {
        const live = useApplicationLiveSync()
        observedErrors.push(live.hasIdentityError)
        observedPending.push(live.isIdentityPending)
        return (
            <div data-initial-state>
                {live.hasIdentityError ? 'Retry' : live.isIdentityPending ? 'Checking' : 'Ready'}
            </div>
        )
    }
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const authenticatedRoute = createRoute({
        getParentRoute: () => rootRoute,
        id: '_authenticated',
        beforeLoad: () => ({ user, sessionId: 'real-initial-session' }),
        component: InitialRouteProbe,
    })
    const indexRoute = createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: () => null,
    })
    const memoryRouter = createRouter({
        routeTree: rootRoute.addChildren([authenticatedRoute.addChildren([indexRoute])]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    queryClient.setQueryData([...securityQueryKeys.status, 'unconfirmed-user'], {
        passkeys: ['never reveal'],
    })
    await act(async () =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={memoryRouter} />
            </QueryClientProvider>,
        ),
    )
    await flush()
    expect(observedPending).toContain(true)
    expect(observedErrors).not.toContain(true)
    expect(container.querySelector('[data-initial-state]')?.textContent).toBe('Ready')
    expect(memoryRouter.state.status).toBe('idle')
    expect(
        queryClient.getQueryData([...securityQueryKeys.status, 'unconfirmed-user']),
    ).toBeUndefined()
})

test('initial onResolved cannot overtake an explicit newer session check', async () => {
    routerLoading = true
    queryClient.setQueryData([...securityQueryKeys.status, 'unconfirmed-user'], {
        passkeys: ['held while hidden'],
    })
    let finishInvalidation!: () => void
    const invalidation = new Promise<void>((resolve) => {
        finishInvalidation = resolve
    })
    invalidateSpy = spyOn(router, 'invalidate').mockReturnValue(invalidation)
    await mountProbe()
    expectProtectedHidden()
    expect(container.querySelector('output')?.textContent).toBe('Identity pending')
    expect(container.textContent).not.toContain('Retry identity')
    await act(async () => retryIdentityForTest!())
    routerLoading = false
    confirmedContext = {
        user: { ...user, id: 'obsolete-initial-user' },
        sessionId: 'obsolete-initial-session',
    }
    await act(async () =>
        router.emit({
            type: 'onResolved',
            fromLocation: initialRouterState.location,
            toLocation: initialRouterState.location,
            pathChanged: false,
            hrefChanged: false,
            hashChanged: false,
        }),
    )
    expectProtectedHidden()
    expect(queryClient.getQueryData([...securityQueryKeys.status, 'unconfirmed-user'])).toEqual({
        passkeys: ['held while hidden'],
    })
    confirmedContext = { user, sessionId: 'session-a' }
    await act(async () => finishInvalidation())
    expect(container.querySelector<HTMLElement>('[data-protected]')?.hidden).toBe(false)
    expect(
        queryClient.getQueryData([...securityQueryKeys.status, 'unconfirmed-user']),
    ).toBeUndefined()
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
})
