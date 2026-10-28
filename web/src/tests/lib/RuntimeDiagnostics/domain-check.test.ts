import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
    DOMAIN_DIAGNOSTICS_CLIENT_TIMEOUT_MS,
    DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT,
} from '@/config/domain-diagnostics.config.ts'
import {
    DomainCheckError,
    requestDomainCheck,
    serializeDomainCheckSummary,
} from '@/lib/RuntimeDiagnostics/domainCheck.ts'
import { domainDiagnosticsFixture, domainDiagnosticsInput } from './domain-diagnostics.fixture.ts'

const fetchMock = spyOn(globalThis, 'fetch')

afterAll(() => fetchMock.mockRestore())

function response(value: unknown, status = 200): Response {
    return Response.json(value, { status })
}

function request(signal = new AbortController().signal) {
    return requestDomainCheck(domainDiagnosticsInput, signal)
}

afterEach(() => {
    fetchMock.mockReset()
})

describe('explicit bounded domain-check request', () => {
    test('posts only the selected persisted host identity with private same-origin transport', async () => {
        const fixture = domainDiagnosticsFixture()
        fetchMock.mockResolvedValueOnce(response(fixture))
        expect(await request()).toEqual(fixture)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, options] = fetchMock.mock.calls[0]!
        expect(url).toBe('/api/admin/diagnostics/domain')
        expect(options).toMatchObject({
            method: 'POST',
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
        })
        expect(JSON.parse(options!.body as string)).toEqual(domainDiagnosticsInput)
        expect(options!.signal).toBeInstanceOf(AbortSignal)
    })

    test('rejects invalid input before any request', async () => {
        await expect(
            requestDomainCheck(
                { ...domainDiagnosticsInput, domain: 'https://private.example' },
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    test.each([
        'invalid_input',
        'permission_denied',
        'authentication_required',
        'configuration_changed',
        'rate_limited',
        'busy',
        'runtime_unavailable',
    ] as const)('preserves the closed %s error code', async (error) => {
        fetchMock.mockResolvedValueOnce(response({ error }, 503))
        await expect(request()).rejects.toMatchObject({ code: error, message: error })
    })

    test.each([
        { error: 'PRIVATE-RAW-SERVER-ERROR' },
        { error: 'busy', detail: 'PRIVATE-CREDENTIAL' },
        { message: 'PRIVATE-CREDENTIAL' },
    ])('does not expose unexpected error payloads: %j', async (payload) => {
        fetchMock.mockResolvedValueOnce(response(payload, 500))
        await expect(request()).rejects.toMatchObject({
            code: 'invalid_response',
            message: 'invalid_response',
        })
    })

    test.each(['hostType', 'hostId', 'domain'] as const)(
        'rejects a valid result for a different %s',
        async (key) => {
            const fixture = domainDiagnosticsFixture()
            const changed =
                key === 'hostType'
                    ? {
                          ...fixture,
                          hostType: 'redirect',
                          stages: {
                              ...fixture.stages,
                              upstream: {
                                  ...fixture.stages.upstream,
                                  status: 'not_applicable',
                                  code: 'redirect_host',
                                  httpStatus: null,
                              },
                              tls: {
                                  ...fixture.stages.tls,
                                  status: 'not_applicable',
                                  code: 'redirect_host',
                              },
                          },
                      }
                    : {
                          ...fixture,
                          [key]:
                              key === 'hostId'
                                  ? '0198d98a-0000-7000-8000-000000000002'
                                  : 'other.example.com',
                      }
            fetchMock.mockResolvedValueOnce(response(changed))
            await expect(request()).rejects.toMatchObject({ code: 'invalid_response' })
        },
    )

    test('rejects unknown fields and contradictory stage results', async () => {
        const fixture = domainDiagnosticsFixture()
        for (const value of [
            { ...fixture, credential: 'PRIVATE-CREDENTIAL' },
            {
                ...fixture,
                stages: {
                    ...fixture.stages,
                    tls: { ...fixture.stages.tls, status: 'passed', code: 'tls_failed' },
                },
            },
        ]) {
            fetchMock.mockResolvedValueOnce(response(value))
            // Each malformed response is a separate explicit request.
            // eslint-disable-next-line no-await-in-loop
            await expect(request()).rejects.toMatchObject({ code: 'invalid_response' })
        }
    })

    test.each([
        () => new Response('<private>', { headers: { 'content-type': 'text/html' } }),
        () => new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
        () =>
            new Response(new Uint8Array([0xff]), {
                headers: { 'content-type': 'application/json' },
            }),
        () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    ])('rejects missing or malformed JSON bodies', async (makeResponse) => {
        fetchMock.mockResolvedValueOnce(makeResponse())
        await expect(request()).rejects.toMatchObject({ code: 'invalid_response' })
    })

    test('caps streamed bytes even when the server declares a small body', async () => {
        const cancel = mock(() => {})
        fetchMock.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT + 1))
                    },
                    cancel,
                }),
                { headers: { 'content-type': 'application/json', 'content-length': '1' } },
            ),
        )
        await expect(request()).rejects.toBeInstanceOf(DomainCheckError)
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    test('cancels an unfinished response and preserves caller cancellation', async () => {
        const controller = new AbortController()
        const cancel = mock(() => {})
        fetchMock.mockResolvedValueOnce(
            new Response(new ReadableStream({ cancel }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        const pending = request(controller.signal)
        await Promise.resolve()
        controller.abort(new DOMException('Check cancelled', 'AbortError'))
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    test('enforces the client deadline without waiting twenty seconds', async () => {
        const deadline = new AbortController()
        const timeout = spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
        try {
            fetchMock.mockResolvedValueOnce(
                new Response(new ReadableStream(), {
                    headers: { 'content-type': 'application/json' },
                }),
            )
            const pending = request()
            await Promise.resolve()
            deadline.abort(new DOMException('Deadline', 'TimeoutError'))
            await expect(pending).rejects.toMatchObject({ code: 'timeout' })
            expect(timeout).toHaveBeenCalledWith(DOMAIN_DIAGNOSTICS_CLIENT_TIMEOUT_MS)
        } finally {
            timeout.mockRestore()
        }
    })

    test('replaces raw transport exceptions with a closed failure code', async () => {
        fetchMock.mockRejectedValueOnce(new Error('PRIVATE-CREDENTIAL'))
        await expect(request()).rejects.toMatchObject({
            code: 'request_failed',
            message: 'request_failed',
        })
    })
})

describe('shareable domain-check summary', () => {
    test('copies only stage outcomes and observation metadata without private identities', () => {
        const fixture = domainDiagnosticsFixture()
        const summary = serializeDomainCheckSummary(fixture)
        expect(JSON.parse(summary)).toEqual({
            format: 'rentnerproxy-domain-check',
            version: 1,
            checkedAt: fixture.checkedAt,
            observationPoint: 'appliance',
            publicReachability: 'not_checked',
            hostType: 'proxy',
            stages: {
                configuration: { status: 'passed', code: 'configuration_active', durationMs: 1 },
                dns: { status: 'passed', code: 'dns_resolved', durationMs: 1 },
                upstream: {
                    status: 'passed',
                    code: 'upstream_responded',
                    durationMs: 1,
                    httpStatus: 200,
                },
                tls: { status: 'passed', code: 'tls_verified', durationMs: 1 },
            },
        })
        for (const privateValue of [
            fixture.domain,
            fixture.hostId,
            fixture.expectedRevision,
            ...fixture.stages.dns.addresses,
        ]) {
            expect(summary).not.toContain(privateValue)
        }
        expect(summary.endsWith('\n')).toBe(true)
    })

    test('refuses injected fields instead of serializing untrusted diagnostic values', () => {
        const injected = { ...domainDiagnosticsFixture(), password: 'PRIVATE-CREDENTIAL' }
        expect(() => serializeDomainCheckSummary(injected)).toThrow()
    })
})
