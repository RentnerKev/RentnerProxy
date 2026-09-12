import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import { getControllerCertificateEvents } from '../server/Foundation/certificates.server'

const originalEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)
let fetchSpy: { mockRestore(): void } | undefined
let requestedUrl = ''

const certificateId = '0198d98a-0000-7000-8000-000000000001'
const operationId = '0198d98a-0000-7000-8000-000000000002'
const firstEventId = '0198d98a-0000-7000-8000-000000000003'
const secondEventId = '0198d98a-0000-7000-8000-000000000004'
const cursor = '0198d98a-0000-7000-8000-000000000010:9'

function event(overrides: Record<string, unknown> = {}) {
    return {
        id: firstEventId,
        operationId,
        certificateId,
        kind: 'started',
        stage: 'creating_order',
        occurredAt: '2026-09-12T12:00:00Z',
        errorCode: null,
        ...overrides,
    }
}

function mockController(payload: unknown, status = 200) {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: RequestInfo | URL) => {
                requestedUrl = String(input)
                return Response.json(payload, { status })
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
    return fetchSpy
}

function mockRawController(body: string, status = 200) {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: RequestInfo | URL) => {
                requestedUrl = String(input)
                return new Response(body, {
                    status,
                    headers: { 'content-type': 'application/json' },
                })
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
    return fetchSpy
}

afterEach(() => {
    fetchSpy?.mockRestore()
    requestedUrl = ''
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})

describe('controller certificate event transport', () => {
    test('reads bounded pages and forwards the opaque cursor', async () => {
        mockController({
            events: [event()],
            nextCursor: cursor,
            hasMore: true,
            resetRequired: false,
        })

        await expect(getControllerCertificateEvents(cursor, 100)).resolves.toMatchObject({
            events: [{ id: firstEventId, stage: 'creating_order' }],
            nextCursor: cursor,
            hasMore: true,
            resetRequired: false,
        })
        expect(requestedUrl).toBe(
            'http://127.0.0.1:18081/internal/v1/certificates/events?limit=100&after=' +
                encodeURIComponent(cursor),
        )
    })

    test.each([
        'not-a-cursor',
        '0198D98A-0000-7000-8000-000000000010:9',
        '0198d98a-0000-6000-8000-000000000010:9',
        '0198d98a-0000-7000-8000-000000000010:18446744073709551616',
        '0198d98a-0000-7000-8000-000000000010:1:2',
    ])('rejects malformed cursor %s before making a request', async (invalidCursor) => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
        fetchSpy = spyOn(globalThis, 'fetch')
        await expect(getControllerCertificateEvents(invalidCursor)).rejects.toMatchObject({
            code: 'invalid_input',
        })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    test.each([
        ['unknown stage', { stage: 'arbitrary_stage' }],
        ['arbitrary error code', { errorCode: 'arbitrary_error' }],
        ['malformed event UUID', { id: 'not-a-uuid' }],
        ['malformed timestamp', { occurredAt: '2026-09-12' }],
    ])('rejects %s', async (_name, overrides) => {
        mockController({
            events: [event(overrides)],
            nextCursor: null,
            hasMore: false,
            resetRequired: false,
        })
        await expect(getControllerCertificateEvents(null)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })

        mockRawController(
            JSON.stringify({
                events: [event()],
                nextCursor: null,
                hasMore: false,
                resetRequired: false,
            }) + ' '.repeat(512 * 1_024),
        )
        await expect(getControllerCertificateEvents(null)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
    })

    test('rejects duplicate event IDs and oversized pages', async () => {
        mockController({
            events: [event(), event({ id: secondEventId }), event({ id: secondEventId })],
            nextCursor: null,
            hasMore: false,
            resetRequired: false,
        })
        await expect(getControllerCertificateEvents(null)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })

        mockController({
            events: Array.from({ length: 101 }, (_, index) =>
                event({ id: `0198d98a-0000-7000-8000-${String(index + 100).padStart(12, '0')}` }),
            ),
            nextCursor: null,
            hasMore: false,
            resetRequired: false,
        })
        await expect(getControllerCertificateEvents(null)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
    })

    test('maps controller 503 to controller_unavailable', async () => {
        mockController({ error: 'controller_unavailable' }, 503)
        await expect(getControllerCertificateEvents(null)).rejects.toMatchObject({
            code: 'controller_unavailable',
        })
    })
})
