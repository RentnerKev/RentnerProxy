import { describe, expect, setSystemTime, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { CustomFetch } from 'openid-client'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { createOidcProtocolClient } from '@/server/Auth/Oidc/oidc-client.server.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'

const configuration: OidcClientConfiguration = {
    providerId: 'provider',
    revision: 1,
    issuer: 'https://issuer.example',
    clientId: 'client',
    clientSecret: 'test-only-secret',
    tokenEndpointAuthMethod: 'client_secret_basic',
    allowedEndpointOrigins: ['https://issuer.example'],
    allowedPrivateCidrs: [],
}
const authorization = {
    redirectUri: 'https://proxy.example/api/auth/oidc/callback',
    state: 'state',
    nonce: 'nonce',
    codeVerifier: 'a'.repeat(43),
}
const key = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 })

function fixture(overrides: Record<string, unknown> = {}, invalidSignature = false) {
    const calls: string[] = []
    let consumed = false
    let activeKey = key
    let kid = 'key'
    const fetch: CustomFetch = async (url, init) => {
        calls.push(url)
        if (url.endsWith('/.well-known/openid-configuration'))
            return Response.json({
                issuer: configuration.issuer,
                authorization_endpoint: configuration.issuer + '/authorize',
                token_endpoint: configuration.issuer + '/token',
                jwks_uri: configuration.issuer + '/jwks',
                id_token_signing_alg_values_supported: ['RS256'],
                code_challenge_methods_supported: ['S256'],
            })
        if (url.endsWith('/jwks'))
            return Response.json({
                keys: [
                    {
                        ...activeKey.publicKey.export({ format: 'jwk' }),
                        kid,
                        use: 'sig',
                        alg: 'RS256',
                    },
                ],
            })
        if (url.endsWith('/token')) {
            expect(init.headers.authorization).toStartWith('Basic ')
            const body = new URLSearchParams(String(init.body))
            expect(body.get('code_verifier')).toBe(authorization.codeVerifier)
            expect(body.get('redirect_uri')).toBe(authorization.redirectUri)
            if (consumed || body.get('code') !== 'one-use')
                return Response.json({ error: 'invalid_grant' }, { status: 400 })
            consumed = true
            const now = Math.floor(Date.now() / 1000)
            const claims = {
                iss: configuration.issuer,
                sub: 'subject',
                aud: configuration.clientId,
                exp: now + 120,
                iat: now - 1,
                nonce: authorization.nonce,
                ...overrides,
            }
            const input =
                Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url') +
                '.' +
                Buffer.from(JSON.stringify(claims)).toString('base64url')
            const jwt =
                input +
                '.' +
                sign(
                    'RSA-SHA256',
                    Buffer.from(input),
                    invalidSignature ? otherKey.privateKey : activeKey.privateKey,
                ).toString('base64url')
            return Response.json({
                access_token: 'never-return',
                token_type: 'Bearer',
                id_token: jwt,
            })
        }
        throw new Error('fixture unexpected request')
    }
    return {
        client: createOidcProtocolClient({ fetch: () => fetch }),
        calls,
        fetch,
        rotate: () => {
            activeKey = otherKey
            kid = 'rotated'
            consumed = false
        },
        resetCode: () => {
            consumed = false
        },
    }
}
const callback = () => new URL(authorization.redirectUri + '?code=one-use&state=state')

describe('OIDC protocol with real signed tokens', () => {
    test('builds only code/S256/openid and verifies signature, nonce and identity', async () => {
        const { client, calls } = fixture()
        const url = await client.buildAuthorizationUrl(configuration, authorization)
        expect(url.searchParams.get('scope')).toBe('openid')
        expect(url.searchParams.get('response_type')).toBe('code')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('code_challenge')).toHaveLength(43)
        expect(url.searchParams.get('nonce')).toBe('nonce')
        expect(
            await client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).toEqual({ issuer: configuration.issuer, subject: 'subject' })
        expect(calls.filter((call) => call.includes('well-known'))).toHaveLength(1)
        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
    })
    test.each([
        ['nonce', { nonce: 'other' }],
        ['issuer', { iss: 'https://other.example' }],
        ['audience', { aud: 'other' }],
        ['azp', { azp: 'other' }],
        ['multiple audiences without azp', { aud: ['client', 'other'] }],
        ['expired', { exp: 1 }],
        ['future issued', { iat: Math.floor(Date.now() / 1000) + 120 }],
        ['empty subject', { sub: '' }],
        ['non-string subject', { sub: 123 }],
        ['control subject', { sub: 'bad\nsubject' }],
        ['missing exp', { exp: undefined }],
    ])('rejects %s', async (_label, claims) => {
        const { client } = fixture(claims)
        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
    })
    test.each([1, 5])('accepts issuance clock skew of %s seconds', async (skew) => {
        setSystemTime(new Date('2030-01-01T12:00:00.000Z'))
        try {
            const { client } = fixture({ iat: Math.floor(Date.now() / 1000) + skew })
            expect(
                await client.exchangeAuthorizationCode(configuration, authorization, callback()),
            ).toEqual({ issuer: configuration.issuer, subject: 'subject' })
        } finally {
            setSystemTime()
        }
    })
    test('rejects issuance beyond five seconds and keeps expiry strict', async () => {
        setSystemTime(new Date('2030-01-01T12:00:00.000Z'))
        try {
            const seconds = Math.floor(Date.now() / 1000)
            const future = fixture({ iat: seconds + 6 })
            await expect(
                future.client.exchangeAuthorizationCode(configuration, authorization, callback()),
            ).rejects.toMatchObject({ code: 'authentication_failed' })
            const expired = fixture({ iat: seconds - 10, exp: seconds - 1 })
            await expect(
                expired.client.exchangeAuthorizationCode(configuration, authorization, callback()),
            ).rejects.toMatchObject({ code: 'authentication_failed' })
        } finally {
            setSystemTime()
        }
    })
    test('rejects a forged signature despite valid claims', async () => {
        const { client } = fixture({}, true)
        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
    })
    test('unknown kid cannot repeatedly refresh keys and rotation recovers after bounded cache expiry', async () => {
        const provider = fixture()
        let now = 0
        const client = createOidcProtocolClient({ fetch: () => provider.fetch, now: () => now })
        await client.exchangeAuthorizationCode(configuration, authorization, callback())
        provider.rotate()
        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        provider.resetCode()
        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        expect(provider.calls.filter((call) => call.endsWith('/jwks'))).toHaveLength(1)
        provider.resetCode()
        now = 300_001
        expect(
            await client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).toEqual({ issuer: configuration.issuer, subject: 'subject' })
        expect(provider.calls.filter((call) => call.endsWith('/jwks'))).toHaveLength(2)
    })
    test('rejects wrong state before exchanging a code', async () => {
        const { client, calls } = fixture()
        await expect(
            client.exchangeAuthorizationCode(
                configuration,
                authorization,
                new URL(authorization.redirectUri + '?code=one-use&state=other'),
            ),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        expect(calls.some((url) => url.endsWith('/token'))).toBe(false)
    })
    test('discovery expires, coalesces and fails closed on outage', async () => {
        let now = 0
        let requests = 0
        let outage = false
        const { fetch } = fixture()
        const client = createOidcProtocolClient({
            now: () => now,
            fetch:
                () =>
                async (...args) => {
                    requests++
                    if (outage) throw new Error('private failure')
                    return fetch(...args)
                },
        })
        await Promise.all(
            Array.from({ length: 8 }, () =>
                client.buildAuthorizationUrl(configuration, authorization),
            ),
        )
        expect(requests).toBe(1)
        outage = true
        now = 300_001
        await expect(
            client.buildAuthorizationUrl(configuration, authorization),
        ).rejects.toMatchObject({ code: 'provider_unavailable', message: 'provider_unavailable' })
    })
    test.each([0, 1])(
        'refreshes before code redemption at or inside the complete exchange budget, offset %s',
        async (offset) => {
            const provider = fixture()
            let now = 0
            const client = createOidcProtocolClient({ fetch: () => provider.fetch, now: () => now })
            await client.buildAuthorizationUrl(configuration, authorization)
            now = OIDC_LIMITS.discoveryCacheMs - 2 * OIDC_LIMITS.requestTimeoutMs + offset

            expect(
                await client.exchangeAuthorizationCode(configuration, authorization, callback()),
            ).toEqual({ issuer: configuration.issuer, subject: 'subject' })
            expect(provider.calls.map((url) => new URL(url).pathname)).toEqual([
                '/.well-known/openid-configuration',
                '/.well-known/openid-configuration',
                '/token',
                '/jwks',
            ])
        },
    )
    test('reuses discovery outside the two-request exchange safety window', async () => {
        const provider = fixture()
        let now = 0
        const client = createOidcProtocolClient({ fetch: () => provider.fetch, now: () => now })
        await client.buildAuthorizationUrl(configuration, authorization)
        now = OIDC_LIMITS.discoveryCacheMs - 2 * OIDC_LIMITS.requestTimeoutMs - 1

        expect(
            await client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).toEqual({ issuer: configuration.issuer, subject: 'subject' })
        expect(provider.calls.filter((url) => url.includes('well-known'))).toHaveLength(1)
        expect(provider.calls.filter((url) => url.endsWith('/token'))).toHaveLength(1)
    })
    test('refreshes before one token POST and deferred JWKS cross the old metadata deadline', async () => {
        const provider = fixture()
        let now = 0
        const tokenStarted = Promise.withResolvers<void>()
        const releaseToken = Promise.withResolvers<void>()
        const jwksStarted = Promise.withResolvers<void>()
        const releaseJwks = Promise.withResolvers<void>()
        const calls: string[] = []
        const client = createOidcProtocolClient({
            now: () => now,
            fetch: () => async (url, init) => {
                calls.push(new URL(url).pathname)
                if (url.endsWith('/token')) {
                    expect(init.method).toBe('POST')
                    tokenStarted.resolve()
                    await releaseToken.promise
                } else if (url.endsWith('/jwks')) {
                    jwksStarted.resolve()
                    await releaseJwks.promise
                }
                return provider.fetch(url, init)
            },
        })
        await client.buildAuthorizationUrl(configuration, authorization)
        now = OIDC_LIMITS.discoveryCacheMs - OIDC_LIMITS.requestTimeoutMs
        const exchange = client.exchangeAuthorizationCode(configuration, authorization, callback())
        await tokenStarted.promise
        expect(calls).toEqual([
            '/.well-known/openid-configuration',
            '/.well-known/openid-configuration',
            '/token',
        ])

        now += OIDC_LIMITS.requestTimeoutMs - 1
        releaseToken.resolve()
        await jwksStarted.promise
        now += OIDC_LIMITS.requestTimeoutMs - 1
        expect(now).toBeGreaterThan(OIDC_LIMITS.discoveryCacheMs)
        releaseJwks.resolve()

        expect(await exchange).toEqual({ issuer: configuration.issuer, subject: 'subject' })
        expect(calls.filter((path) => path === '/token')).toHaveLength(1)
        expect(calls.filter((path) => path === '/jwks')).toHaveLength(1)
    })
    test('keeps the refreshed configuration absolute expiry strict without retrying a token POST', async () => {
        const provider = fixture()
        let now = 0
        let refreshedAt = 0
        const client = createOidcProtocolClient({
            now: () => now,
            fetch: () => async (url, init) => {
                if (url.includes('well-known')) refreshedAt = now
                const response = await provider.fetch(url, init)
                if (url.endsWith('/token')) now = refreshedAt + OIDC_LIMITS.discoveryCacheMs
                return response
            },
        })
        await client.buildAuthorizationUrl(configuration, authorization)
        now = OIDC_LIMITS.discoveryCacheMs - 1

        await expect(
            client.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        expect(provider.calls.filter((url) => url.includes('well-known'))).toHaveLength(2)
        expect(provider.calls.filter((url) => url.endsWith('/token'))).toHaveLength(1)
        expect(provider.calls.filter((url) => url.endsWith('/jwks'))).toHaveLength(0)
    })
    test('checks the complete exchange budget again after pending discovery resolves', async () => {
        const provider = fixture()
        let now = 0
        const started = Promise.withResolvers<void>()
        const releaseDiscovery = Promise.withResolvers<void>()
        const client = createOidcProtocolClient({
            now: () => now,
            fetch: () => async (url, init) => {
                if (url.includes('well-known')) {
                    started.resolve()
                    await releaseDiscovery.promise
                }
                return provider.fetch(url, init)
            },
        })
        const discovery = client.buildAuthorizationUrl(configuration, authorization)
        await started.promise
        const exchange = client
            .exchangeAuthorizationCode(configuration, authorization, callback())
            .catch((error: unknown) => error)
        now = OIDC_LIMITS.discoveryCacheMs - 2 * OIDC_LIMITS.requestTimeoutMs
        releaseDiscovery.resolve()

        await discovery
        expect(await exchange).toMatchObject({ code: 'provider_unavailable' })
        expect(provider.calls.filter((url) => url.endsWith('/token'))).toHaveLength(0)
    })
    test('revision churn retains current availability while evicting oldest discovery at the cache cap', async () => {
        const provider = fixture()
        for (let revision = 1; revision <= 40; revision++) {
            // eslint-disable-next-line no-await-in-loop -- Simulate completed provider revisions in insertion order.
            const url = await provider.client.buildAuthorizationUrl(
                { ...configuration, revision },
                authorization,
            )
            expect(url.origin).toBe(configuration.issuer)
        }
        expect(provider.calls).toHaveLength(40)
        await provider.client.buildAuthorizationUrl(
            { ...configuration, revision: 40 },
            authorization,
        )
        expect(provider.calls).toHaveLength(40)
        await provider.client.buildAuthorizationUrl(configuration, authorization)
        expect(provider.calls).toHaveLength(41)
        // Rediscovering revision 1 evicts revision 9, the oldest of the remaining 32 entries.
        await provider.client.buildAuthorizationUrl(
            { ...configuration, revision: 9 },
            authorization,
        )
        expect(provider.calls).toHaveLength(42)
    })
    test('an evicted discovery failure cannot delete a newer entry with the same fingerprint', async () => {
        const provider = fixture()
        let rejectOld!: (reason: Error) => void
        let oldStarted!: () => void
        const started = new Promise<void>((resolve) => {
            oldStarted = resolve
        })
        let sameFingerprintDiscoveries = 0
        const client = createOidcProtocolClient({
            fetch: (current) => async (url, init) => {
                if (current.revision === 1) {
                    sameFingerprintDiscoveries++
                    if (sameFingerprintDiscoveries === 1) {
                        oldStarted()
                        return new Promise<Response>((_resolve, reject) => {
                            rejectOld = reject
                        })
                    }
                }
                return provider.fetch(url, init)
            },
        })
        const old = client
            .buildAuthorizationUrl(configuration, authorization)
            .catch((error: unknown) => error)
        await started
        for (let revision = 2; revision <= 33; revision++) {
            // eslint-disable-next-line no-await-in-loop -- Evict the pending oldest entry through completed later revisions.
            await client.buildAuthorizationUrl({ ...configuration, revision }, authorization)
        }
        await client.buildAuthorizationUrl(configuration, authorization)
        expect(sameFingerprintDiscoveries).toBe(2)
        rejectOld(new Error('fixture old request failure'))
        expect(await old).toMatchObject({ code: 'provider_unavailable' })
        await client.buildAuthorizationUrl(configuration, authorization)
        expect(sameFingerprintDiscoveries).toBe(2)
    })
    test('changed trust policy cannot reuse earlier discovery', async () => {
        const fresh = fixture()
        await fresh.client.buildAuthorizationUrl(configuration, authorization)
        await expect(
            fresh.client.buildAuthorizationUrl(
                { ...configuration, allowedEndpointOrigins: ['https://other.example'] },
                authorization,
            ),
        ).rejects.toMatchObject({ code: 'provider_unavailable' })
    })
    test('rejects untrusted discovery endpoint and excessive JWKS before protocol use', async () => {
        const client = createOidcProtocolClient({
            fetch: () => async () =>
                Response.json({
                    issuer: configuration.issuer,
                    authorization_endpoint: 'https://evil.example/auth',
                    token_endpoint: configuration.issuer + '/token',
                    jwks_uri: configuration.issuer + '/jwks',
                    id_token_signing_alg_values_supported: ['RS256'],
                }),
        })
        await expect(
            client.buildAuthorizationUrl(configuration, authorization),
        ).rejects.toMatchObject({ code: 'provider_unavailable' })
        const { fetch } = fixture()
        const oversized = createOidcProtocolClient({
            fetch: () => async (url, init) =>
                url.endsWith('/jwks')
                    ? Response.json({ keys: Array.from({ length: 33 }, () => ({})) })
                    : fetch(url, init),
        })
        await expect(
            oversized.exchangeAuthorizationCode(configuration, authorization, callback()),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
    })
})

describe('saved-provider metadata probe', () => {
    test('uses fresh discovery and JWKS on every probe without token requests', async () => {
        const { client, calls } = fixture()
        await client.verifyMetadata({ ...configuration, clientSecret: '' })
        await client.verifyMetadata({ ...configuration, clientSecret: '' })
        expect(calls.filter((url) => url.endsWith('/jwks'))).toHaveLength(2)
        expect(calls.filter((url) => url.includes('well-known'))).toHaveLength(2)
        expect(calls.some((url) => url.endsWith('/token'))).toBe(false)
    })
    test.each([
        { keys: [] },
        { keys: [{ kty: 'RSA', n: 'broken', e: 'AQAB' }] },
        { keys: [{ ...key.publicKey.export({ format: 'jwk' }), use: 'enc' }] },
        {
            keys: Array.from({ length: OIDC_LIMITS.jwksKeys + 1 }, () =>
                key.publicKey.export({ format: 'jwk' }),
            ),
        },
    ])('rejects unusable public keys', async ({ keys }) => {
        const base = fixture()
        const client = createOidcProtocolClient({
            fetch: () => async (url, init) =>
                url.endsWith('/jwks') ? Response.json({ keys }) : base.fetch(url, init),
        })
        await expect(client.verifyMetadata(configuration)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
    })
    test('rejects discovery advertising an untrusted private key endpoint before fetching it', async () => {
        const calls: string[] = []
        const client = createOidcProtocolClient({
            fetch: () => async (url) => {
                calls.push(url)
                return Response.json({
                    issuer: configuration.issuer,
                    authorization_endpoint: configuration.issuer + '/authorize',
                    token_endpoint: configuration.issuer + '/token',
                    jwks_uri: 'https://127.0.0.1/jwks',
                    id_token_signing_alg_values_supported: ['RS256'],
                })
            },
        })
        await expect(client.verifyMetadata(configuration)).rejects.toMatchObject({
            code: 'provider_unavailable',
        })
        expect(calls).toHaveLength(1)
    })
})
