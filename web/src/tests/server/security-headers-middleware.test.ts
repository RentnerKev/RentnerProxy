import { describe, expect, test } from 'bun:test'
import { createServerEntry } from '@tanstack/react-start/server'

const startModule = await (async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    try {
        return await import('@/start.ts')
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
        else delete (globalThis as { window?: unknown }).window
    }
})()

describe('security headers middleware', () => {
    test('sets headers through TanStack Start response context', async () => {
        const options = await startModule.startInstance.getOptions()
        const middleware = options.requestMiddleware?.[0]?.options.server
        if (!middleware) throw new Error('security headers middleware has no server handler')

        const request = new Request('https://localhost/admin')
        const handler = createServerEntry({
            fetch: async () => {
                const result = await middleware({
                    request,
                    pathname: '/admin',
                    context: undefined,
                    handlerType: 'router',
                    next: async () => ({
                        request,
                        pathname: '/admin',
                        context: { cspNonce: 'test-nonce' },
                        response: new Response('ok'),
                    }),
                } as Parameters<typeof middleware>[0])

                return result instanceof Response ? result : result.response
            },
        }).fetch

        const response = await handler(request, {})

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('ok')
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
        expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })

    test('preserves security headers when request middleware throws an error', async () => {
        const options = await startModule.startInstance.getOptions()
        const middleware = options.requestMiddleware?.[0]?.options.server
        if (!middleware) throw new Error('security headers middleware has no server handler')

        const request = new Request('https://localhost/admin')
        const handler = createServerEntry({
            fetch: async () => {
                await middleware({
                    request,
                    pathname: '/admin',
                    context: undefined,
                    handlerType: 'router',
                    next: async () => {
                        throw Object.assign(new Error('private route failure'), { status: 401 })
                    },
                } as Parameters<typeof middleware>[0])
                return new Response('unexpected')
            },
        }).fetch

        const response = await handler(request, {})

        expect(response.status).toBe(401)
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
        expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(await response.text()).not.toContain('private route failure')
    })
})
