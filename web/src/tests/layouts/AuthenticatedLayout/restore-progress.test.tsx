// oxlint-disable no-await-in-loop -- Bounded waits observe serial React and router transitions.
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from '@tanstack/react-router'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Keep the actual layout, restore hooks, identity sync and socket transport; isolate unrelated UI/services.
mock.module('@/layouts/AuthenticatedLayout/Components/ApplicationShell/index.tsx', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
mock.module(
    '@/features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver.tsx',
    () => ({ default: () => null }),
)
mock.module('@/shared/QuickActions/Components/QuickActionsProvider.tsx', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
mock.module('@/shared/PageAlerts/PageAlertsProvider.tsx', () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserThemeModeHandler: async () => {
        throw new Error('Unexpected preference mutation')
    },
    updateCurrentUserNavigationGroupHandler: async () => {
        throw new Error('Unexpected preference mutation')
    },
}))
mock.module('@/features/Auth/middleware.ts', () => ({
    logoutHandler: async () => {
        throw new Error('Unexpected logout')
    },
}))
const { default: AuthenticatedLayout } = await import('@/layouts/AuthenticatedLayout/index.tsx')

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN
    sent: Array<{ type: string; topic?: string; query?: object }> = []
    constructor(readonly url: URL) {
        super()
        FakeSocket.instances.push(this)
    }
    send(value: string) {
        this.sent.push(JSON.parse(value))
    }
    open() {
        this.dispatchEvent(new Event('open'))
    }
    close() {
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }
    deliver(maintenance: unknown, topic = 'backup-restore') {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({
                    type: 'snapshot',
                    topic,
                    query: {},
                    payload: topic === 'backup-restore' ? { maintenance } : maintenance,
                }),
            }),
        )
    }
}

const originalSocket = globalThis.WebSocket
const uuid = (value: number) => `01900000-0000-7000-8000-${String(value).padStart(12, '0')}`
const user: AuthenticatedUser = {
    id: uuid(1),
    displayName: 'Viewer',
    email: 'viewer@example.test',
    profileImageVersion: null,
    roles: [],
    permissions: [PERMISSIONS.APP_ACCESS],
    language: 'en',
    themeMode: 'dark',
}
const running: ManagedBackupMaintenance = {
    id: uuid(2),
    requestId: uuid(3),
    actorId: uuid(4),
    actorName: 'Kevin',
    artifactId: uuid(5),
    metadataSha256: 'a'.repeat(64),
    operation: 'restore',
    state: 'running',
    phase: 'database',
    progressPercent: 42,
    requestedAt: 1_793_448_000_000,
    startedAt: 1_793_448_000_001,
    finishedAt: null,
    error: null,
}

function DraftRoute() {
    const [count, setCount] = useState(0)
    return (
        <div data-route-state>
            <input aria-label="Unfinished draft" defaultValue="original" />
            <button onClick={() => setCount((value) => value + 1)}>Draft count {count}</button>
        </div>
    )
}

function makeRouter() {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const authenticated = createRoute({
        getParentRoute: () => rootRoute,
        id: '_authenticated',
        beforeLoad: () => ({ user, sessionId: 'stable-session' }),
        component: () => <AuthenticatedLayout user={user} />,
    })
    const route = createRoute({
        getParentRoute: () => authenticated,
        path: '/proxy-hosts',
        validateSearch: (value) => ({
            filter: String(value.filter ?? ''),
            page: Number(value.page ?? 1),
        }),
        component: DraftRoute,
    })
    return createRouter({
        routeTree: rootRoute.addChildren([authenticated.addChildren([route])]),
        history: createMemoryHistory({
            initialEntries: ['/proxy-hosts?filter=kept&page=3#details'],
        }),
    })
}

let root: Root | null = null
let client: QueryClient
let router: ReturnType<typeof makeRouter>
let container: HTMLDivElement
const restorers: Array<() => void> = []

async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (check()) return
        await act(async () => {
            await Bun.sleep(10)
        })
    }
    expect(check()).toBeTrue()
}
async function mount() {
    router = makeRouter()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <RouterProvider router={router} />
                </QueryClientProvider>,
            ),
        )
    })
    await waitFor(
        () =>
            !!container.querySelector('[data-route-state]') &&
            !container.querySelector('[data-route-state]')?.closest('[hidden]'),
    )
    await act(async () => FakeSocket.instances.at(-1)!.open())
}
async function deliver(value: unknown, topic?: string) {
    await act(async () => FakeSocket.instances.at(-1)!.deliver(value, topic))
}
function progress() {
    return container.querySelector<HTMLProgressElement>('#restore-progress')
}

beforeEach(() => {
    window.location.href = 'http://localhost/proxy-hosts?filter=kept&page=3#details'
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    for (const restore of restorers.splice(0)) restore()
    client?.clear()
    document.body.replaceChildren()
    globalThis.WebSocket = originalSocket
})

test('APP_ACCESS-only users see the global actor, backup and genuine checkpoint percentage', async () => {
    await mount()
    expect(user.permissions).not.toContain(PERMISSIONS.BACKUPS_VIEW)
    expect(FakeSocket.instances[0]!.sent).toContainEqual({
        type: 'subscribe',
        topic: 'backup-restore',
        query: {},
    })
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    expect(container.textContent).toContain('Kevin')
    expect(container.textContent).toContain(running.artifactId)
    expect(container.textContent).toContain('42%')
    expect(container.textContent).toContain('Restoring the database')
    expect(container.querySelector('[data-route-state]')?.closest('[hidden]')).not.toBeNull()
})

test('restore preserves the route, search, scroll and mounted drafts until confirmed cache refresh completes', async () => {
    await mount()
    const routeState = container.querySelector<HTMLElement>('[data-route-state]')!
    const draft = routeState.querySelector('input')!
    draft.value = 'unfinished work'
    routeState.scrollTop = 327
    await act(async () => routeState.querySelector('button')!.click())
    const originalHref = router.state.location.href
    client.setQueryData(['before-restore'], { stale: true })
    const calls: string[] = []
    const clear = client.clear.bind(client)
    const clearSpy = spyOn(client, 'clear').mockImplementation(() => {
        calls.push('clear')
        clear()
    })
    const cancelSpy = spyOn(client, 'cancelQueries').mockImplementation(async () => {
        calls.push('cancel')
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const invalidate = spyOn(router, 'invalidate').mockImplementation(async () => {
        calls.push('invalidate')
        expect(client.getQueryData(['before-restore'])).toBeUndefined()
        await gate
    })
    const navigate = spyOn(router, 'navigate')
    restorers.push(() => {
        clearSpy.mockRestore()
        cancelSpy.mockRestore()
        invalidate.mockRestore()
        navigate.mockRestore()
    })
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    expect(calls).toEqual([])
    await deliver({
        ...running,
        state: 'succeeded',
        phase: 'complete',
        progressPercent: 100,
        finishedAt: running.startedAt! + 1000,
    })
    await waitFor(() => calls.includes('invalidate'))
    expect(calls.slice(0, 3)).toEqual(['cancel', 'clear', 'invalidate'])
    expect(progress()?.value).toBe(100)
    expect(router.state.location.href).toBe(originalHref)
    expect(routeState.scrollTop).toBe(327)
    await act(async () => release())
    await waitFor(() => !progress())
    expect(router.state.location.href).toBe(originalHref)
    expect(router.state.location.search).toEqual({ filter: 'kept', page: 3 })
    expect(navigate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-route-state]')).toBe(routeState)
    expect(container.querySelector('input')).toBe(draft)
    expect(draft.value).toBe('unfinished work')
    expect(routeState.textContent).toContain('Draft count 1')
    expect(routeState.scrollTop).toBe(327)
})

test('empty, invalid and disconnected snapshots retain the last confirmed stage without advancing', async () => {
    await mount()
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    await deliver(null)
    await deliver({ ...running, progressPercent: 101 })
    await deliver({ ...running, operation: 'delete', progressPercent: 100, state: 'succeeded' })
    expect(progress()?.value).toBe(42)
    await act(async () => FakeSocket.instances.at(-1)!.close())
    await waitFor(
        () => container.textContent?.includes('completion has not yet been confirmed') === true,
    )
    expect(progress()?.value).toBe(42)
    expect(container.textContent).not.toContain('Restore and service recovery confirmed')
})

test('terminal failures stay visible and unrelated or historical successes cannot dismiss them', async () => {
    await mount()
    const clear = spyOn(client, 'clear')
    const invalidate = spyOn(router, 'invalidate')
    restorers.push(() => {
        clear.mockRestore()
        invalidate.mockRestore()
    })
    await deliver({ ...running, state: 'succeeded', phase: 'complete', progressPercent: 100 })
    await deliver({ ...running, state: 'failed', error: 'execution_failed' })
    expect(progress()).toBeNull()
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    await deliver({
        ...running,
        state: 'failed',
        error: 'execution_failed',
        finishedAt: running.startedAt! + 1000,
    })
    await waitFor(
        () =>
            container.textContent?.includes(
                'Restore failed or service recovery could not be confirmed',
            ) === true,
    )
    await deliver({
        ...running,
        id: uuid(99),
        state: 'succeeded',
        phase: 'complete',
        progressPercent: 100,
    })
    await deliver(null)
    expect(progress()?.value).toBe(42)
    expect(clear).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
})

test('application identity snapshots are suspended throughout the destructive restore', async () => {
    await mount()
    const socket = FakeSocket.instances.at(-1)!
    expect(socket.sent).toContainEqual({ type: 'subscribe', topic: 'app-events', query: {} })
    await deliver({ revision: 'before', userVersion: 'viewer' }, 'app-events')
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    expect(socket.sent).toContainEqual({ type: 'unsubscribe', topic: 'app-events' })
    const invalidate = spyOn(router, 'invalidate')
    restorers.push(() => invalidate.mockRestore())
    await deliver({ revision: 'restored-database', userVersion: 'different' }, 'app-events')
    expect(invalidate).not.toHaveBeenCalled()
    expect(progress()?.value).toBe(42)
})

test.each(['queued', 'validating'] as const)(
    'a failed %s preflight can return to the preserved page without claiming successful restore',
    async (phase) => {
        await mount()
        const routeState = container.querySelector<HTMLElement>('[data-route-state]')!
        const draft = routeState.querySelector('input')!
        draft.value = 'preflight draft'
        routeState.scrollTop = 219
        const originalHref = router.state.location.href
        client.setQueryDefaults(['preflight-cache'], { gcTime: Infinity })
        client.setQueryData(['preflight-cache'], { preserved: true })
        const clear = spyOn(client, 'clear')
        restorers.push(() => clear.mockRestore())
        await deliver({
            ...running,
            phase,
            state: phase === 'queued' ? 'queued' : 'running',
            progressPercent: 5,
        })
        await waitFor(() => progress()?.value === 5)
        const failure = {
            ...running,
            phase,
            state: 'failed',
            progressPercent: 5,
            error: 'artifact_invalid',
            finishedAt: running.startedAt! + 1000,
        }
        await deliver(failure)
        const dismissButton = () =>
            container.querySelector<HTMLButtonElement>(
                'main[aria-labelledby="restore-progress-title"] button',
            )
        await waitFor(() => !!dismissButton())
        expect(container.textContent).toContain(
            'Restore failed or service recovery could not be confirmed',
        )
        expect(container.textContent).not.toContain('Restore and service recovery confirmed')
        await act(async () => dismissButton()!.click())
        await waitFor(() => !progress() && !routeState.closest('[hidden]'))
        expect(clear).not.toHaveBeenCalled()
        expect(client.getQueryData(['preflight-cache'])).toEqual({ preserved: true })
        expect(container.querySelector('[data-route-state]')).toBe(routeState)
        expect(container.querySelector('input')).toBe(draft)
        expect(draft.value).toBe('preflight draft')
        expect(routeState.scrollTop).toBe(219)
        expect(router.state.location.href).toBe(originalHref)
        await deliver(failure)
        expect(progress()).toBeNull()
        expect(container.textContent).not.toContain('Restore and service recovery confirmed')
    },
)

test.each(['quiescing', 'database', 'controller', 'crowdsec', 'secrets', 'restarting'] as const)(
    'a failed destructive %s restore keeps its recovery screen without a return button',
    async (phase) => {
        await mount()
        await deliver({ ...running, phase })
        await waitFor(() => !!progress())
        await deliver({
            ...running,
            phase,
            state: 'failed',
            error: 'execution_failed',
            finishedAt: running.startedAt! + 1000,
        })
        await waitFor(
            () =>
                container.textContent?.includes(
                    'Restore failed or service recovery could not be confirmed',
                ) === true,
        )
        expect(
            container.querySelector('main[aria-labelledby="restore-progress-title"] button'),
        ).toBeNull()
        expect(container.querySelector('[data-route-state]')?.closest('[hidden]')).not.toBeNull()
        expect(progress()?.value).toBe(42)
    },
)

test('an unauthorized socket revalidates identity while retaining the unconfirmed restore screen', async () => {
    await mount()
    await deliver(running)
    await waitFor(() => progress()?.value === 42)
    client.setQueryDefaults(['held-restore-cache'], { gcTime: Infinity })
    client.setQueryData(['held-restore-cache'], 'awaiting confirmation')
    const clear = spyOn(client, 'clear')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const invalidate = spyOn(router, 'invalidate').mockImplementation(async () => {
        await gate
    })
    restorers.push(() => {
        clear.mockRestore()
        invalidate.mockRestore()
    })
    await act(async () =>
        FakeSocket.instances.at(-1)!.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({ type: 'unauthorized' }),
            }),
        ),
    )
    await waitFor(() => invalidate.mock.calls.length > 0)
    expect(invalidate).toHaveBeenCalledWith({ sync: true })
    expect(progress()?.value).toBe(42)
    expect(clear).not.toHaveBeenCalled()
    expect(client.getQueryData(['held-restore-cache'])).toBe('awaiting confirmation')
    expect(container.textContent).not.toContain('Restore and service recovery confirmed')
    await act(async () => release())
    expect(progress()?.value).toBe(42)
})
