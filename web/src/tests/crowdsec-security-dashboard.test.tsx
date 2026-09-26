import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
    CrowdSecDecision,
} from '../shared/Types/crowdsec.types'
import type { AccessPolicySummary } from '../shared/Types/access-policies.types'
import type { ProxyRuntimeSyncStatus } from '../shared/Types/proxy-runtime.types'
import { scenarioDescriptionKey } from '../features/Admin/CrowdSec/Helpers/scenarioDescription'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')

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

mock.module('../features/Admin/AccessPolicyManagement/server', () => ({
    getAccessPoliciesHandler: getAccessPoliciesMock,
    getAccessPolicyRuntimeStatusHandler: getAccessPolicyRuntimeStatusMock,
}))

mock.module('../features/Admin/CrowdSec/server', () => ({
    getCrowdSecDashboardHandler: dashboardMock,
}))
const { default: CrowdSecDashboardPanel } =
    await import('../features/Admin/CrowdSec/Components/CrowdSecDashboardPanel')
const { default: ForwardAuthSummaryPanel } =
    await import('../features/Admin/CrowdSec/Components/ForwardAuthSummaryPanel')

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

beforeEach(() => {
    blockedMetricsAvailable = true
    dashboardMock.mockClear()
    getAccessPoliciesMock.mockClear()
    getAccessPolicyRuntimeStatusMock.mockClear()
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    queryClient?.clear()
    queryClient = null
    document.body.replaceChildren()
})

test('shows the shared table, country flag and scenario explanation control', async () => {
    const container = await renderDashboard()
    expect(container.textContent).toContain('Blocked requests')
    expect(container.textContent).toContain('Active IP and network bans')
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('.flag\\:DE')).not.toBeNull()
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
