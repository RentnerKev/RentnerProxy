import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
    CrowdSecDecision,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type { ProxyRuntimeSyncStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { scenarioDescriptionKey } from '@/lib/Admin/CrowdSec/scenarioDescription.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { LiveTopic } from '@/lib/Live/Types/realtime.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestPageAlerts, openPageAlerts } =
    await import('@/tests/Helpers/withTestPageAlerts.tsx')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = []
    static OPEN = 1
    static CLOSED = 3
    readyState = FakeSocket.OPEN
    sent: string[] = []

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
        this.readyState = FakeSocket.CLOSED
        this.dispatchEvent(new Event('close'))
    }

    deliver(topic: LiveTopic, payload: unknown, query: object = {}) {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify({ type: 'snapshot', topic, query, payload }),
            }),
        )
    }
}

const originalSocket = globalThis.WebSocket

const decisions: CrowdSecDecision[] = Array.from({ length: 24 }, (_, index) => ({
    id: 24 - index,
    scope: index === 0 ? 'Range' : 'Ip',
    value: index === 0 ? '2001:db8::/64' : `203.0.113.${index + 1}`,
    origin: index % 2 === 0 ? 'crowdsec' : 'CAPI',
    scenario: index === 0 ? 'crowdsecurity/http-generic-bf' : 'crowdsecurity/http-probing',
    duration: '2h',
    countryCode: index === 1 ? 'DE' : null,
}))

const configuration: CrowdSecConfiguration = {
    mode: 'managed',
    communityEnabled: false,
    externalApiUrl: null,
    hasApiKey: false,
    synchronized: true,
    runtime: {
        mode: 'managed',
        state: 'connected',
        credentialConfigured: true,
        enforcementActive: true,
        managedEngine: 'ready',
        communityEnabled: false,
        communityState: 'disabled',
        consoleState: 'not_enrolled',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    },
}

let blockedMetricsAvailable = true
let configurationFetchFails = false
let configurationGate: Promise<CrowdSecConfiguration> | null = null
const configurationMock = mock(async () => {
    if (configurationGate) return configurationGate
    if (configurationFetchFails) throw new Error('private connection diagnostics')
    return configuration
})
const dashboardMock = mock(
    async ({ data }: { data: CrowdSecDashboardQuery }): Promise<CrowdSecDashboard> => {
        const search = data.search.toLowerCase()
        const filtered = decisions.filter(
            (decision) =>
                (!data.origin || decision.origin === data.origin) &&
                (!data.scope || decision.scope === data.scope) &&
                (!search ||
                    `${decision.value} ${decision.origin} ${decision.scenario}`
                        .toLowerCase()
                        .includes(search)),
        )
        return {
            collectedAt: 1_800_000_000,
            metrics: {
                blockedRequests: blockedMetricsAvailable ? 1_256 : null,
                activeDecisions: 15_004,
                blockedByOrigin: blockedMetricsAvailable
                    ? [{ origin: 'crowdsec', count: 1_256 }]
                    : [],
                decisionsByOrigin: [{ origin: 'CAPI', count: 15_004 }],
            },
            decisions: {
                total: decisions.length,
                filteredTotal: filtered.length,
                offset: data.offset,
                limit: data.limit,
                availableOrigins: ['CAPI', 'crowdsec'],
                entries: filtered.slice(data.offset, data.offset + data.limit),
            },
        }
    },
)

const accessPolicies: AccessPolicySummary[] = [
    {
        id: '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6071',
        name: 'Staff SSO',
        description: '',
        mode: 'authenticated',
        combination: null,
        ipRules: null,
        forwardAuth: {
            provider: 'authelia',
            endpoint: 'http://auth.internal/api/authz/forward-auth',
            timeoutSeconds: 5,
            gatewayPathPrefix: null,
            requestHeaders: ['Cookie'],
            responseHeaders: ['Remote-Email', 'Remote-User'],
        },
        assignedHostCount: 3,
        basicAuthAccountCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    {
        id: '0192b7d4-4e59-7c6d-8a1b-2c3d4e5f6072',
        name: 'Office IP',
        description: '',
        mode: 'ip-restricted',
        combination: null,
        ipRules: null,
        forwardAuth: null,
        assignedHostCount: 1,
        basicAuthAccountCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
]
const getAccessPoliciesMock = mock(async () => accessPolicies)
const getAccessPolicyRuntimeStatusMock = mock(async (): Promise<ProxyRuntimeSyncStatus> => ({
    available: true,
    running: true,
    activeRevision: 'sha256:active',
    desiredRevision: 'sha256:active',
    lastApplyAt: '2026-01-02T12:00:00.000Z',
    state: 'synced',
}))

const forwardAuthSummaryMock = mock(async () => {
    const [policies, runtime] = await Promise.all([
        getAccessPoliciesMock(),
        getAccessPolicyRuntimeStatusMock(),
    ])
    const forwardAuthPolicies = policies.filter((policy) => policy.forwardAuth !== null)
    return {
        policyCount: forwardAuthPolicies.length,
        assignedHosts: forwardAuthPolicies.reduce(
            (total, policy) => total + policy.assignedHostCount,
            0,
        ),
        runtimeState: runtime.state,
    }
})

mock.module('@/features/Admin/CrowdSec/middleware.ts', () => ({
    getCrowdSecConfigurationHandler: configurationMock,
    getCrowdSecDashboardHandler: dashboardMock,
    getForwardAuthSummaryHandler: forwardAuthSummaryMock,
}))
const { default: SecurityDashboardPage } =
    await import('@/features/Admin/CrowdSec/Components/SecurityDashboardPage/index.tsx')
const { default: CrowdSecDashboardPanel } =
    await import('@/features/Admin/CrowdSec/Components/CrowdSecDashboardPanel/index.tsx')
const { default: ForwardAuthSummaryPanel } =
    await import('@/features/Admin/CrowdSec/Components/ForwardAuthSummaryPanel/index.tsx')

let root: Root | null = null
let queryClient: InstanceType<typeof QueryClient> | null = null

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('dashboard did not reach expected state')
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each poll observes the next rendered state.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
        })
    }
}

async function renderDashboard(): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <TooltipProvider>
                    <QueryClientProvider client={queryClient!}>
                        <ForwardAuthSummaryPanel />
                        <CrowdSecDashboardPanel configuration={configuration} />
                    </QueryClientProvider>
                </TooltipProvider>,
            ),
        )
    })
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    return container
}

async function renderPage(
    permissions: readonly string[] = [PERMISSIONS.CROWDSEC_VIEW, PERMISSIONS.ACCESS_POLICIES_VIEW],
): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    root = createRoot(container)
    const route = createRootRoute()
    const router = createRouter({
        routeTree: route.addChildren([
            createRoute({ getParentRoute: () => route, path: '/' }),
            createRoute({ getParentRoute: () => route, path: '/crowdsec' }),
        ]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await act(async () => {
        root?.render(
            withTestLanguage(
                withTestPageAlerts(
                    <QueryClientProvider client={queryClient!}>
                        <RouterContextProvider router={router}>
                            <main>
                                <SecurityDashboardPage permissions={permissions} />
                            </main>
                        </RouterContextProvider>
                    </QueryClientProvider>,
                ),
            ),
        )
    })
    return container
}

beforeEach(() => {
    window.location.href = 'http://localhost:5173/security'
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    blockedMetricsAvailable = true
    configurationFetchFails = false
    configurationGate = null
    configurationMock.mockClear()
    dashboardMock.mockClear()
    getAccessPoliciesMock.mockClear()
    getAccessPolicyRuntimeStatusMock.mockClear()
    forwardAuthSummaryMock.mockClear()
})

test('moves configuration failures into the navbar and disables retry until recovery completes', async () => {
    configurationFetchFails = true
    const container = await renderPage()
    await waitFor(() => container.querySelector('button[data-severity="error"]') !== null)
    expect(container.querySelector('main')?.textContent).not.toContain('Try again')
    expect(container.textContent).not.toContain('private connection diagnostics')
    const details = await openPageAlerts()
    const retry = [...details.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again',
    )!
    expect(retry).toBeDefined()
    const retryRequest = Promise.withResolvers<CrowdSecConfiguration>()
    configurationGate = retryRequest.promise
    await act(async () => retry.click())
    await waitFor(() => retry.disabled)
    await act(async () => retry.click())
    expect(configurationMock).toHaveBeenCalledTimes(2)
    await act(async () => {
        configurationGate = null
        configurationFetchFails = false
        retryRequest.resolve(configuration)
    })
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    await waitFor(() => container.querySelector('button[data-severity]') === null)
    expect(document.querySelector('[role="dialog"][aria-label="Page alerts"]')).toBeNull()
})

test('retains cached dashboard data when configuration refresh fails and clears the navbar alert after retry', async () => {
    const container = await renderPage()
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    configurationFetchFails = true
    await act(async () => {
        await queryClient?.refetchQueries({
            queryKey: crowdSecQueryKeys.configuration,
            exact: true,
        })
    })
    await waitFor(() => container.querySelector('button[data-severity="error"]') !== null)
    expect(container.querySelector('main')?.textContent).toContain('2001:db8::/64')
    const details = await openPageAlerts()
    const retry = [...details.querySelectorAll('button')].find(
        (button) => button.textContent === 'Try again',
    )!
    configurationFetchFails = false
    await act(async () => retry.click())
    await waitFor(() => container.querySelector('button[data-severity]') === null)
    expect(container.querySelector('main')?.textContent).toContain('2001:db8::/64')
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    queryClient?.clear()
    queryClient = null
    document.body.replaceChildren()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('updates CrowdSec metrics and bans from socket snapshots without refresh controls or extra HTTP reads', async () => {
    const container = await renderPage()
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    expect(container.querySelector('a[href="/crowdsec"]')).toBeNull()
    expect(
        [...container.querySelectorAll('button')].some((button) =>
            button.textContent?.includes('Refresh'),
        ),
    ).toBe(false)
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.open())
    const request = dashboardMock.mock.calls[0]![0].data
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
        type: 'subscribe',
        topic: 'crowdsec-dashboard',
        query: request,
    })
    const initialReads = dashboardMock.mock.calls.length
    const snapshot = await dashboardMock({ data: request })
    dashboardMock.mockClear()
    await act(async () =>
        socket.deliver(
            'crowdsec-dashboard',
            {
                ...snapshot,
                collectedAt: snapshot.collectedAt + 2,
                metrics: { ...snapshot.metrics!, blockedRequests: 9_876 },
                decisions: {
                    ...snapshot.decisions!,
                    entries: [{ ...decisions[0]!, value: '198.51.100.99' }],
                },
            },
            request,
        ),
    )
    await waitFor(() => container.textContent?.includes('198.51.100.99') === true)
    expect(container.textContent).toContain('9,876')
    expect(initialReads).toBe(1)
    expect(dashboardMock).not.toHaveBeenCalled()
})

test('recovers a failed configuration read through the socket and tracks enforcement changes', async () => {
    configurationFetchFails = true
    const container = await renderPage()
    await waitFor(() => container.querySelector('button[data-severity="error"]') !== null)
    const socket = FakeSocket.instances[0]!
    await act(async () => {
        socket.open()
        socket.deliver('crowdsec-configuration', configuration)
    })
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    expect(container.querySelector('button[data-severity="error"]')).toBeNull()
    expect(configurationMock).toHaveBeenCalledTimes(1)
    await act(async () =>
        socket.deliver('crowdsec-configuration', {
            ...configuration,
            mode: 'disabled',
            runtime: { ...configuration.runtime!, mode: 'disabled', enforcementActive: false },
        }),
    )
    await waitFor(() => container.querySelector('table') === null)
    expect(socket.sent.map((message) => JSON.parse(message))).toContainEqual({
        type: 'unsubscribe',
        topic: 'crowdsec-dashboard',
    })
})

test('updates Forward Auth assignments and runtime directly from the socket', async () => {
    const container = await renderPage()
    await waitFor(() => getAccessPoliciesMock.mock.calls.length === 1)
    const socket = FakeSocket.instances[0]!
    await act(async () => {
        socket.open()
        socket.deliver('forward-auth', { policyCount: 2, assignedHosts: 8, runtimeState: 'synced' })
    })
    const summary = container.querySelector('section[aria-label="Forward Auth policies"]')!
    await waitFor(() => summary.querySelector('dd')?.textContent === '2')
    expect([...summary.querySelectorAll('dd')].map((value) => value.textContent?.trim())).toEqual([
        '2',
        '8',
        'Access policy runtime synchronized',
    ])
    expect(forwardAuthSummaryMock).toHaveBeenCalledTimes(1)
})

test('does not subscribe to access policies without permission', async () => {
    const container = await renderPage([PERMISSIONS.CROWDSEC_VIEW])
    await waitFor(() => container.querySelector('table') !== null)
    const socket = FakeSocket.instances[0]!
    await act(async () => socket.open())
    expect(socket.sent.map((message) => JSON.parse(message).topic)).not.toContain('forward-auth')
    expect(getAccessPoliciesMock).not.toHaveBeenCalled()
    expect(getAccessPolicyRuntimeStatusMock).not.toHaveBeenCalled()
})

test('keeps live configuration when a slower initial HTTP request finishes', async () => {
    const pending = Promise.withResolvers<CrowdSecConfiguration>()
    configurationGate = pending.promise
    const container = await renderPage()
    const socket = FakeSocket.instances[0]!
    await act(async () => {
        socket.open()
        socket.deliver('crowdsec-configuration', { ...configuration, synchronized: false })
    })
    await waitFor(
        () =>
            queryClient?.getQueryData<CrowdSecConfiguration>(crowdSecQueryKeys.configuration)
                ?.synchronized === false,
    )
    await act(async () => pending.resolve(configuration))
    await waitFor(() => container.querySelector('table') !== null)
    expect(
        queryClient?.getQueryData<CrowdSecConfiguration>(crowdSecQueryKeys.configuration)
            ?.synchronized,
    ).toBe(false)
})

test('marks disconnected dashboard data stale and receives fresh data after resuming', async () => {
    const container = await renderPage()
    await waitFor(() => container.querySelector('table') !== null)
    const request = dashboardMock.mock.calls[0]![0].data
    const snapshot = queryClient!.getQueriesData<CrowdSecDashboard>({
        queryKey: crowdSecQueryKeys.dashboard,
    })[0]![1]!
    const first = FakeSocket.instances[0]!
    await act(async () => first.open())
    await act(async () => first.close())
    await waitFor(() => container.querySelector('button[data-severity="error"]') !== null)
    expect(container.querySelector('table')).not.toBeNull()
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    const second = FakeSocket.instances.at(-1)!
    expect(second).not.toBe(first)
    await act(async () => {
        second.open()
        second.deliver('crowdsec-configuration', configuration)
        second.deliver(
            'crowdsec-dashboard',
            {
                ...snapshot,
                metrics: { ...snapshot.metrics!, blockedRequests: 2_222 },
            },
            request,
        )
    })
    await waitFor(() => container.textContent?.includes('2,222') === true)
    await waitFor(() => container.querySelector('button[data-severity]') === null)
    expect(configurationMock).toHaveBeenCalledTimes(1)
})

test('shows the shared table, country flag and scenario explanation control', async () => {
    const container = await renderDashboard()
    expect(container.textContent).toContain('Blocked requests')
    expect(container.textContent).toContain('Active IP and network bans')
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('img[alt="Germany"]')).not.toBeNull()
    expect(
        container.querySelector(
            'button[aria-label="About scenario crowdsecurity/http-generic-bf"]',
        ),
    ).not.toBeNull()
    expect(container.textContent).toContain('1–15 of 24')
})

test('does not invent blocked-origin zeros when the blocked metric is unavailable', async () => {
    blockedMetricsAvailable = false
    const container = await renderDashboard()
    const heading = [...container.querySelectorAll('h3')].find(
        (node) => node.textContent === 'Blocked requests by origin',
    )
    const panel = heading?.parentElement
    await waitFor(() => panel?.textContent?.includes('Data unavailable') === true)
    expect(panel?.textContent).not.toContain('crowdsec 0')
    expect(panel?.textContent).not.toContain('CAPI 0')
    expect(panel?.querySelector('svg')).toBeNull()
})

test('reports saved Forward Auth assignments and runtime synchronization without probing provider health', async () => {
    const container = await renderDashboard()
    await waitFor(
        () => container.textContent?.includes('Access policy runtime synchronized') === true,
    )
    const summary = container.querySelector<HTMLElement>(
        'section[aria-label="Forward Auth policies"]',
    )
    expect(summary).not.toBeNull()
    expect([...summary!.querySelectorAll('dd')].map((value) => value.textContent?.trim())).toEqual([
        '1',
        '3',
        'Access policy runtime synchronized',
    ])
    expect(summary?.textContent).not.toContain('http://auth.internal')
    expect(summary?.textContent).not.toContain('healthy')
})

test('shows All defaults in both filter controls without a reset action', async () => {
    const container = await renderDashboard()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls]')
    expect(toggle).not.toBeNull()
    await act(async () => toggle?.click())
    const panel = document.getElementById(toggle!.getAttribute('aria-controls')!)
    expect(panel).not.toBeNull()
    const selects = panel!.querySelectorAll('[role="combobox"]')
    expect(selects).toHaveLength(2)
    expect(selects[0]?.textContent).toContain('All origins')
    expect(selects[1]?.textContent).toContain('All types')
    expect(panel!.textContent).not.toContain('Reset filters')
})

test('searches and paginates all decisions through the server request', async () => {
    const container = await renderDashboard()
    const next = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.getAttribute('aria-label') === 'Go to next page',
    )
    expect(next).not.toBeUndefined()
    await act(async () => next?.click())
    await waitFor(() => dashboardMock.mock.calls.some(([request]) => request.data.offset === 15))

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(search, '203.0.113.2')
        search.dispatchEvent(new Event('input', { bubbles: true }))
        search.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 350))
    })
    await waitFor(() =>
        dashboardMock.mock.calls.some(
            ([request]) => request.data.search === '203.0.113.2' && request.data.offset === 0,
        ),
    )
    await waitFor(() => container.textContent?.includes('203.0.113.2') === true)
    expect(container.textContent).toContain('203.0.113.2')
})

test('classifies known scenario families and leaves unknown rules generic', () => {
    expect(scenarioDescriptionKey('crowdsecurity/http-generic-bf')).toBe('bruteForce')
    expect(scenarioDescriptionKey('crowdsecurity/http-probing')).toBe('scanning')
    expect(scenarioDescriptionKey('crowdsecurity/http-crawl')).toBe('crawling')
    expect(scenarioDescriptionKey('crowdsecurity/http-dos')).toBe('flooding')
    expect(scenarioDescriptionKey('crowdsecurity/cve-2026-1234')).toBe('exploit')
    expect(scenarioDescriptionKey('custom-rule')).toBe('generic')
})
