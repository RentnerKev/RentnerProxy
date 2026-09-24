import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
    CrowdSecDecision,
} from '../shared/Types/crowdsec.types'
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
                blockedRequests: 1_256,
                activeDecisions: 15_004,
                blockedByOrigin: [{ origin: 'crowdsec', count: 1_256 }],
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

mock.module('../features/Admin/CrowdSec/server', () => ({
    getCrowdSecDashboardHandler: dashboardMock,
}))
const { default: CrowdSecDashboardPanel } =
    await import('../features/Admin/CrowdSec/Components/CrowdSecDashboardPanel')

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
                        <CrowdSecDashboardPanel configuration={configuration} />
                    </QueryClientProvider>
                </TooltipProvider>,
            ),
        )
    })
    await waitFor(() => container.textContent?.includes('2001:db8::/64') === true)
    return container
}

beforeEach(() => dashboardMock.mockClear())
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
