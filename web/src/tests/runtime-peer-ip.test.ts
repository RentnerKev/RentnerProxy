import { describe, expect, test } from 'bun:test'
import { getRequest, getRequestIP, requestHandler } from '@tanstack/react-start/server'

import { createRuntimeFetch } from '../../../docker/web/request-context'
import {
    createRateLimitKey,
    enforceAuthRateLimit,
    RateLimitError,
} from '../server/redis/rate-limiter.service'
import type { RedisCommandClient } from '../server/redis/Types/redis.types'

describe('production request peer addresses', () => {
    test('makes the Bun connection address available inside the TanStack request context', async () => {
        const application = {
            fetch: requestHandler(async () => {
                await Promise.resolve()
                return Response.json({ ip: getRequestIP() ?? null })
            }),
        }
        const server = Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            fetch: createRuntimeFetch({ fetch: (request) => application.fetch(request, {}) }),
        })

        try {
            const response = await fetch(new URL('/login', server.url), {
                headers: {
                    forwarded: 'for=198.51.100.8',
                    'x-forwarded-for': '198.51.100.9',
                    'x-real-ip': '198.51.100.10',
                },
            })

            expect(await response.json()).toEqual({ ip: '127.0.0.1' })
        } finally {
            await server.stop(true)
        }
    })

    test('isolates simultaneous clients so one exhausted bucket does not block another peer', async () => {
        const counts = new Map<string, number>()
        const client: RedisCommandClient = {
            ping: async () => 'PONG',
            send: async (_command, args) => {
                const key = args[2]!
                const count = (counts.get(key) ?? 0) + 1
                counts.set(key, count)
                return [count, 600_000]
            },
        }
        const handler = requestHandler(async () => {
            await Promise.resolve()
            const request = getRequest()
            try {
                await enforceAuthRateLimit(
                    {
                        action: 'login',
                        email: `${new URL(request.url).pathname}@example.com`,
                        request,
                    },
                    { getClient: () => client, resolveClientIp: () => getRequestIP() ?? 'unknown' },
                )
                return new Response(null, { status: 204 })
            } catch (error) {
                if (error instanceof RateLimitError) return new Response(null, { status: 429 })
                throw error
            }
        })
        const runtimeFetch = createRuntimeFetch({ fetch: (request) => handler(request, {}) })
        const responses = await Promise.all([
            ...Array.from({ length: 21 }, (_, index) =>
                runtimeFetch(new Request(`http://localhost/attempt-${index}`), {
                    requestIP: () => ({ address: '203.0.113.7' }),
                }),
            ),
            runtimeFetch(new Request('http://localhost/other-client'), {
                requestIP: () => ({ address: '203.0.113.8' }),
            }),
        ])

        expect(responses.slice(0, 21).filter((response) => response.status === 204)).toHaveLength(
            20,
        )
        expect(responses.slice(0, 21).filter((response) => response.status === 429)).toHaveLength(1)
        expect(responses[21]?.status).toBe(204)
        expect(counts.get(createRateLimitKey('login-ip', '203.0.113.7'))).toBe(21)
        expect(counts.get(createRateLimitKey('login-ip', '203.0.113.8'))).toBe(1)
        expect(counts.has(createRateLimitKey('login-ip', 'unknown'))).toBeFalse()
    })

    test.each([null, { address: 'invalid' }])(
        'keeps missing or invalid connection addresses unavailable despite forwarded headers: %j',
        async (peer) => {
            const handler = requestHandler(() => Response.json({ ip: getRequestIP() ?? null }))
            const runtimeFetch = createRuntimeFetch({ fetch: (request) => handler(request, {}) })
            const response = await runtimeFetch(
                new Request('http://localhost/login', {
                    headers: { 'x-forwarded-for': '198.51.100.9' },
                }),
                { requestIP: () => peer },
            )

            expect(await response.json()).toEqual({ ip: null })
        },
    )
})
