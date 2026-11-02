import { expect, mock, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { OidcDomainError } from '@/server/Auth/Oidc/oidc.errors.ts'
import { RateLimitError, RateLimitUnavailableError } from '@/server/Valkey/rate-limiter.service.ts'

const originalDatabase = process.env.DATABASE_URL
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit'
const { createOidcProviderResponseHandler } =
    await import('@/server/Auth/Oidc/oidc-provider-response.server.ts')
if (originalDatabase === undefined) delete process.env.DATABASE_URL

/** Creates same-origin JSON requests without relying on an application server or database. */
function request(
    body = JSON.stringify({ expectedRevision: 0, providers: [] }),
    headers: Record<string, string> = {},
) {
    return new Request('https://proxy.example.test/api/admin/oidc/providers', {
        method: 'POST',
        body,
        headers: {
            origin: 'https://proxy.example.test',
            'content-type': 'application/json',
            ...headers,
        },
    })
}

/** Injects service boundaries to assert request handling never writes before validation or more than once. */
function fixture(error?: unknown, saveOnly = false) {
    const summary = { revision: 1, providers: [] }
    const get = mock(async () => {
        if (error && !saveOnly) throw error
        return summary
    })
    const save = mock(async (_input: unknown) => {
        if (error) throw error
        return summary
    })
    return {
        get,
        save,
        handler: createOidcProviderResponseHandler({
            origin: () => 'https://proxy.example.test',
            get,
            save,
        }),
    }
}

test('GET omits an Origin requirement and POST delegates validated data exactly once', async () => {
    const { handler, get, save } = fixture()
    const read = await handler(new Request('https://proxy.example.test/api/admin/oidc/providers'))
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
        revision: 1,
        providers: [],
        callbackUrl: 'https://proxy.example.test/api/auth/oidc/callback',
    })
    expect(get).toHaveBeenCalledTimes(1)
    const written = await handler(request())
    expect(written.status).toBe(200)
    expect(await written.json()).toEqual({
        revision: 1,
        providers: [],
        callbackUrl: 'https://proxy.example.test/api/auth/oidc/callback',
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0]?.[0]).toEqual({ expectedRevision: 0, providers: [] })
    for (const response of [read, written]) {
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    }
})

test('rejects unauthenticated POST before parsing or pulling its body', async () => {
    const { handler, get, save } = fixture(
        new AuthDomainError('authentication_required', 'private session details'),
    )
    const malformed = await handler(request('{malformed'))
    expect(malformed.status).toBe(401)
    expect(await malformed.json()).toEqual({ error: 'authentication_required' })
    let pulls = 0
    const unreadBody = new ReadableStream<Uint8Array>(
        {
            pull() {
                pulls += 1
            },
        },
        { highWaterMark: 0 },
    )
    const response = await handler(
        new Request('https://proxy.example.test/api/admin/oidc/providers', {
            method: 'POST',
            body: unreadBody,
            headers: { origin: 'https://proxy.example.test', 'content-type': 'application/json' },
        }),
    )
    expect(response.status).toBe(401)
    expect(pulls).toBe(0)
    expect(get).toHaveBeenCalledTimes(2)
    expect(save).not.toHaveBeenCalled()
    await unreadBody.cancel()
})

test.each([
    ['authentication_required', 401],
    ['owner_required', 403],
    ['permission_denied', 403],
    ['reauthentication_required', 403],
    ['service_unavailable', 503],
] as const)('preserves canonical auth denial %s with redacted details', async (code, status) => {
    const { handler } = fixture(
        new AuthDomainError(code, 'private clientSecret and database details'),
    )
    await Promise.all(
        ['GET', 'POST'].map(async (method) => {
            const response = await handler(
                method === 'GET'
                    ? new Request('https://proxy.example.test/api/admin/oidc/providers')
                    : request(),
            )
            expect(response.status).toBe(status)
            expect(await response.text()).not.toContain('private')
        }),
    )
})

test.each([
    ['configuration_conflict', 409],
    ['invalid_input', 422],
    ['identity_not_allowed', 422],
    ['configuration_unavailable', 503],
] as const)('maps OIDC denial %s without serializing rejected settings', async (code, status) => {
    const { handler, save } = fixture(new OidcDomainError(code), true)
    const response = await handler(request())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: code })
    expect(save).toHaveBeenCalledTimes(1)
})

test.each(['https://foreign.example.test', '', 'null', 'https://proxy.example.test/'])(
    'rejects nonexact POST Origin %s before services',
    async (origin) => {
        const { handler, get, save } = fixture()
        expect((await handler(request(undefined, { origin }))).status).toBe(403)
        expect(get).not.toHaveBeenCalled()
        expect(save).not.toHaveBeenCalled()
    },
)

test('rejects missing Origin, wrong content type, malformed JSON, invalid schema and oversized bodies', async () => {
    const { handler, save } = fixture()
    const missingOrigin = request()
    missingOrigin.headers.delete('origin')
    expect((await handler(missingOrigin)).status).toBe(403)
    expect((await handler(request('{}', { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await handler(request('{malformed'))).status).toBe(400)
    expect((await handler(request('{}'))).status).toBe(422)
    expect((await handler(request('x'.repeat(OIDC_LIMITS.configurationBytes + 1)))).status).toBe(
        413,
    )
    expect(save).not.toHaveBeenCalled()
})

test('reports unsupported methods with Allow', async () => {
    const { handler, save } = fixture()
    const response = await handler(
        new Request('https://proxy.example.test/api/admin/oidc/providers', { method: 'DELETE' }),
    )
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, POST')
    expect(save).not.toHaveBeenCalled()
})

test('returns safe unavailable and rate errors without internal secrets', async () => {
    const { handler } = fixture(
        new Error('clientSecret=do-not-expose ciphertext=private connection=private'),
    )
    const response = await handler(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'configuration_unavailable' })
    const limited = await fixture(new RateLimitError(11, 10, 1_501, 'private-scope')).handler(
        request(),
    )
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('2')
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    expect(
        (await fixture(new RateLimitUnavailableError('request_failed')).handler(request())).status,
    ).toBe(503)
})

test('cancels aborted body reads and never delegates a save', async () => {
    const { handler, save } = fixture()
    const controller = new AbortController()
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
        cancel() {
            canceled = true
        },
    })
    const incoming = new Request('https://proxy.example.test/api/admin/oidc/providers', {
        method: 'POST',
        headers: { origin: 'https://proxy.example.test', 'content-type': 'application/json' },
        body,
        signal: controller.signal,
    })
    const response = handler(incoming)
    controller.abort()
    expect((await response).status).toBe(499)
    expect(canceled).toBeTrue()
    expect(save).not.toHaveBeenCalled()
})

test('bounds stalled configuration input to the configured timeout', async () => {
    const { handler, save } = fixture()
    let canceled = false
    const incoming = new Request('https://proxy.example.test/api/admin/oidc/providers', {
        method: 'POST',
        headers: { origin: 'https://proxy.example.test', 'content-type': 'application/json' },
        body: new ReadableStream<Uint8Array>({
            cancel() {
                canceled = true
            },
        }),
    })
    const response = await handler(incoming)
    expect(response.status).toBe(408)
    expect(canceled).toBeTrue()
    expect(save).not.toHaveBeenCalled()
})
