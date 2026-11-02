import { describe, expect, test } from 'bun:test'
import { getRequest, getRequestIP } from '@tanstack/react-start/server'
import { createServerEntry } from '@tanstack/react-start/server-entry'

import { createRuntimeFetch } from '../../../../../../docker/web/request-context.ts'
import {
    createRateLimitKey,
    consumeRateLimit,
    enforceAuthRateLimit,
    RateLimitError,
} from '@/server/Valkey/rate-limiter.service.ts'
import type { ValkeyCommandClient } from '@/server/Valkey/Types/valkey.types.ts'
import { OIDC_RATE_LIMIT } from '@/config/oidc.config.ts'
import { getOidcClientIp } from '@/server/Auth/Oidc/oidc-request-ip.server.ts'
import { createOidcHttpHandlers } from '@/server/Auth/Oidc/oidc-response.server.ts'
import { withRequestAbortHandling } from '@/server/request-abort.server.ts'

describe('production request peer addresses', () => {
    test.each([undefined, 'false', 'true', 'TRUE'])(
        'enforces OIDC limits through the raw route context with forwarding trust %j',
        async (configuredTrust) => {
            const originalTrust = process.env.RENTNERPROXY_TRUST_PROXY_HEADERS
            if (configuredTrust === undefined) delete process.env.RENTNERPROXY_TRUST_PROXY_HEADERS
            else process.env.RENTNERPROXY_TRUST_PROXY_HEADERS = configuredTrust
            const trustProxyHeaders = configuredTrust === 'true'
            const counts = new Map<string, number>()
            const windows = new Set<string>()
            const client: ValkeyCommandClient = {
                ping: async () => 'PONG',
                send: async (_command, args) => {
                    const key = args[2]!
                    const count = (counts.get(key) ?? 0) + 1
                    counts.set(key, count)
                    windows.add(args[3]!)
                    return [count, 60_000]
                },
            }
            const handlers = createOidcHttpHandlers({
                origin: () => 'https://proxy.example.test',
                limit: async () => {
                    await consumeRateLimit(
                        { ...OIDC_RATE_LIMIT, identifier: getOidcClientIp() },
                        { getClient: () => client },
                    )
                },
                signedIn: async () => true,
                begin: async () => {
                    throw new Error('unexpected OIDC exchange')
                },
                complete: async () => {
                    throw new Error('unexpected OIDC exchange')
                },
            })
            const handler = withRequestAbortHandling(
                createServerEntry({ fetch: () => handlers.callback(getRequest()) }).fetch,
            )
            const runtimeFetch = createRuntimeFetch({ fetch: (request) => handler(request, {}) })
            const attempt = (address: string) =>
                runtimeFetch(
                    new Request('http://internal:3000/api/auth/oidc/callback', {
                        headers: { 'x-forwarded-for': `192.0.2.99, ${address}` },
                    }),
                    { requestIP: () => ({ address: '127.0.0.1' }) },
                )

            try {
                const responses = await Promise.all([
                    ...Array.from({ length: 21 }, () => attempt('198.51.100.8')),
                    attempt('198.51.100.9'),
                ])
                expect(
                    responses
                        .slice(0, 21)
                        .filter((response) => response.headers.get('location') === '/'),
                ).toHaveLength(20)
                expect(responses[20]?.headers.get('location')).toBe('/login?oidcError=failed')
                expect(responses[21]?.headers.get('location')).toBe(
                    trustProxyHeaders ? '/' : '/login?oidcError=failed',
                )
                expect(windows).toEqual(new Set(['60000']))
                expect(counts.size).toBe(trustProxyHeaders ? 2 : 1)
                expect(
                    counts.get(
                        createRateLimitKey(
                            'oidc-login',
                            trustProxyHeaders ? '198.51.100.8' : '127.0.0.1',
                        ),
                    ),
                ).toBe(trustProxyHeaders ? 21 : 22)
                expect(counts.has(createRateLimitKey('oidc-login', '192.0.2.99'))).toBeFalse()
                expect(counts.has(createRateLimitKey('oidc-login', 'unknown'))).toBeFalse()
            } finally {
                if (originalTrust === undefined) delete process.env.RENTNERPROXY_TRUST_PROXY_HEADERS
                else process.env.RENTNERPROXY_TRUST_PROXY_HEADERS = originalTrust
            }
        },
    )

    test('makes the Bun connection address available inside the TanStack request context', async () => {
        const application = {
            fetch: createServerEntry({
                fetch: async () => {
                    await Promise.resolve()
                    return Response.json({ ip: getRequestIP() ?? null })
                },
            }).fetch,
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
        const client: ValkeyCommandClient = {
            ping: async () => 'PONG',
            send: async (_command, args) => {
                const key = args[2]!
                const count = (counts.get(key) ?? 0) + 1
                counts.set(key, count)
                return [count, 600_000]
            },
        }
        const handler = createServerEntry({
            fetch: async () => {
                await Promise.resolve()
                const request = getRequest()
                try {
                    await enforceAuthRateLimit(
                        {
                            action: 'login',
                            email: `${new URL(request.url).pathname}@example.com`,
                            request,
                        },
                        {
                            getClient: () => client,
                            resolveClientIp: () => getRequestIP() ?? 'unknown',
                        },
                    )
                    return new Response(null, { status: 204 })
                } catch (error) {
                    if (error instanceof RateLimitError) return new Response(null, { status: 429 })
                    throw error
                }
            },
        }).fetch
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
            const handler = createServerEntry({
                fetch: () => Response.json({ ip: getRequestIP() ?? null }),
            }).fetch
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
