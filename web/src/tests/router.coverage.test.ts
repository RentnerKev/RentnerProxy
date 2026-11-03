import { expect, mock, test } from 'bun:test'
let beforeLoad: (() => void) | undefined
const update = mock((_options: unknown) => {})
const router = {
    options: {
        additionalContext: { serverContext: { cspNonce: 'A'.repeat(24) as unknown } },
        ssr: { existing: true },
    },
    update,
    subscribe: (_event: string, callback: () => void) => {
        beforeLoad = callback
    },
}
const create = mock((_options: unknown) => router)
mock.module('@tanstack/react-router', () => ({ createRouter: create }))
mock.module('@/routeTree.gen.ts', () => ({ routeTree: 'fixture-routes' }))
mock.module('@/shared/SystemStatePage/GlobalErrorPage.tsx', () => ({ default: () => null }))
mock.module('@/shared/SystemStatePage/NotFoundPage.tsx', () => ({ default: () => null }))
mock.module('@/shared/SystemStatePage/DelayedLoadingPage.tsx', () => ({ default: () => null }))
const { getRouter } = await import('@/router.tsx')

test('router propagates only validated CSP nonces into SSR options while preserving existing SSR settings', () => {
    expect(Object.is(getRouter(), router)).toBe(true)
    expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
            routeTree: 'fixture-routes',
            scrollRestoration: true,
            notFoundMode: 'root',
            defaultPendingMinMs: 0,
        }),
    )
    beforeLoad?.()
    expect(update).toHaveBeenCalledWith({ ssr: { existing: true, nonce: 'A'.repeat(24) } })
    update.mockClear()
    for (const value of ['bad nonce', null, 123]) {
        router.options.additionalContext.serverContext.cspNonce = value
        beforeLoad?.()
    }
    expect(update).not.toHaveBeenCalled()
})
