import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'
import {
    getHostMonitoringPolicy,
    getHostMonitoringSummary,
    getHostMonitoringHistory,
    saveHostMonitoringPolicy,
} from '@/lib/HostMonitoring/hostMonitoringClient.ts'

const hostId = '0198d98a-0000-7000-8000-000000000001'
const policyId = '0198d98a-0000-7000-8000-000000000002'
const foreignId = '0198d98a-0000-7000-8000-000000000003'
const when = '2026-10-28T12:00:00.000Z'
const settings = { ...HOST_MONITORING_DEFAULTS, enabled: true, domain: 'app.example.com' }
const policy = {
    id: policyId,
    proxyHostId: hostId,
    version: policyId,
    settings,
    state: 'healthy',
    availability: 'healthy',
    lastCheckedAt: when,
    lastOutcome: 'healthy',
    lastCode: 'expected_status',
    lastDurationMs: 12,
    lastHttpStatus: 200,
    nextCheckAt: when,
    observationPoint: 'appliance',
    publicReachability: 'not_checked',
}
const observation = {
    id: foreignId,
    policyId,
    policyVersion: policyId,
    checkedAt: when,
    status: 'healthy',
    code: 'expected_status',
    durationMs: 12,
    httpStatus: 200,
}
const incident = {
    id: foreignId,
    policyId,
    startedAt: when,
    detectedAt: when,
    recoveryStartedAt: null,
    recoveredAt: null,
    failureCode: 'upstream_timeout',
    recoveryCode: null,
    closedReason: null,
    closedAt: null,
}
const query = { proxyHostId: hostId, status: 'all' as const, limit: 50 }

function respond(value: unknown, status = 200) {
    return spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(value, { status }))
}

afterEach(() => mock.restore())

describe('monitoring browser API boundary', () => {
    test('summary sends a single scoped batch and normalizes dates', async () => {
        const fetchMock = respond({ summaries: [{ proxyHostId: hostId, policy }], checkedAt: when })
        const result = await getHostMonitoringSummary([hostId])
        expect(result.checkedAt).toEqual(new Date(when))
        expect(result.summaries[0]?.policy?.lastCheckedAt).toEqual(new Date(when))
        expect(result.summaries[0]?.policy?.nextCheckAt).toEqual(new Date(when))
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [path, options] = fetchMock.mock.calls[0]!
        expect(path).toBe(`/api/admin/monitoring/summary?proxyHostIds=${hostId}`)
        expect(options).toMatchObject({
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            headers: { accept: 'application/json' },
        })
    })

    test('accepts exactly the maximum batch and permits deleted hosts to be absent', async () => {
        const ids = Array.from(
            { length: 100 },
            (_, index) => `0198d98a-0000-7000-8000-${String(index).padStart(12, '0')}`,
        )
        const fetchMock = respond({ summaries: [], checkedAt: when })
        expect((await getHostMonitoringSummary(ids)).summaries).toEqual([])
        const url = new URL(String(fetchMock.mock.calls[0]![0]), 'https://admin.example.com')
        expect(url.searchParams.get('proxyHostIds')?.split(',')).toEqual(ids)
    })

    test.each(
        [
            [],
            [hostId, hostId],
            ['invalid'],
            Array.from(
                { length: 101 },
                (_, index) => `0198d98a-0000-7000-8000-${String(index).padStart(12, '0')}`,
            ),
        ].map((ids) => ({ ids })),
    )('rejects invalid batch before making a request', async ({ ids }) => {
        const fetchMock = respond({})
        await expect(getHostMonitoringSummary(ids)).rejects.toMatchObject({ code: 'invalid_input' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test.each([
        { summaries: [{ proxyHostId: foreignId, policy: null }], checkedAt: when },
        {
            summaries: [{ proxyHostId: hostId, policy: { ...policy, proxyHostId: foreignId } }],
            checkedAt: when,
        },
        {
            summaries: [{ proxyHostId: hostId, policy: { ...policy, leaseToken: 'private' } }],
            checkedAt: when,
        },
        {
            summaries: [
                { proxyHostId: hostId, policy: null },
                { proxyHostId: hostId, policy: null },
            ],
            checkedAt: when,
        },
        { summaries: [], checkedAt: 'invalid' },
    ])('rejects foreign, ambiguous or private summary payloads', async (value) => {
        respond(value)
        await expect(getHostMonitoringSummary([hostId])).rejects.toMatchObject({
            code: 'invalid_response',
        })
    })

    test('policy reads normalize dates and accept an unconfigured host', async () => {
        const fetchMock = respond(policy)
        expect((await getHostMonitoringPolicy(hostId))?.lastCheckedAt).toEqual(new Date(when))
        expect(fetchMock.mock.calls[0]![0]).toBe(
            `/api/admin/monitoring/policy?proxyHostId=${hostId}`,
        )
        fetchMock.mockResolvedValueOnce(Response.json(null))
        expect(await getHostMonitoringPolicy(hostId)).toBeNull()
    })

    test('policy and save responses must belong to the selected host', async () => {
        const fetchMock = respond({ ...policy, proxyHostId: foreignId })
        await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
            code: 'invalid_response',
        })
        fetchMock.mockResolvedValueOnce(Response.json({ ...policy, proxyHostId: foreignId }))
        await expect(
            saveHostMonitoringPolicy({ proxyHostId: hostId, expectedVersion: policyId, settings }),
        ).rejects.toMatchObject({ code: 'invalid_response' })
    })

    test('history serializes filters and the complete tuple cursor, retaining typed timestamps', async () => {
        const before = { checkedAt: when, id: foreignId }
        const fetchMock = respond({
            observations: [observation],
            incidents: [incident],
            nextCursor: before,
        })
        const result = await getHostMonitoringHistory({
            ...query,
            status: 'unhealthy',
            limit: 10,
            since: when,
            before,
        })
        const url = new URL(String(fetchMock.mock.calls[0]![0]), 'https://admin.example.com')
        expect(url.pathname).toBe('/api/admin/monitoring/history')
        expect(Object.fromEntries(url.searchParams)).toEqual({
            proxyHostId: hostId,
            status: 'unhealthy',
            limit: '10',
            since: when,
            beforeCheckedAt: when,
            beforeId: foreignId,
        })
        expect(result.observations[0]?.checkedAt).toEqual(new Date(when))
        expect(result.incidents[0]?.startedAt).toEqual(new Date(when))
        expect(result.incidents[0]?.closedAt).toBeNull()
        expect(result.nextCursor).toEqual(before)
    })

    test.each([
        {
            observations: [{ ...observation, leaseToken: 'private' }],
            incidents: [],
            nextCursor: null,
        },
        { observations: [], incidents: [{ ...incident, configuredBy: hostId }], nextCursor: null },
        {
            observations: Array.from({ length: 101 }, () => observation),
            incidents: [],
            nextCursor: null,
        },
        { observations: [], incidents: [], nextCursor: { checkedAt: when } },
    ])('rejects malformed or unbounded history responses', async (value) => {
        respond(value)
        await expect(getHostMonitoringHistory(query)).rejects.toMatchObject({
            code: 'invalid_response',
        })
    })

    test('saves the optimistic version and validated settings with authenticated JSON transport', async () => {
        const fetchMock = respond(policy)
        const input = { proxyHostId: hostId, expectedVersion: policyId, settings }
        await saveHostMonitoringPolicy(input)
        const [path, options] = fetchMock.mock.calls[0]!
        expect(path).toBe('/api/admin/monitoring/policy')
        expect(options).toMatchObject({
            method: 'POST',
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
        })
        expect(JSON.parse(String(options?.body))).toEqual(input)
        expect(options?.signal).toBeInstanceOf(AbortSignal)
    })

    test.each([
        'authentication_required',
        'permission_denied',
        'conflict',
        'host_not_found',
        'rate_limited',
        'invalid_input',
        'service_unavailable',
    ])('preserves closed public error code %s', async (error) => {
        respond({ error }, error === 'conflict' ? 409 : 403)
        await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
            code: error,
            message: error,
        })
    })

    test.each([{ error: 'database_password=private' }, { error: 'conflict', detail: 'private' }])(
        'does not expose an untrusted server error',
        async (value) => {
            respond(value, 500)
            await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
                code: 'service_unavailable',
                message: 'service_unavailable',
            })
        },
    )

    test.each([
        new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
        new Response(new Uint8Array([0xc3, 0x28]), {
            headers: { 'content-type': 'application/json' },
        }),
        new Response('null', { headers: { 'content-type': 'text/html' } }),
        new Response(null, { status: 204, headers: { 'content-type': 'application/json' } }),
    ])(
        'rejects malformed JSON, invalid UTF-8, wrong media types and absent bodies',
        async (response) => {
            spyOn(globalThis, 'fetch').mockResolvedValue(response)
            await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
                code: 'invalid_response',
            })
        },
    )

    test('bounds streaming responses independently of a forged content length and cancels the producer', async () => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(HOST_MONITORING_UI.responseLimitBytes))
                controller.enqueue(new Uint8Array([1]))
            },
            cancel() {
                cancelled = true
            },
        })
        spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(body, {
                headers: { 'content-type': 'application/json', 'content-length': '1' },
            }),
        )
        await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
            code: 'invalid_response',
        })
        expect(cancelled).toBe(true)
    })

    test('accepts an exact-limit JSON body with an explicit UTF-8 media type', async () => {
        const body = 'null' + ' '.repeat(HOST_MONITORING_UI.responseLimitBytes - 4)
        spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(body, {
                headers: { 'content-type': 'application/json; charset=utf-8' },
            }),
        )
        expect(await getHostMonitoringPolicy(hostId)).toBeNull()
    })

    test('invalid optimistic versions and settings fail before a write', async () => {
        const fetchMock = respond(policy)
        await expect(
            saveHostMonitoringPolicy({ proxyHostId: hostId, expectedVersion: 'invalid', settings }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            saveHostMonitoringPolicy({
                proxyHostId: hostId,
                expectedVersion: policyId,
                settings: { ...settings, domain: '*.example.com' },
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('transport failures hide their private diagnostic text', async () => {
        spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private connection detail'))
        await expect(getHostMonitoringPolicy(hostId)).rejects.toMatchObject({
            code: 'service_unavailable',
            message: 'service_unavailable',
        })
    })

    test('an already aborted request never calls fetch', async () => {
        const fetchMock = respond(null)
        await expect(getHostMonitoringPolicy(hostId, AbortSignal.abort())).rejects.toMatchObject({
            code: 'aborted',
        })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test('cancelling a pending response cancels the body and reports an aborted request', async () => {
        const controller = new AbortController()
        let cancelled = false
        const { promise: started, resolve: reading } = Promise.withResolvers<void>()
        const body = new ReadableStream<Uint8Array>({
            pull() {
                reading()
            },
            cancel() {
                cancelled = true
            },
        })
        const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(body, { headers: { 'content-type': 'application/json' } }),
        )
        const pending = getHostMonitoringPolicy(hostId, controller.signal)
        await started
        controller.abort()
        await expect(pending).rejects.toMatchObject({ code: 'aborted' })
        expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true)
        expect(cancelled).toBe(true)
    })
})
