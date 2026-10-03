import { describe, expect, test } from 'bun:test'

import { probeStartupRoute } from '../../../../../.github/scripts/appliance-startup-smoke.ts'

describe('continuous appliance startup probes', () => {
    test('requires the configured host and exact route response', async () => {
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: (request) => new Response(request.headers.get('host') ?? ''),
        })
        try {
            expect(
                (await probeStartupRoute('http', server.port!, 'route.test', 'route.test')).ok,
            ).toBe(true)
            expect((await probeStartupRoute('http', server.port!, 'route.test', 'other')).ok).toBe(
                false,
            )
        } finally {
            server.stop(true)
        }
    })

    test('does not accept redirects or oversized responses', async () => {
        let status = 302
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: () => new Response(status === 302 ? 'marker' : 'x'.repeat(8192), { status }),
        })
        try {
            expect((await probeStartupRoute('http', server.port!, 'route.test', 'marker')).ok).toBe(
                false,
            )
            status = 200
            expect(
                (await probeStartupRoute('http', server.port!, 'route.test', 'x'.repeat(8192))).ok,
            ).toBe(false)
        } finally {
            server.stop(true)
        }
    })

    test('bounds unavailable probes without retaining raw network errors', async () => {
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: async () => {
                await Bun.sleep(300)
                return new Response('marker')
            },
        })
        try {
            const probe = await probeStartupRoute('http', server.port!, 'route.test', 'marker', 30)
            expect(probe.ok).toBe(false)
            expect(probe.elapsedMs).toBeLessThan(250)
            expect(Object.keys(probe).toSorted()).toEqual(['elapsedMs', 'ok'])
        } finally {
            server.stop(true)
        }
    })
})
