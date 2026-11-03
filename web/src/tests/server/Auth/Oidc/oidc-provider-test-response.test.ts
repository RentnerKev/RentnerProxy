import { expect, mock, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { OidcDomainError } from '@/server/Auth/Oidc/oidc.errors.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { createOidcProviderTestResponseHandler } =
    await import('@/server/Auth/Oidc/oidc-provider-test-response.server.ts')
if (originalDatabase === undefined) delete process.env.DATABASE_URL
const input = { providerId: '0194f777-4074-7000-8000-000000000003', expectedRevision: 1 }
const result = {
    status: 'metadata_verified' as const,
    callbackUrl: 'https://proxy.example/api/auth/oidc/callback',
}
function request(body: BodyInit = JSON.stringify(input), origin = 'https://proxy.example') {
    return new Request('https://untrusted-host.example/api/admin/oidc/providers/test', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body,
    })
}
function fixture(error?: unknown, serviceError?: unknown) {
    const authorize = mock(async () => {
        if (error) throw error
    })
    const probe = mock(async () => {
        if (serviceError) throw serviceError
        return result
    })
    return {
        authorize,
        probe,
        handle: createOidcProviderTestResponseHandler({
            origin: () => 'https://proxy.example',
            authorize,
            test: probe,
        }),
    }
}
test('accepts only a saved reference and delegates once with private responses', async () => {
    const { handle, probe } = fixture()
    const response = await handle(request())
    expect(await response.json()).toEqual(result)
    expect(probe.mock.calls).toHaveLength(1)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
})
test.each(['authentication_required', 'owner_required'] as const)(
    'rejects %s before pulling the body',
    async (code) => {
        let pulls = 0
        const body = new ReadableStream<Uint8Array>(
            {
                pull() {
                    pulls++
                },
            },
            { highWaterMark: 0 },
        )
        const { handle, probe } = fixture(new AuthDomainError(code, 'secret details'))
        const response = await handle(request(body))
        expect(response.status).toBe(code === 'authentication_required' ? 401 : 403)
        expect(await response.json()).toEqual({ error: code })
        expect(pulls).toBe(0)
        expect(probe).not.toHaveBeenCalled()
    },
)
test('checks canonical origin and strict schema, size and method', async () => {
    const { handle, probe } = fixture()
    expect((await handle(request('{}', 'https://other.example'))).status).toBe(403)
    expect((await handle(new Request('https://proxy.example'))).status).toBe(405)
    expect((await handle(request('{broken'))).status).toBe(400)
    expect((await handle(request(' '.repeat(OIDC_LIMITS.startBodyBytes + 1)))).status).toBe(413)
    for (const value of [
        { ...input, issuer: 'https://arbitrary.example' },
        { ...input, expectedRevision: -1 },
        { ...input, expectedRevision: Number.MAX_SAFE_INTEGER },
        { ...input, providerId: 'invalid' },
    ]) {
        // oxlint-disable-next-line no-await-in-loop -- Each malformed request is independent.
        expect((await handle(request(JSON.stringify(value)))).status).toBe(422)
    }
    expect(probe).not.toHaveBeenCalled()
})
test('bounds stalled body input', async () => {
    const body = new ReadableStream<Uint8Array>({ pull() {} }, { highWaterMark: 0 })
    const { handle, probe } = fixture()
    const response = await handle(request(body))
    expect(response.status).toBe(408)
    expect(probe).not.toHaveBeenCalled()
})
test.each([
    [new OidcDomainError('configuration_conflict'), 409, 'configuration_conflict'],
    [new OidcDomainError('provider_unavailable'), 503, 'provider_unavailable'],
    [new Error('https://private.example/secret'), 503, 'configuration_unavailable'],
    [new RateLimitError(11, 10, 1234, 'oidc-configuration'), 429, 'rate_limited'],
] as const)('redacts failures', async (error, status, code) => {
    const { handle } = fixture(undefined, error)
    const response = await handle(request())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: code })
})
