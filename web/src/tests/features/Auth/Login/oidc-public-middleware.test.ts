import { expect, mock, test } from 'bun:test'

const headers = new Map<string, string>()
let method: string | undefined
let run: (() => Promise<unknown>) | undefined
let failure = false
mock.module('@tanstack/react-start', () => ({
    createServerFn: (options: { method: string }) => {
        method = options.method
        return {
            handler: (handler: () => Promise<unknown>) => {
                run = handler
                return handler
            },
        }
    },
}))
mock.module('@tanstack/react-start/server', () => ({
    setResponseHeader: (name: string, value: string) => {
        headers.set(name, value)
    },
}))
mock.module('@/server/Auth/Oidc/oidc-providers.service.ts', () => ({
    getPublicOidcProvidersService: async () => {
        if (failure) throw new Error('private database connection or credential details')
        return [{ id: '0194f777-4074-7000-8000-000000000003', name: 'Office' }]
    },
}))
await import('@/features/Auth/Oidc/middleware.ts')

test('public provider GET never caches or reveals internal failure details', async () => {
    expect(method).toBe('GET')
    expect(await run!()).toEqual([{ id: '0194f777-4074-7000-8000-000000000003', name: 'Office' }])
    expect(headers.get('Cache-Control')).toBe('private, no-store')
    failure = true
    expect(await run!()).toEqual([])
    expect(headers.get('Cache-Control')).toBe('private, no-store')
})
