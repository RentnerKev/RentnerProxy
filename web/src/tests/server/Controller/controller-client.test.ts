import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
    applyCrowdSecConfiguration,
    enrollCrowdSecConsole,
    getCrowdSecRuntimeStatus,
    getCrowdSecDashboard,
    testCrowdSecControllerConnection,
} from '@/server/Controller/crowdsec.server.ts'

const originalEnvironment = new Map<string, string | undefined>()
const controllerEnvironment = [
    'RENTNERPROXY_CONTROLLER_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
] as const
const controllerToken = 'C'.repeat(32)
const externalApiKey = 'external-bouncer-key-value'
const syntheticEnrollmentKey = 'a'.repeat(16)

for (const variable of controllerEnvironment) {
    originalEnvironment.set(variable, process.env[variable])
}

afterEach(() => {
    for (const variable of controllerEnvironment) {
        const originalValue = originalEnvironment.get(variable)
        if (originalValue === undefined) delete process.env[variable]
        else process.env[variable] = originalValue
    }
})

function connectedExternalStatus() {
    return {
        mode: 'external',
        state: 'connected',
        apiUrl: 'https://crowdsec.example.test/',
        credentialConfigured: true,
        enforcementActive: true,
        managedEngine: 'stopped',
        communityEnabled: false,
        communityState: 'disabled',
        consoleState: 'not_enrolled',
        failureBehavior: 'fail_open',
        clientIpSource: 'caddy',
    } as const
}

describe('CrowdSec controller client', () => {
    test('requests every matching decision only for country lookup and rejects partial snapshots', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const snapshot = {
            collectedAt: 1_800_000_000,
            metrics: null,
            decisions: {
                total: 240,
                filteredTotal: 120,
                offset: 0,
                limit: 15,
                availableOrigins: ['crowdsec'],
                entries: Array.from({ length: 120 }, (_, id) => ({
                    id,
                    scope: 'Ip' as const,
                    value: `203.0.113.${id + 1}`,
                    origin: 'crowdsec',
                    scenario: 'http-bf',
                    duration: '2h',
                    countryCode: null,
                })),
            },
        }
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
            Response.json(snapshot)) as unknown as typeof fetch)
        const query = {
            offset: 15,
            limit: 15,
            search: 'http',
            origin: 'crowdsec',
            scope: '' as const,
            country: 'DE',
        }
        try {
            expect(await getCrowdSecDashboard(query)).toEqual(snapshot)
            const [input, init] = fetchMock.mock.calls[0]!
            const params = new URL(String(input)).searchParams
            expect(params.get('include_all')).toBe('true')
            expect(params.get('offset')).toBe('0')
            expect(params.get('origin')).toBe('crowdsec')
            expect(params.get('search')).toBe('http')
            expect(params.has('country')).toBeFalse()
            expect(init?.headers).toMatchObject({ authorization: `Bearer ${controllerToken}` })
            expect(await getCrowdSecDashboard({ ...query, country: '' })).toBeNull()
            snapshot.decisions.entries = snapshot.decisions.entries.slice(0, 15)
            expect(await getCrowdSecDashboard(query)).toBeNull()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('loads a bounded dashboard snapshot through authenticated controller access', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const snapshot = {
            collectedAt: 1_800_000_000,
            metrics: {
                blockedRequests: 12,
                activeDecisions: 3,
                blockedByOrigin: [{ origin: 'crowdsec', count: 12 }],
                decisionsByOrigin: [{ origin: 'crowdsec', count: 3 }],
            },
            decisions: {
                total: 1,
                filteredTotal: 1,
                offset: 0,
                limit: 15,
                availableOrigins: ['crowdsec'],
                entries: [
                    {
                        id: 1,
                        scope: 'Ip' as const,
                        value: '203.0.113.4',
                        origin: 'crowdsec',
                        scenario: 'http-bf',
                        duration: '2h',
                        countryCode: null,
                    },
                ],
            },
        }
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            expect(String(input)).toContain('/internal/v1/crowdsec/dashboard?')
            expect(String(input)).toContain('limit=15')
            expect(init?.headers).toMatchObject({ authorization: `Bearer ${controllerToken}` })
            expect(init?.body).toBeUndefined()
            return Response.json(snapshot)
        }) as unknown as typeof fetch)
        try {
            expect(
                await getCrowdSecDashboard({
                    offset: 0,
                    limit: 15,
                    search: '',
                    origin: '',
                    scope: '',
                    country: '',
                }),
            ).toEqual(snapshot)
            expect(fetchMock).toHaveBeenCalledTimes(1)
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('rejects malformed dashboard metrics instead of reporting zero', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
            Response.json({
                collectedAt: 1_800_000_000,
                metrics: {
                    blockedRequests: -1,
                    activeDecisions: 0,
                    blockedByOrigin: [],
                    decisionsByOrigin: [],
                },
                decisions: null,
            })) as unknown as typeof fetch)
        try {
            expect(
                await getCrowdSecDashboard({
                    offset: 0,
                    limit: 15,
                    search: '',
                    origin: '',
                    scope: '',
                    country: '',
                }),
            ).toBeNull()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('never sends a Console enrollment key to a remote plaintext controller', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example.test:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Key must stay private.'),
        )
        try {
            expect(await enrollCrowdSecConsole(syntheticEnrollmentKey)).toBe('unavailable')
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('posts the Console key through an authenticated confidential request', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'https://controller.example.test:8443'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            expect(String(input).endsWith('/internal/v1/crowdsec/console/enroll')).toBeTrue()
            expect(init?.method).toBe('POST')
            expect(init?.redirect).toBe('error')
            expect(init?.headers).toMatchObject({ authorization: `Bearer ${controllerToken}` })
            expect(JSON.parse(String(init?.body))).toEqual({
                enrollmentKey: syntheticEnrollmentKey,
            })
            return Response.json({ status: 'pending' })
        }) as unknown as typeof fetch)
        try {
            expect(await enrollCrowdSecConsole(syntheticEnrollmentKey)).toBe('pending')
            expect(fetchMock).toHaveBeenCalledTimes(1)
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('refuses to send external credentials over remote plaintext HTTP', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example.test:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('External credential must not leave the process.'),
        )

        try {
            expect(
                await applyCrowdSecConfiguration({
                    mode: 'external',
                    apiUrl: 'https://crowdsec.example.test/',
                    apiKey: externalApiKey,
                }),
            ).toBeNull()
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('sends credentials only to an authenticated confidential controller request', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'https://controller.example.test:8443'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (
            _input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            expect(init?.method).toBe('PUT')
            expect(init?.redirect).toBe('error')
            expect(init?.headers).toMatchObject({
                authorization: `Bearer ${controllerToken}`,
                'content-type': 'application/json',
            })
            expect(JSON.parse(String(init?.body))).toEqual({
                mode: 'external',
                apiUrl: 'https://crowdsec.example.test/',
                apiKey: externalApiKey,
            })
            return Response.json(connectedExternalStatus())
        }) as unknown as typeof fetch)

        try {
            expect(
                await applyCrowdSecConfiguration({
                    mode: 'external',
                    apiUrl: 'https://crowdsec.example.test/',
                    apiKey: externalApiKey,
                }),
            ).toEqual(connectedExternalStatus())
            expect(fetchMock).toHaveBeenCalledTimes(1)
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('parses bounded status and external connection results', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const responses = [
            Response.json(connectedExternalStatus()),
            Response.json({ status: 'connected' }),
            Response.json({ error: 'crowdsec_connection_failed' }, { status: 422 }),
        ]
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
            (async () => responses.shift() ?? Response.json({})) as unknown as typeof fetch,
        )

        try {
            expect(await getCrowdSecRuntimeStatus()).toEqual(connectedExternalStatus())
            expect(
                await testCrowdSecControllerConnection({
                    apiUrl: 'https://crowdsec.example.test/',
                    apiKey: externalApiKey,
                }),
            ).toBe('connected')
            expect(
                await testCrowdSecControllerConnection({
                    apiUrl: 'https://crowdsec.example.test/',
                    apiKey: externalApiKey,
                }),
            ).toBe('connection_failed')
        } finally {
            fetchMock.mockRestore()
        }
    })
})
