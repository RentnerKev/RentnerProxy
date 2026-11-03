import { describe, expect, test } from 'bun:test'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { OidcDomainError } from '@/server/Auth/Oidc/oidc.errors.ts'
import { createOidcConnectionsResponseHandler } from '@/server/Auth/Oidc/oidc-connections-response.server.ts'

const origin = 'https://proxy.example.test'
const providerId = '0194f777-4074-7000-8000-000000000001'
const summary = {
    revision: 7,
    externallyManaged: true,
    providers: [{ id: providerId, name: 'Office', enabled: true, linked: true }],
}
function post(
    body = JSON.stringify({ providerId, expectedRevision: 7 }),
    headers: HeadersInit = {},
) {
    return new Request(`${origin}/api/auth/oidc/connections`, {
        method: 'POST',
        headers: { origin, 'Content-Type': 'application/json', ...headers },
        body,
    })
}
function fixture(options: { getError?: Error; unlinkError?: Error } = {}) {
    const calls: string[] = []
    const mutations: Array<{ providerId: string; expectedRevision: number }> = []
    const handle = createOidcConnectionsResponseHandler({
        origin: () => origin,
        get: async () => {
            calls.push('get')
            if (options.getError) throw options.getError
            return summary
        },
        unlink: async (input) => {
            calls.push('unlink')
            if (options.unlinkError) throw options.unlinkError
            mutations.push(input)
        },
    })
    return { handle, calls, mutations, post }
}

describe('OIDC self-service connections HTTP boundary', () => {
    test('GET returns only public connection state with private no-store headers and no mutations', async () => {
        const value = fixture()
        const response = await value.handle(new Request(`${origin}/api/auth/oidc/connections`))
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(response.headers.getSetCookie()).toEqual([])
        expect(await response.json()).toEqual(summary)
        expect(value.calls).toEqual(['get'])
        expect(value.mutations).toEqual([])
    })
    test('authenticates GET and POST without exposing internal errors or making mutations', async () => {
        for (const method of ['GET', 'POST']) {
            const value = fixture({
                getError: new AuthDomainError('authentication_required', 'private-session-details'),
            })
            // oxlint-disable-next-line no-await-in-loop -- Separate authenticated endpoint requests.
            const response = await value.handle(
                method === 'GET'
                    ? new Request(`${origin}/api/auth/oidc/connections`)
                    : value.post(),
            )
            expect(response.status).toBe(401)
            // oxlint-disable-next-line no-await-in-loop -- Separate endpoint responses.
            expect(await response.json()).toEqual({ error: 'authentication_required' })
            expect(value.calls).toEqual(['get'])
            expect(value.mutations).toEqual([])
        }
    })
    test('delegates valid unlink once after authenticated read and carries the revision', async () => {
        const value = fixture()
        const response = await value.handle(value.post())
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: true })
        expect(value.calls).toEqual(['get', 'unlink'])
        expect(value.mutations).toEqual([{ providerId, expectedRevision: 7 }])
        expect(response.headers.getSetCookie()).toEqual([])
    })
    for (const foreignOrigin of ['', 'null', 'https://attacker.example.test']) {
        test(`rejects origin ${JSON.stringify(foreignOrigin)} before authenticated reads or writes`, async () => {
            const value = fixture()
            const response = await value.handle(value.post(undefined, { origin: foreignOrigin }))
            expect(response.status).toBe(403)
            expect(value.calls).toEqual([])
            expect(value.mutations).toEqual([])
        })
    }
    test('rejects missing Origin, unsupported content types, methods and aborted requests', async () => {
        const value = fixture()
        const missingOrigin = value.post()
        missingOrigin.headers.delete('origin')
        expect((await value.handle(missingOrigin)).status).toBe(403)
        expect(
            (await value.handle(value.post(undefined, { 'Content-Type': 'text/plain' }))).status,
        ).toBe(415)
        const unsupported = await value.handle(
            new Request(`${origin}/api/auth/oidc/connections`, { method: 'DELETE' }),
        )
        expect(unsupported.status).toBe(405)
        expect(unsupported.headers.get('allow')).toBe('GET, POST')
        const aborted = new Request(`${origin}/api/auth/oidc/connections`, {
            signal: AbortSignal.abort(),
        })
        expect((await value.handle(aborted)).status).toBe(499)
        expect(value.calls).toEqual([])
    })
    for (const [body, status] of [
        ['{', 400],
        ['x'.repeat(1_025), 413],
        [JSON.stringify({ providerId, expectedRevision: -1 }), 422],
        [JSON.stringify({ providerId: 'invalid', expectedRevision: 7 }), 422],
        [JSON.stringify({ providerId, expectedRevision: 7, userId: providerId }), 422],
        [JSON.stringify({ providerId }), 422],
    ] as const) {
        test(`rejects malformed or unbounded unlink input with ${status}`, async () => {
            const value = fixture()
            const response = await value.handle(value.post(body))
            expect(response.status).toBe(status)
            expect(await response.json()).toEqual({ error: 'invalid_input' })
            expect(value.calls).toEqual(['get'])
            expect(value.mutations).toEqual([])
        })
    }
    for (const [error, status, code] of [
        [new OidcDomainError('configuration_conflict'), 409, 'configuration_conflict'],
        [new OidcDomainError('identity_not_allowed'), 422, 'identity_not_allowed'],
        [new Error('raw-token-and-private-identity'), 503, 'configuration_unavailable'],
    ] as const) {
        test(`returns safe ${code} when the fresh mutation service refuses unlink`, async () => {
            const value = fixture({ unlinkError: error })
            const response = await value.handle(value.post())
            expect(response.status).toBe(status)
            expect(await response.json()).toEqual({ error: code })
            expect(value.calls).toEqual(['get', 'unlink'])
            expect(value.mutations).toEqual([])
            expect(response.headers.getSetCookie()).toEqual([])
        })
    }
})
