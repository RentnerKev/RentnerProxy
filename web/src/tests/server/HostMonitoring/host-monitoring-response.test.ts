import { describe, expect, spyOn, test } from 'bun:test'
import { createHostMonitoringHttpHandlers } from '@/server/HostMonitoring/host-monitoring-response.server.ts'
import { HostMonitoringError } from '@/server/HostMonitoring/host-monitoring.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import type { HostMonitoringHttpDependencies } from '@/server/HostMonitoring/Types/host-monitoring-http.types.ts'
import type { HostMonitoringPolicyView } from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import {
    hostMonitoringSelectorSchema,
    hostMonitoringSummarySchema,
    hostMonitoringSettingsSchema,
    hostMonitoringHistorySchema,
    saveHostMonitoringPolicySchema,
} from '@/lib/HostMonitoring/validation.ts'

const origin = 'https://admin.example.com'
const proxyHostId = '0198d98a-0000-7000-8000-000000000001'
const input = { proxyHostId, expectedVersion: null, settings: { domain: 'app.example.com' } }
const policy: HostMonitoringPolicyView = {
    id: proxyHostId,
    proxyHostId,
    version: proxyHostId,
    settings: hostMonitoringSettingsSchema.parse(input.settings),
    state: 'unknown',
    availability: 'disabled',
    lastCheckedAt: null,
    lastOutcome: null,
    lastCode: null,
    lastDurationMs: null,
    lastHttpStatus: null,
    nextCheckAt: null,
    observationPoint: 'appliance',
    publicReachability: 'not_checked',
}

function harness(
    overrides: Partial<HostMonitoringHttpDependencies['service']> = {},
    configuredOrigin: string | null = origin,
) {
    const writes: unknown[] = []
    const reads: unknown[] = []
    const histories: unknown[] = []
    const handlers = createHostMonitoringHttpHandlers({
        origin: () => configuredOrigin,
        service: {
            getSummary: async (raw) => {
                if (!hostMonitoringSummarySchema.safeParse(raw).success)
                    throw new HostMonitoringError('invalid_input')
                reads.push(raw)
                return { summaries: [{ proxyHostId, policy }], checkedAt: new Date(0) }
            },
            getPolicy: async (raw) => {
                if (!hostMonitoringSelectorSchema.safeParse(raw).success)
                    throw new HostMonitoringError('invalid_input')
                reads.push(raw)
                return null
            },
            getHistory: async (raw) => {
                if (!hostMonitoringHistorySchema.safeParse(raw).success)
                    throw new HostMonitoringError('invalid_input')
                histories.push(raw)
                return { observations: [], incidents: [], nextCursor: null }
            },
            savePolicy: async (raw) => {
                if (!saveHostMonitoringPolicySchema.safeParse(raw).success)
                    throw new HostMonitoringError('invalid_input')
                writes.push(raw)
                return policy
            },
            ...overrides,
        },
    })
    return { ...handlers, reads, writes, histories }
}

function post(
    body: BodyInit | null = JSON.stringify(input),
    headers: HeadersInit = { origin, 'content-type': 'application/json' },
    suffix = '',
) {
    return new Request(`${origin}/api/admin/monitoring/policy${suffix}`, {
        method: 'POST',
        headers,
        body,
    })
}

function checkHeaders(response: Response, status: number) {
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

describe('host monitoring HTTP adapter', () => {
    test('summary accepts one bounded batch and returns sanitized policy views', async () => {
        const handlers = harness()
        const response = await handlers.summary(
            new Request(`${origin}/api/admin/monitoring/summary?proxyHostIds=${proxyHostId}`),
        )
        checkHeaders(response, 200)
        expect(handlers.reads).toEqual([{ proxyHostIds: [proxyHostId] }])
        expect(await response.json()).toEqual({
            summaries: [{ proxyHostId, policy }],
            checkedAt: new Date(0).toISOString(),
        })
    })

    test.each([
        '',
        '?proxyHostIds=',
        '?proxyHostIds=invalid',
        `?proxyHostIds=${proxyHostId},${proxyHostId}`,
        `?proxyHostIds=${proxyHostId}&proxyHostIds=${proxyHostId}`,
        `?proxyHostIds=${proxyHostId}&extra=1`,
        `?proxyHostIds=${Array.from({ length: 101 }, (_, index) => `0198d98a-0000-7000-8000-${String(index).padStart(12, '0')}`).join(',')}`,
    ])('summary rejects malformed batches %s', async (suffix) => {
        const handlers = harness()
        const response = await handlers.summary(
            new Request(`${origin}/api/admin/monitoring/summary${suffix}`),
        )
        checkHeaders(response, 400)
        expect(handlers.reads).toEqual([])
    })

    test('summary is read only and propagates VIEW denial', async () => {
        const handlers = harness({
            getSummary: async () => {
                throw new AuthDomainError('permission_denied', 'Denied')
            },
        })
        const url = `${origin}/api/admin/monitoring/summary?proxyHostIds=${proxyHostId}`
        checkHeaders(await handlers.summary(new Request(url)), 403)
        const postResponse = await handlers.summary(new Request(url, { method: 'POST' }))
        checkHeaders(postResponse, 405)
        expect(postResponse.headers.get('allow')).toBe('GET')
        expect(handlers.writes).toEqual([])
    })

    test('history forwards status and time filters and rejects invalid filters', async () => {
        const handlers = harness()
        const since = '2026-01-01T00:00:00.000Z'
        const url = `${origin}/api/admin/monitoring/history?proxyHostId=${proxyHostId}`
        checkHeaders(
            await handlers.history(new Request(`${url}&status=unhealthy&since=${since}`)),
            200,
        )
        expect(handlers.histories).toEqual([{ proxyHostId, status: 'unhealthy', since }])
        await Promise.all(
            [
                '&status=bad',
                '&since=yesterday',
                '&status=healthy&status=unknown',
                '&since=2026-01-01',
            ].map(async (query) =>
                checkHeaders(await handlers.history(new Request(`${url}${query}`)), 400),
            ),
        )
    })

    test.each([null, '', 'null', 'https://foreign.example.com'])(
        'blocks origin %s before service writes',
        async (requestOrigin) => {
            const handlers = harness()
            const headers = new Headers({ 'content-type': 'application/json' })
            if (requestOrigin !== null) headers.set('origin', requestOrigin)
            const response = await handlers.policy(post(JSON.stringify(input), headers))
            checkHeaders(response, 403)
            expect(await response.json()).toEqual({ error: 'permission_denied' })
            expect(handlers.writes).toEqual([])
        },
    )

    test('missing configured origin cannot authorize a write', async () => {
        const handlers = harness({}, null)
        checkHeaders(await handlers.policy(post()), 403)
        expect(handlers.writes).toEqual([])
    })

    test.each(['text/plain', 'application/json-patch+json', ''])(
        'requires JSON content type instead of %s',
        async (type) => {
            const handlers = harness()
            checkHeaders(await handlers.policy(post('{}', { origin, 'content-type': type })), 415)
            expect(handlers.writes).toEqual([])
        },
    )

    test('writes validated JSON and accepts media type parameters', async () => {
        const handlers = harness()
        const response = await handlers.policy(
            post(JSON.stringify(input), {
                origin,
                'content-type': 'Application/JSON; charset=utf-8',
            }),
        )
        checkHeaders(response, 200)
        expect(await response.json()).toEqual(policy)
        expect(handlers.writes).toEqual([input])
    })

    test.each(['{', 'null', JSON.stringify({ ...input, extra: true })])(
        'rejects malformed or invalid JSON payload %s',
        async (body) => {
            const handlers = harness()
            checkHeaders(await handlers.policy(post(body)), 400)
            expect(handlers.writes).toEqual([])
        },
    )

    test('rejects invalid UTF-8 without replacing bytes and calling a write', async () => {
        const handlers = harness()
        checkHeaders(await handlers.policy(post(new Uint8Array([0x7b, 0xff, 0x7d]))), 400)
        expect(handlers.writes).toEqual([])
    })

    test('accepts exactly 4 KiB and rejects a larger body independently of content length', async () => {
        const handlers = harness()
        const json = JSON.stringify(input)
        checkHeaders(await handlers.policy(post(json.padEnd(4_096))), 200)
        const response = await handlers.policy(
            post(json.padEnd(4_097), {
                origin,
                'content-type': 'application/json',
                'content-length': '1',
            }),
        )
        checkHeaders(response, 400)
        expect(handlers.writes).toHaveLength(1)
    })

    test('bounds streamed chunks and cancels an oversized producer before a write', async () => {
        const handlers = harness()
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(3_000))
                controller.enqueue(new Uint8Array(2_000))
            },
            cancel() {
                cancelled = true
            },
        })
        checkHeaders(await handlers.policy(post(stream)), 400)
        expect(cancelled).toBeTrue()
        expect(handlers.writes).toEqual([])
    })

    test('rejects absent write bodies and write query strings', async () => {
        const handlers = harness()
        checkHeaders(await handlers.policy(post(null)), 400)
        checkHeaders(
            await handlers.policy(
                post(
                    JSON.stringify(input),
                    { origin, 'content-type': 'application/json' },
                    '?proxyHostId=forged',
                ),
            ),
            400,
        )
        expect(handlers.writes).toEqual([])
    })

    test.each(['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])(
        'policy %s advertises the supported methods',
        async (method) => {
            const handlers = harness()
            const response = await handlers.policy(
                new Request(`${origin}/api/admin/monitoring/policy`, { method }),
            )
            checkHeaders(response, 405)
            expect(response.headers.get('allow')).toBe('GET, POST')
            expect(handlers.writes).toEqual([])
            expect(handlers.reads).toEqual([])
        },
    )

    test('history accepts only GET', async () => {
        const handlers = harness()
        const response = await handlers.history(post())
        checkHeaders(response, 405)
        expect(response.headers.get('allow')).toBe('GET')
        expect(handlers.writes).toEqual([])
        expect(handlers.histories).toEqual([])
    })

    test('delegates policy and cursor history reads without requiring a write Origin', async () => {
        const handlers = harness()
        const policyResponse = await handlers.policy(
            new Request(`${origin}/api/admin/monitoring/policy?proxyHostId=${proxyHostId}`),
        )
        checkHeaders(policyResponse, 200)
        expect(await policyResponse.json()).toBeNull()
        const params = new URLSearchParams({
            proxyHostId,
            limit: '25',
            beforeCheckedAt: '2026-10-28T12:00:00Z',
            beforeId: proxyHostId,
        })
        const historyResponse = await handlers.history(
            new Request(`${origin}/api/admin/monitoring/history?${params}`),
        )
        checkHeaders(historyResponse, 200)
        expect(await historyResponse.json()).toEqual({
            observations: [],
            incidents: [],
            nextCursor: null,
        })
        expect(handlers.reads).toEqual([{ proxyHostId }])
        expect(handlers.histories).toEqual([
            {
                proxyHostId,
                limit: 25,
                before: { checkedAt: '2026-10-28T12:00:00Z', id: proxyHostId },
            },
        ])
    })

    test.each([
        `proxyHostId=${proxyHostId}&proxyHostId=${proxyHostId}`,
        `proxyHostId=${proxyHostId}&extra=true`,
        `proxyHostId=${proxyHostId}&beforeId=${proxyHostId}`,
        `proxyHostId=${proxyHostId}&beforeCheckedAt=2026-10-28T12:00:00Z`,
        `proxyHostId=${proxyHostId}&limit=2&limit=3`,
        `proxyHostId=${proxyHostId}&limit=101`,
        '',
    ])('rejects ambiguous or invalid history queries: %s', async (query) => {
        const handlers = harness()
        checkHeaders(
            await handlers.history(new Request(`${origin}/api/admin/monitoring/history?${query}`)),
            400,
        )
        expect(handlers.histories).toEqual([])
    })

    test('policy reads reject history-only query keys', async () => {
        const handlers = harness()
        checkHeaders(
            await handlers.policy(
                new Request(
                    `${origin}/api/admin/monitoring/policy?proxyHostId=${proxyHostId}&limit=1`,
                ),
            ),
            400,
        )
        expect(handlers.reads).toEqual([])
    })

    test.each([
        [new AuthDomainError('authentication_required', 'PRIVATE'), 401, 'authentication_required'],
        [new AuthDomainError('permission_denied', 'PRIVATE'), 403, 'permission_denied'],
        [new HostMonitoringError('host_not_found'), 404, 'host_not_found'],
        [new HostMonitoringError('conflict'), 409, 'conflict'],
        [new RateLimitError(21, 20, 1_501, 'private-scope'), 429, 'rate_limited'],
        [new AuthDomainError('service_unavailable', 'PRIVATE'), 503, 'service_unavailable'],
        [new AuthDomainError('user_not_active', 'PRIVATE'), 503, 'service_unavailable'],
        [new Error('PRIVATE connection password'), 503, 'service_unavailable'],
    ] as const)('maps service failures to closed public status %s', async (error, status, code) => {
        const fail = async () => {
            throw error
        }
        const handlers = harness({ getPolicy: fail, getHistory: fail, savePolicy: fail })
        const responses = await Promise.all([
            handlers.policy(
                new Request(`${origin}/api/admin/monitoring/policy?proxyHostId=${proxyHostId}`),
            ),
            handlers.history(
                new Request(`${origin}/api/admin/monitoring/history?proxyHostId=${proxyHostId}`),
            ),
            handlers.policy(post()),
        ])
        expect(
            await Promise.all(
                responses.map(async (response) => {
                    checkHeaders(response, status)
                    expect(response.headers.get('retry-after')).toBe(status === 429 ? '2' : null)
                    return response.json()
                }),
            ),
        ).toEqual([{ error: code }, { error: code }, { error: code }])
    })

    test.each([new TypeError('PRIVATE driver data'), new SyntaxError('PRIVATE service data')])(
        'internal service type/parsing errors remain server failures and log no private data: %s',
        async (error) => {
            const logger = spyOn(console, 'error').mockImplementation(() => undefined)
            try {
                const fail = async () => {
                    throw error
                }
                const handlers = harness({ getPolicy: fail, savePolicy: fail })
                const responses = await Promise.all([
                    handlers.policy(
                        new Request(
                            `${origin}/api/admin/monitoring/policy?proxyHostId=${proxyHostId}`,
                        ),
                    ),
                    handlers.policy(post()),
                ])
                for (const response of responses) {
                    checkHeaders(response, 503)
                }
                expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
                    { error: 'service_unavailable' },
                    { error: 'service_unavailable' },
                ])
                expect(logger.mock.calls).toEqual([
                    ['[host-monitoring] API temporarily unavailable.'],
                    ['[host-monitoring] API temporarily unavailable.'],
                ])
            } finally {
                logger.mockRestore()
            }
        },
    )

    test('an already aborted request returns empty 499 without invoking service', async () => {
        const handlers = harness()
        const cancellation = new AbortController()
        cancellation.abort()
        const response = await handlers.policy(
            new Request(`${origin}/api/admin/monitoring/policy?proxyHostId=${proxyHostId}`, {
                signal: cancellation.signal,
            }),
        )
        checkHeaders(response, 499)
        expect(await response.text()).toBe('')
        expect(handlers.reads).toEqual([])
    })

    test('aborting a streamed write cancels reading and returns 499 without persisting', async () => {
        const handlers = harness()
        const cancellation = new AbortController()
        const reading = Promise.withResolvers<void>()
        let cancelled = false
        const stream = new ReadableStream<Uint8Array>({
            pull() {
                reading.resolve()
            },
            cancel() {
                cancelled = true
            },
        })
        const pending = handlers.policy(
            new Request(`${origin}/api/admin/monitoring/policy`, {
                method: 'POST',
                headers: { origin, 'content-type': 'application/json' },
                body: stream,
                signal: cancellation.signal,
            }),
        )
        await reading.promise
        cancellation.abort()
        const response = await pending
        checkHeaders(response, 499)
        expect(await response.text()).toBe('')
        expect(cancelled).toBeTrue()
        expect(handlers.writes).toEqual([])
    })
})
