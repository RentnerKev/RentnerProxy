import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
    getProxyRuntimeStatus,
    applyProxyRuntimeConfiguration,
    checkControllerHealth,
} from '../server/Foundation/controller.server'
import { createProxyReconciler } from '../server/ProxyRuntime/proxy-reconcile'
import {
    compareProxyRuntimeStatus,
    createProxyRuntimeSnapshot,
    MAX_RUNTIME_PROXY_HOSTS,
} from '../server/ProxyRuntime/proxy-runtime-snapshot'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
} from '../server/ProxyRuntime/Types/proxy-runtime.types'

type SnapshotInputHost = ProxyRuntimeHost & { readonly enabled: boolean }

const BASE_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const originalEnvironment = new Map<string, string | undefined>()
const CONTROLLER_ENVIRONMENT = ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN']

for (const variable of CONTROLLER_ENVIRONMENT) {
    originalEnvironment.set(variable, process.env[variable])
}

function inputHost(overrides: Partial<SnapshotInputHost> = {}): SnapshotInputHost {
    return {
        id: BASE_ID,
        domains: ['demo.test'],
        enabled: true,
        forwardScheme: 'http',
        forwardHost: 'backend.internal',
        forwardPort: 4_000,
        ...overrides,
    }
}

function snapshot(overrides: Partial<SnapshotInputHost> = {}): ProxyRuntimeSnapshot {
    return createProxyRuntimeSnapshot([inputHost(overrides)])
}

function restoreControllerEnvironment(): void {
    for (const variable of CONTROLLER_ENVIRONMENT) {
        const originalValue = originalEnvironment.get(variable)
        if (originalValue === undefined) delete process.env[variable]
        else process.env[variable] = originalValue
    }
}

afterEach(() => {
    restoreControllerEnvironment()
})

describe('proxy runtime snapshots', () => {
    test('produces the versioned known-vector SHA-256 revision', () => {
        const result = createProxyRuntimeSnapshot([
            inputHost({ domains: ['www.demo.test', 'demo.test'] }),
        ])

        expect(result).toEqual({
            version: 1,
            revision: 'sha256:94a8eb29658512ed7439838b334ef5ce7e5e2e43f50b46d3e85579e49bd554b4',
            proxyHosts: [
                {
                    id: BASE_ID,
                    domains: ['demo.test', 'www.demo.test'],
                    forwardScheme: 'http',
                    forwardHost: 'backend.internal',
                    forwardPort: 4_000,
                },
            ],
        })
    })

    test('filters disabled hosts and sorts hosts and domains deterministically', () => {
        const enabledSecond = inputHost({
            id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
            domains: ['z.demo.test', 'a.demo.test'],
        })
        const disabled = inputHost({
            id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
            domains: ['disabled.demo.test'],
            enabled: false,
        })
        const result = createProxyRuntimeSnapshot([enabledSecond, disabled, inputHost()])

        expect(result.proxyHosts.map(({ id }) => id)).toEqual([BASE_ID, enabledSecond.id])
        expect(result.proxyHosts[1]?.domains).toEqual(['a.demo.test', 'z.demo.test'])
        expect(
            result.proxyHosts.some(({ domains }) => domains.includes('disabled.demo.test')),
        ).toBeFalse()
    })

    test('is stable across input ordering and changes when runtime content changes', () => {
        const first = createProxyRuntimeSnapshot([
            inputHost({ domains: ['z.demo.test', 'demo.test'] }),
            inputHost({
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
                domains: ['api.demo.test'],
                forwardPort: 4_001,
            }),
        ])
        const reordered = createProxyRuntimeSnapshot([
            inputHost({
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
                domains: ['api.demo.test'],
                forwardPort: 4_001,
            }),
            inputHost({ domains: ['demo.test', 'z.demo.test'] }),
        ])
        const changed = createProxyRuntimeSnapshot([
            inputHost({ domains: ['z.demo.test', 'demo.test'], forwardPort: 4_002 }),
            inputHost({
                id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
                domains: ['api.demo.test'],
                forwardPort: 4_001,
            }),
        ])

        expect(reordered).toEqual(first)
        expect(changed.revision).not.toBe(first.revision)
    })

    test('rejects duplicate runtime identities, injection values, and excessive limits', () => {
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost(),
                inputHost({ id: BASE_ID, domains: ['other.demo.test'] }),
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({ domains: ['same.demo.test', 'same.demo.test'] }),
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({ domains: ['demo.test\nserver { return 200; }'] }),
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({ forwardHost: 'backend.internal; proxy_pass http://evil' }),
            ]),
        ).toThrow()

        const tooManyHosts = Array.from({ length: MAX_RUNTIME_PROXY_HOSTS + 1 }, (_, index) =>
            inputHost({
                id: `018f2f52-7c1b-7cc0-9f3c-${String(index).padStart(12, '0')}`,
                domains: [`host-${index}.demo.test`],
            }),
        )
        expect(() => createProxyRuntimeSnapshot(tooManyHosts)).toThrow()
    })

    test('compares desired and active runtime status safely', () => {
        const desiredRevision = snapshot().revision
        expect(compareProxyRuntimeStatus(desiredRevision, null)).toMatchObject({
            state: 'unavailable',
            desiredRevision,
        })
        expect(
            compareProxyRuntimeStatus(desiredRevision, {
                available: true,
                running: true,
                activeRevision: desiredRevision,
                lastApplyAt: null,
            }),
        ).toMatchObject({ state: 'synced', desiredRevision })
        expect(
            compareProxyRuntimeStatus(desiredRevision, {
                available: true,
                running: true,
                activeRevision: 'sha256:' + '0'.repeat(64),
                lastApplyAt: null,
            }),
        ).toMatchObject({ state: 'pending', desiredRevision })
    })
})

describe('proxy runtime reconciliation', () => {
    test('coalesces concurrent requests and applies a latest snapshot before success', async () => {
        const first = snapshot()
        const latest = snapshot({ forwardPort: 4_001 })
        let current = first
        let applyStarted!: () => void
        let releaseApply!: () => void
        const started = new Promise<void>((resolve) => {
            applyStarted = resolve
        })
        const gate = new Promise<void>((resolve) => {
            releaseApply = resolve
        })
        const applied: string[] = []
        const reconciler = createProxyReconciler({
            loadSnapshot: async () => current,
            applySnapshot: async (value) => {
                applied.push(value.revision)
                if (applied.length === 1) {
                    current = latest
                    applyStarted()
                    await gate
                }
                return { status: 'applied', activeRevision: value.revision, lastApplyAt: null }
            },
        })

        const firstRequest = reconciler()
        await started
        const secondRequest = reconciler()
        expect(secondRequest).toBe(firstRequest)
        releaseApply()

        expect(await firstRequest).toBe('applied')
        expect(applied).toEqual([first.revision, latest.revision])
    })

    test('returns pending for a stalled read and never applies its late result', async () => {
        const current = snapshot()
        let releaseRead!: (value: ProxyRuntimeSnapshot) => void
        const stalled = new Promise<ProxyRuntimeSnapshot>((resolve) => {
            releaseRead = resolve
        })
        let reads = 0
        let applies = 0
        const reconcile = createProxyReconciler(
            {
                loadSnapshot: async () => {
                    reads += 1
                    return reads === 1 ? stalled : current
                },
                applySnapshot: async (value) => {
                    applies += 1
                    return { status: 'applied', activeRevision: value.revision, lastApplyAt: null }
                },
            },
            25,
        )

        expect(await reconcile()).toBe('pending')
        expect(applies).toBe(0)
        releaseRead(current)
        await Bun.sleep(0)
        expect(applies).toBe(0)
        expect(await reconcile()).toBe('applied')
        expect(applies).toBe(1)
    })

    test('keeps a stalled post-apply confirmation within the same deadline', async () => {
        const current = snapshot()
        let reads = 0
        const reconcile = createProxyReconciler(
            {
                loadSnapshot: async () => {
                    reads += 1
                    return reads === 1
                        ? current
                        : new Promise<ProxyRuntimeSnapshot>(() => undefined)
                },
                applySnapshot: async (value) => ({
                    status: 'applied',
                    activeRevision: value.revision,
                    lastApplyAt: null,
                }),
            },
            25,
        )

        expect(await reconcile()).toBe('pending')
        expect(reads).toBe(2)
    })
    test('bounds retries and reports pending when apply or loading fails', async () => {
        let attempts = 0
        const retrying = createProxyReconciler({
            loadSnapshot: async () => snapshot(),
            applySnapshot: async () => {
                attempts += 1
                return null
            },
        })
        expect(await retrying()).toBe('pending')
        expect(attempts).toBeGreaterThan(0)
        expect(attempts).toBeLessThanOrEqual(3)

        const failingLoad = createProxyReconciler({
            loadSnapshot: async () => Promise.reject(new Error('database unavailable')),
            applySnapshot: async () => {
                throw new Error('must not apply')
            },
        })
        expect(await failingLoad()).toBe('pending')
    })
})

describe('controller runtime client', () => {
    test('keeps health unauthenticated while sending Bearer only to privileged endpoints', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'A'.repeat(32)
        const current = snapshot()
        const fetchMock = spyOn(globalThis, 'fetch')
        fetchMock.mockImplementation((async (
            _input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            const path = new URL(String(_input)).pathname
            const body =
                path === '/health'
                    ? { status: 'ok', service: 'rentnerproxy-controller', version: '0.0.0' }
                    : path === '/internal/v1/proxy/status'
                      ? {
                            available: true,
                            running: true,
                            activeRevision: current.revision,
                            lastApplyAt: null,
                        }
                      : { status: 'applied', activeRevision: current.revision, lastApplyAt: null }
            expect(init?.redirect).toBe('error')
            return new Response(JSON.stringify(body), {
                headers: { 'content-type': 'application/json' },
            })
        }) as unknown as typeof fetch)

        expect(await checkControllerHealth()).toEqual({ state: 'connected' })
        expect(await getProxyRuntimeStatus()).toMatchObject({ activeRevision: current.revision })
        expect(await applyProxyRuntimeConfiguration(current)).toMatchObject({
            activeRevision: current.revision,
        })
        const healthRequest = fetchMock.mock.calls[0]?.[1]
        const statusRequest = fetchMock.mock.calls[1]?.[1]
        expect(healthRequest?.headers).not.toHaveProperty('authorization')
        expect(statusRequest?.headers).toMatchObject({ authorization: 'Bearer ' + 'A'.repeat(32) })
        fetchMock.mockRestore()
    })

    test('refuses privileged requests without a valid token on non-loopback controllers', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example:8081'
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('Unexpected network call in controller token validation test.'),
        )
        try {
            expect(await getProxyRuntimeStatus()).toBeNull()
            expect(await applyProxyRuntimeConfiguration(snapshot())).toBeNull()
            process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'too-short'
            expect(await getProxyRuntimeStatus()).toBeNull()
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('rejects invalid, oversized, redirected, and revision-mismatched responses without leaking errors', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example:8081'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'B'.repeat(32)
        const current = snapshot()
        const warnings = spyOn(console, 'warn').mockImplementation(() => undefined)
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('token=private'))
        expect(await getProxyRuntimeStatus()).toBeNull()
        expect(warnings.mock.calls.flat().join(' ')).not.toContain('private')
        fetchMock.mockRestore()
        warnings.mockRestore()

        const responses = [
            new Response('x'.repeat(4_097), { headers: { 'content-type': 'application/json' } }),
            new Response(
                JSON.stringify({
                    status: 'applied',
                    activeRevision: 'sha256:' + '0'.repeat(64),
                    lastApplyAt: null,
                }),
                {
                    headers: { 'content-type': 'application/json' },
                },
            ),
        ]
        const responseMock = spyOn(globalThis, 'fetch')
        responseMock.mockImplementation((async (
            _input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            expect(init?.redirect).toBe('error')
            return (
                responses.shift() ??
                new Response('{}', { headers: { 'content-type': 'text/plain' } })
            )
        }) as unknown as typeof fetch)
        expect(await getProxyRuntimeStatus()).toBeNull()
        expect(await applyProxyRuntimeConfiguration(current)).toBeNull()
        responseMock.mockRestore()
    })
})
