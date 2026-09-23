import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider,
} from '@tanstack/react-router'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { PERMISSIONS } from '../config/permissions.config'
import type { CrowdSecConfiguration } from '../shared/Types/crowdsec.types'
import type { FoundationHealth } from '../shared/Types/health.types'
import { foundationStatusQueryKeys } from '../features/FoundationStatus/queryKeys'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const freshHealth: FoundationHealth = {
    controller: { state: 'connected' },
    database: { state: 'connected' },
    redis: { state: 'connected' },
}
const staleHealth: FoundationHealth = {
    controller: { state: 'unavailable' },
    database: { state: 'unavailable' },
    redis: { state: 'unavailable' },
}

let resolveHealth: ((health: FoundationHealth) => void) | undefined
const getFoundationHealthHandlerMock = mock(
    () => new Promise<FoundationHealth>((resolve) => (resolveHealth = resolve)),
)

mock.module('../features/FoundationStatus/server', () => ({
    getFoundationHealthHandler: getFoundationHealthHandlerMock,
}))

const disabledCrowdSec: CrowdSecConfiguration = {
    mode: 'disabled',
    externalApiUrl: null,
    hasApiKey: false,
    synchronized: true,
    runtime: {
        mode: 'disabled',
        state: 'disabled',
        credentialConfigured: false,
        enforcementActive: false,
        managedEngine: 'stopped',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    },
}
let crowdSecConfiguration = disabledCrowdSec
const getCrowdSecConfigurationHandlerMock = mock(async () => crowdSecConfiguration)
mock.module('../features/Admin/CrowdSec/server', () => ({
    getCrowdSecConfigurationHandler: getCrowdSecConfigurationHandlerMock,
}))

const { default: FoundationStatusPage } = await import('../features/FoundationStatus')

class FakeSocket {
    static readonly OPEN = 1
    static instances: FakeSocket[] = []
    readonly readyState = 0
    private readonly listeners = new Set<(event: { data: string }) => void>()

    constructor(readonly url: URL) {
        FakeSocket.instances.push(this)
    }

    close() {
        this.listeners.clear()
    }

    addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'message') this.listeners.add(listener)
    }

    deliver(data: unknown) {
        const event = {
            data: JSON.stringify({
                type: 'snapshot',
                topic: 'foundation',
                query: {},
                payload: data,
            }),
        }
        this.listeners.forEach((listener) => listener(event))
    }
}

const originalSocket = globalThis.WebSocket
let root: Root | null = null
let queryClient: QueryClient | null = null
let container: HTMLElement

async function flush() {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 1_500
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('timed out waiting for overview state')
        // oxlint-disable-next-line no-await-in-loop -- Polling must observe each rendered state in order.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
}

beforeEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('http://localhost:5173/'),
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    resolveHealth = undefined
    getFoundationHealthHandlerMock.mockClear()
    getCrowdSecConfigurationHandlerMock.mockClear()
    crowdSecConfiguration = disabledCrowdSec
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => {
        root?.unmount()
        queryClient?.clear()
    })
    root = null
    queryClient = null
    document.body.replaceChildren()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('keeps a live foundation snapshot when the initial HTTP response arrives late', async () => {
    await act(async () => {
        root?.render(
            withTestLanguage(
                <QueryClientProvider client={queryClient!}>
                    <FoundationStatusPage permissions={[]} />
                </QueryClientProvider>,
            ),
        )
    })
    await flush()
    expect(getFoundationHealthHandlerMock).toHaveBeenCalledTimes(1)
    const socket = FakeSocket.instances[0]
    expect(socket).toBeDefined()
    const client = queryClient!

    await act(async () => {
        socket?.deliver(freshHealth)
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await flush()
    expect(client.getQueryData<FoundationHealth>(foundationStatusQueryKeys.all)).toEqual(
        freshHealth,
    )
    await act(async () => {
        resolveHealth?.(staleHealth)
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await flush()
    expect(client.getQueryData<FoundationHealth>(foundationStatusQueryKeys.all)).toEqual(
        freshHealth,
    )
    expect(getCrowdSecConfigurationHandlerMock).not.toHaveBeenCalled()
})

test('shows CrowdSec state only to users with view permission', async () => {
    const router = createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await act(async () => {
        root?.render(
            withTestLanguage(
                <RouterContextProvider router={router}>
                    <QueryClientProvider client={queryClient!}>
                        <FoundationStatusPage permissions={[PERMISSIONS.CROWDSEC_VIEW]} />
                    </QueryClientProvider>
                </RouterContextProvider>,
            ),
        )
    })
    await waitFor(() => container.querySelector('[data-state="disabled"]') !== null)

    expect(getCrowdSecConfigurationHandlerMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[aria-label="CrowdSec"]')).not.toBeNull()
    expect(container.querySelector('[data-state="disabled"]')?.textContent).toContain('Disabled')
    expect(container.textContent).toContain('Inactive')
    expect(container.textContent).toContain('Manage CrowdSec')
})

test('shows degraded managed protection and pending synchronization without changing foundation health', async () => {
    crowdSecConfiguration = {
        ...disabledCrowdSec,
        mode: 'managed',
        synchronized: false,
        runtime: {
            ...disabledCrowdSec.runtime!,
            mode: 'external',
            state: 'degraded',
            managedEngine: 'degraded',
        },
    }
    const router = createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await act(async () => {
        root?.render(
            withTestLanguage(
                <RouterContextProvider router={router}>
                    <QueryClientProvider client={queryClient!}>
                        <FoundationStatusPage permissions={[PERMISSIONS.CROWDSEC_VIEW]} />
                    </QueryClientProvider>
                </RouterContextProvider>,
            ),
        )
    })
    await waitFor(() => container.querySelector('[data-state="degraded"]') !== null)

    expect(container.querySelector('[data-state="degraded"]')?.textContent).toContain('Degraded')
    expect(container.textContent).toContain('Managed by RentnerProxy')
    expect(container.textContent).toContain('Previous working mode remains active')
    expect(container.textContent).toContain('Active mode: External CrowdSec')
    expect(container.textContent).toContain('Inactive')
})
