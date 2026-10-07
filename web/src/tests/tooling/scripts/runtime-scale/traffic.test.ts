import { describe, expect, test } from 'bun:test'
import { verifyConcurrentTraffic } from '../../../../../../scripts/runtime-scale/traffic.ts'
import type { ReliabilityContext } from '../../../../../../scripts/runtime-reliability/Types/harness.types.ts'
import type { ScaleResult } from '../../../../../../scripts/runtime-scale/Types/control.types.ts'

const traffic: ScaleResult['traffic'] = [
    { domain: 'redirect.example', status: 302, location: 'https://example.com' },
    { domain: 'first.example', status: 200, backend: 'a' },
    { domain: 'disabled.example', status: 404 },
    { domain: 'second.example', status: 200, backend: 'b' },
]

describe('concurrent scale traffic', () => {
    test('reports original route indices after selecting proxy routes', async () => {
        const requests: { domain: string | undefined; route: number | undefined }[] = []
        const context = {
            http: async (domain, _path, _headers, route) => {
                requests.push({ domain, route })
                return {
                    status: route === 1 ? 200 : 404,
                    headers: new Headers(),
                    body: { backend: 'tls' },
                }
            },
            recordTrafficFailure: () => {
                throw new Error('Expected traffic must not freeze failure evidence')
            },
        } satisfies Pick<ReliabilityContext, 'http' | 'recordTrafficFailure'>
        await verifyConcurrentTraffic(context, traffic, 2)
        expect(requests).toEqual([
            { domain: 'first.example', route: 1 },
            { domain: 'second.example', route: 3 },
        ])
    })

    test('preserves transport rejection and never retries it', async () => {
        const reset = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' })
        const routes: (number | undefined)[] = []
        const context = {
            http: async (_domain, _path, _headers, route) => {
                routes.push(route)
                throw reset
            },
            recordTrafficFailure: () => {
                throw new Error('The HTTP transport retains its own failure observation')
            },
        } satisfies Pick<ReliabilityContext, 'http' | 'recordTrafficFailure'>
        let failure: unknown
        try {
            await verifyConcurrentTraffic(context, traffic, 1)
        } catch (error) {
            failure = error
        }
        expect(failure).toBe(reset)
        expect(routes).toEqual([1])
    })

    test.each([
        { status: 500, backend: 'a' },
        { status: 200, backend: 'unexpected' },
    ])('retains route and status for an invalid response: %j', async ({ status, backend }) => {
        const failures: { route: number | null; status: number | null }[] = []
        const context = {
            http: async () => ({ status, headers: new Headers(), body: { backend } }),
            recordTrafficFailure: (route, observedStatus) => {
                failures.push({ route, status: observedStatus })
            },
        } satisfies Pick<ReliabilityContext, 'http' | 'recordTrafficFailure'>
        await expect(verifyConcurrentTraffic(context, traffic, 1)).rejects.toThrow()
        expect(failures).toEqual([{ route: 1, status }])
    })
})
