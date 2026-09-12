import { describe, expect, test } from 'bun:test'
import { requestHandler } from '@tanstack/react-start/server'

const startModule = await (async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    try {
        return await import('../start')
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
        const handler = requestHandler(async () => {
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
        })

        const response = await handler(request, {})

        expect(response.status).toBe(200)
        expect(await response.text()).toBe('ok')
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
        expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    })
})
