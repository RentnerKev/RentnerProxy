import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { HostMonitoringDialogProps } from '@/features/Admin/HostMonitoring/Types/host-monitoring-dialog.types.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { default: useHostMonitoringDialogLogic } =
    await import('@/features/Admin/HostMonitoring/Hooks/useHostMonitoringDialogLogic.ts')
const { default: HostMonitoringDialog } = await import('@/features/Admin/HostMonitoring/index.tsx')
const { hostMonitoringQueryKeys } = await import('@/lib/HostMonitoring/hostMonitoringCache.ts')

const hostId = '018f2f52-7c1b-7cc0-9f3c-6a9952c54021'
const version = '018f2f52-7c1b-7cc0-9f3c-6a9952c54022'
const nextVersion = '018f2f52-7c1b-7cc0-9f3c-6a9952c54023'
const policy = {
    id: version,
    proxyHostId: hostId,
    version,
    settings: { ...HOST_MONITORING_DEFAULTS, domain: 'example.test', enabled: true },
    state: 'healthy',
    availability: 'healthy',
    lastCheckedAt: '2026-10-29T12:00:00.000Z',
    lastOutcome: 'healthy',
    lastCode: 'expected_status',
    lastDurationMs: 40,
    lastHttpStatus: 200,
    nextCheckAt: null,
    observationPoint: 'appliance',
    publicReachability: 'not_checked',
}
const props: HostMonitoringDialogProps = {
    open: true,
    onOpenChange: () => undefined,
    permissions: [PERMISSIONS.PROXY_HOSTS_VIEW, PERMISSIONS.PROXY_HOSTS_UPDATE],
    host: {
        id: hostId,
        domains: ['example.test'],
        forwardHost: 'localhost',
        forwardPort: 8080,
        forwardScheme: 'http',
        enabled: true,
        certificateId: null,
        forceHttps: false,
        verifyUpstreamTls: false,
        upstreamTlsServerName: null,
        trustedCaId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    },
}
let root: Root | null = null
let client: InstanceType<typeof QueryClient>
let logic: ReturnType<typeof useHostMonitoringDialogLogic>
let responsePolicy: unknown
let responseHistory: unknown
let historyFactory: ((url: string) => unknown) | null
let getStatus = 200
let postStatus = 200
const requests: { url: string; method: string; body: string }[] = []
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>

function Harness(input: HostMonitoringDialogProps) {
    const result = useHostMonitoringDialogLogic(input)
    useEffect(() => {
        logic = result
    })
    return (
        <output
            data-availability={result.state.policy?.availability ?? 'unavailable'}
            data-dirty={String(result.state.dirty)}
            data-conflict={String(result.state.conflict)}
        >
            {result.state.canView ? result.state.policy?.settings.domain : 'denied'}
        </output>
    )
}
const getSince = (url: string) => new URL(url, 'http://localhost').searchParams.get('since')
async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
}
async function render(input = props, actualDialog = false) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    {actualDialog ? <HostMonitoringDialog {...input} /> : <Harness {...input} />}
                </QueryClientProvider>,
            ),
        )
    })
    await flush()
    return container
}
beforeEach(() => {
    requests.length = 0
    responsePolicy = structuredClone(policy)
    responseHistory = { observations: [], incidents: [], nextCursor: null }
    historyFactory = null
    getStatus = 200
    postStatus = 200
    client = new QueryClient({
        defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
    })
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                const url = String(input)
                const method = init?.method ?? 'GET'
                requests.push({ url, method, body: String(init?.body ?? '') })
                const status = method === 'POST' ? postStatus : getStatus
                return Response.json(
                    status === 403
                        ? { error: 'permission_denied' }
                        : status === 409
                          ? { error: 'conflict' }
                          : url.includes('history?')
                            ? (historyFactory?.(url) ?? responseHistory)
                            : responsePolicy,
                    { status },
                )
            },
            { preconnect: fetch.preconnect },
        ),
    )
})
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    client.clear()
    fetchSpy.mockRestore()
    document.body.replaceChildren()
})

test('unauthorized dialog mounts without requests or editable controls', async () => {
    await render({ ...props, permissions: [] }, true)
    expect(requests).toHaveLength(0)
    expect(document.body.textContent).toContain('permission')
    expect(document.querySelector('form input') === null).toBe(true)
})
test('read-only monitoring polls only while open and hides retained health after authorization failure', async () => {
    const container = await render({ ...props, permissions: [PERMISSIONS.PROXY_HOSTS_VIEW] })
    expect(container.querySelector('output')?.dataset.availability).toBe('healthy')
    expect(logic.state.canUpdate).toBe(false)
    const query = client.getQueryCache().find({ queryKey: hostMonitoringQueryKeys.policy(hostId) })!
    const options = query.options as {
        refetchInterval: number
        refetchOnReconnect: boolean
        refetchOnWindowFocus: boolean
        refetchIntervalInBackground: boolean
    }
    expect(options.refetchInterval).toBe(15_000)
    expect(options.refetchOnReconnect).toBe(true)
    expect(options.refetchOnWindowFocus).toBe(true)
    expect(options.refetchIntervalInBackground).toBe(false)
    getStatus = 403
    await act(async () => {
        await client.refetchQueries({ queryKey: hostMonitoringQueryKeys.all })
    })
    await flush()
    expect(container.textContent).toBe('denied')
    expect(container.querySelector('output')?.dataset.availability).toBe('unavailable')
})
test('polling preserves a dirty draft and its original optimistic version; conflict preserves edits', async () => {
    await render()
    await act(async () => {
        logic.form.setFieldValue('intervalSeconds', 90)
    })
    responsePolicy = {
        ...policy,
        version: nextVersion,
        settings: { ...policy.settings, intervalSeconds: 120 },
    }
    await act(async () => {
        await client.refetchQueries({ queryKey: hostMonitoringQueryKeys.policy(hostId) })
    })
    await flush()
    expect(logic.form.getFieldValue('intervalSeconds')).toBe(90)
    expect(logic.state.conflict).toBe(true)
    await act(async () => {
        logic.handler.handleReload()
    })
    await flush()
    expect(logic.form.getFieldValue('intervalSeconds')).toBe(120)
    await act(async () => {
        logic.form.setFieldValue('intervalSeconds', 100)
    })
    postStatus = 409
    await act(async () => {
        await logic.form.handleSubmit()
    })
    await flush()
    expect(
        JSON.parse(requests.find((request) => request.method === 'POST')!.body).expectedVersion,
    ).toBe(nextVersion)
    expect(logic.state.conflict).toBe(true)
    expect(logic.form.getFieldValue('intervalSeconds')).toBe(100)
})
test('bounds prevent invalid save and filters are sent before history pagination', async () => {
    await render()
    await act(async () => {
        logic.form.setFieldValue('timeoutMs', 10_001)
        await logic.form.handleSubmit()
    })
    expect(requests.some((request) => request.method === 'POST')).toBe(false)
    await act(async () => {
        logic.handler.handleStatus('unknown')
        logic.handler.handlePeriod('hour')
    })
    await flush()
    const request = requests.findLast((entry) => entry.url.includes('history?'))!
    expect(request.url).toContain('status=unknown')
    expect(request.url).toContain('since=')
    expect(request.url).toContain('limit=100')
})
test('closed dialog does not fetch and unconfigured monitoring stays read-only until explicit edit', async () => {
    await render({ ...props, open: false })
    expect(requests).toHaveLength(0)
    await act(async () => root?.unmount())
    responsePolicy = null
    await render()
    expect(logic.state.policy).toBeNull()
    expect(logic.state.dirty).toBe(false)
    expect(requests.some((request) => request.method === 'POST')).toBe(false)
})

test('unknown observations and open incidents remain visible without editable settings for a viewer', async () => {
    responsePolicy = { ...policy, state: 'unknown', availability: 'stale' }
    responseHistory = {
        observations: [
            {
                id: hostId,
                policyId: version,
                policyVersion: version,
                checkedAt: '2026-10-29T12:00:01.000Z',
                status: 'healthy',
                code: 'expected_status',
                durationMs: 40,
                httpStatus: 200,
            },
            {
                id: nextVersion,
                policyId: version,
                policyVersion: version,
                checkedAt: policy.lastCheckedAt,
                status: 'unknown',
                code: 'runtime_unavailable',
                durationMs: null,
                httpStatus: null,
            },
        ],
        incidents: [
            {
                id: nextVersion,
                policyId: version,
                startedAt: policy.lastCheckedAt,
                detectedAt: policy.lastCheckedAt,
                recoveryStartedAt: null,
                recoveredAt: null,
                failureCode: 'upstream_timeout',
                recoveryCode: null,
                closedReason: null,
                closedAt: null,
            },
        ],
        nextCursor: null,
    }
    await render({ ...props, permissions: [PERMISSIONS.PROXY_HOSTS_VIEW] }, true)
    expect(document.querySelector('table tbody')?.textContent).toContain('Unknown')
    expect(document.querySelector('article')?.textContent).toContain('Open')
    const chart = document.querySelector('svg[aria-label="Response duration"]')
    expect(chart).not.toBeNull()
    expect(chart?.getAttribute('tabindex')).toBe('0')
    expect(document.querySelector('form input') === null).toBe(true)
})

test('discard works locally after a failed reload and allows closing while offline', async () => {
    const close = spyOn(props, 'onOpenChange')
    try {
        await render()
        await act(async () => {
            logic.form.setFieldValue('intervalSeconds', 90)
        })
        getStatus = 503
        await act(async () => {
            logic.handler.handleReload()
        })
        await flush()
        expect(logic.state.dirty).toBe(true)
        const count = requests.length
        await act(async () => {
            logic.handler.handleDiscard()
        })
        expect(logic.state.dirty).toBe(false)
        expect(logic.state.conflict).toBe(false)
        expect(requests.length).toBe(count)
        await act(async () => {
            logic.handler.handleOpenChange(false)
        })
        expect(close).toHaveBeenCalledWith(false)
    } finally {
        close.mockRestore()
    }
})

test('rolling history refreshes its first-page window and keeps pagination on that anchor', async () => {
    let now = Date.parse('2026-10-29T12:00:00.000Z')
    const clock = spyOn(Date, 'now').mockImplementation(() => now)
    historyFactory = () => ({
        observations: [],
        incidents: [],
        nextCursor: { checkedAt: '2026-10-29T11:59:00.000Z', id: nextVersion },
    })
    try {
        await render()
        await act(async () => {
            logic.handler.handlePeriod('hour')
        })
        await flush()
        const historyKey = hostMonitoringQueryKeys.history({
            proxyHostId: hostId,
            status: 'all',
            limit: 100,
            period: 'hour',
        })
        const first = requests.findLast((request) => request.url.includes('history?'))!
        expect(getSince(first.url)).toBe('2026-10-29T11:00:00.000Z')
        now += 2 * 60 * 60 * 1000
        await act(async () => {
            logic.handler.handleMore()
        })
        await flush()
        const second = requests.findLast((request) => request.url.includes('history?'))!
        expect(second.url).toContain('beforeCheckedAt=')
        expect(getSince(second.url)).toBe(getSince(first.url))
        await act(async () => {
            logic.handler.handleMore()
        })
        await flush()
        expect(logic.state.more).toBe(false)
        expect(logic.state.capped).toBe(true)
        const beforeRefresh = requests.length
        await act(async () => {
            await client.refetchQueries({ queryKey: historyKey, exact: true })
        })
        await flush()
        const refreshed = requests
            .slice(beforeRefresh)
            .filter((request) => request.url.includes('history?'))
        expect(refreshed).toHaveLength(3)
        expect(
            refreshed.every((request) => getSince(request.url) === '2026-10-29T13:00:00.000Z'),
        ).toBe(true)
        expect(refreshed[0]?.url.includes('beforeCheckedAt=')).toBe(false)
        expect(refreshed[1]?.url.includes('beforeCheckedAt=')).toBe(true)
    } finally {
        clock.mockRestore()
    }
})
