import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
    applyCrowdSecConfiguration,
    enrollCrowdSecConsole,
    getCrowdSecRuntimeStatus,
    testCrowdSecControllerConnection,
} from '../server/Foundation/controller.server'

const originalEnvironment = new Map<string, string | undefined>()
const controllerEnvironment = [
    'RENTNERPROXY_CONTROLLER_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
] as const
const controllerToken = 'C'.repeat(32)
const externalApiKey = 'external-bouncer-key-value'

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
    test('never sends a Console enrollment key to a remote plaintext controller', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example.test:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = controllerToken
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Key must stay private.'),
        )
        try {
            expect(await enrollCrowdSecConsole('0123456789abcdef')).toBe('unavailable')
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
            expect(JSON.parse(String(init?.body))).toEqual({ enrollmentKey: '0123456789abcdef' })
            return Response.json({ status: 'pending' })
        }) as unknown as typeof fetch)
        try {
            expect(await enrollCrowdSecConsole('0123456789abcdef')).toBe('pending')
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
