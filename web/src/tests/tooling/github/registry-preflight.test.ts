import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { preflightVersionTags } from '../../../../../.github/scripts/security/registry-preflight.ts'
import type {
    RegistryFetch,
    RegistryPreflightInput,
} from '../../../../../.github/scripts/security/Types/registry-preflight.types.ts'

const manifest = '{"schemaVersion":2,"manifests":[]}'
const input: RegistryPreflightInput = {
    image: 'ghcr.io/example/runtime',
    tags: ['v1.2.3'],
    expectedDigest: 'sha256:' + createHash('sha256').update(manifest).digest('hex'),
    username: 'synthetic-user',
    password: 'synthetic-password',
}
const missing = (codes: readonly string[] = ['MANIFEST_UNKNOWN']) =>
    Response.json({ errors: codes.map((code) => ({ code })) }, { status: 404 })

function registry(responses: Array<Response | Error>) {
    const calls: Array<{ url: URL; init: RequestInit }> = []
    const fetcher: RegistryFetch = async (url, init) => {
        calls.push({ url: new URL(url), init })
        if (calls.length === 1) return Response.json({ token: 'synthetic-bearer' })
        const response = responses.shift()
        if (response instanceof Error) throw response
        if (!response) throw new Error('Unexpected request')
        return response
    }
    return { fetcher, calls }
}

describe('immutable GHCR preflight', () => {
    test('hashes exact top-level index bytes and restricts credentials to fixed GHCR requests', async () => {
        const { fetcher, calls } = registry([new Response(manifest)])
        expect(await preflightVersionTags(input, fetcher)).toEqual({ identicalTags: ['v1.2.3'] })
        expect(calls).toHaveLength(2)
        expect(calls[0]!.url.origin).toBe('https://ghcr.io')
        expect(calls[0]!.url.pathname).toBe('/token')
        expect(calls[0]!.url.searchParams.get('service')).toBe('ghcr.io')
        expect(calls[0]!.url.searchParams.get('scope')).toBe('repository:example/runtime:pull')
        expect(calls[1]!.url.href).toBe('https://ghcr.io/v2/example/runtime/manifests/v1.2.3')
        const tokenHeaders = new Headers(calls[0]!.init.headers)
        expect(tokenHeaders.get('authorization')).toBe(
            'Basic ' + Buffer.from('synthetic-user:synthetic-password').toString('base64'),
        )
        const manifestHeaders = new Headers(calls[1]!.init.headers)
        expect(manifestHeaders.get('authorization')).toBe('Bearer synthetic-bearer')
        expect(manifestHeaders.get('accept')).toContain('application/vnd.oci.image.index.v1+json')
        expect(manifestHeaders.get('accept')).toContain(
            'application/vnd.docker.distribution.manifest.list.v2+json',
        )
        for (const call of calls) {
            expect(call.init.method).toBe('GET')
            expect(call.init.redirect).toBe('error')
            expect(call.url.href).not.toContain(input.password)
        }
    })

    test.each([
        { codes: ['MANIFEST_UNKNOWN'] },
        { codes: ['NAME_UNKNOWN'] },
        { codes: ['MANIFEST_UNKNOWN', 'NAME_UNKNOWN'] },
    ])('accepts only confirmed missing codes %j', async ({ codes }) => {
        const { fetcher } = registry([missing(codes)])
        expect(await preflightVersionTags(input, fetcher)).toEqual({ identicalTags: [] })
    })

    test('checks every tag before returning identical tags', async () => {
        const { fetcher, calls } = registry([
            new Response(manifest),
            missing(),
            new Response('different'),
        ])
        await expect(
            preflightVersionTags({ ...input, tags: ['v1.2.3', 'v1.2.4', 'v1.2.5'] }, fetcher),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toHaveLength(4)
    })

    test.each([401, 403, 429, 500, 503, 302])('rejects manifest HTTP %i', async (status) => {
        const { fetcher } = registry([
            new Response('synthetic-password synthetic-bearer', { status }),
        ])
        await expect(preflightVersionTags(input, fetcher)).rejects.toThrow(
            'Immutable image preflight failed; no publication is permitted',
        )
    })

    test.each([
        'not found',
        '{}',
        '{"errors":[]}',
        '{"errors":[{}]}',
        '{"errors":[{"code":"UNAUTHORIZED"}]}',
        '{"errors":[{"code":"MANIFEST_UNKNOWN"},{"code":"DENIED"}]}',
    ])('rejects unconfirmed or mixed 404: %s', async (body) => {
        const { fetcher } = registry([new Response(body, { status: 404 })])
        await expect(preflightVersionTags(input, fetcher)).rejects.toThrow(
            'Immutable image preflight failed',
        )
    })

    test.each([
        new Response('denied', { status: 401 }),
        new Response('not JSON'),
        Response.json({ token: '' }),
        Response.json({ token: 'unsafe\r\ntoken' }),
    ])('rejects token failure before reading any manifest', async (response) => {
        let calls = 0
        await expect(
            preflightVersionTags(input, async () => {
                calls++
                return response
            }),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toBe(1)
    })

    test.each([
        { image: 'https://evil.example/runtime' },
        { image: 'ghcr.io/example/../runtime' },
        { image: 'ghcr.io/Example/runtime' },
        { image: 'ghcr.io/example/runtime?secret=x' },
        { tags: ['latest'] },
        { tags: ['v1.2.3/other'] },
        { expectedDigest: 'invalid' },
        { username: '' },
        { password: '' },
    ])('rejects invalid identity before authentication: %j', async (invalid) => {
        let calls = 0
        await expect(
            preflightVersionTags({ ...input, ...invalid }, async () => {
                calls++
                return new Response()
            }),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toBe(0)
    })

    test('rejects oversized declared and streamed manifests', async () => {
        await Promise.all(
            [
                new Response('x', { headers: { 'content-length': '1000' } }),
                new Response('x'.repeat(1000)),
            ].map(async (response) => {
                const { fetcher } = registry([response])
                await expect(
                    preflightVersionTags(input, fetcher, { timeoutMs: 100, manifestBytes: 64 }),
                ).rejects.toThrow('Immutable image preflight failed')
            }),
        )
    })

    test('rejects an oversized token before fetching manifests', async () => {
        let calls = 0
        await expect(
            preflightVersionTags(input, async () => {
                calls++
                return Response.json({ token: 'x'.repeat(65_536) })
            }),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toBe(1)
    })

    test('rejects invalid UTF-8 in token JSON even outside the token field', async () => {
        const bytes = Buffer.concat([
            Buffer.from('{"token":"synthetic-bearer","detail":"'),
            Buffer.from([0xff]),
            Buffer.from('"}'),
        ])
        let calls = 0
        await expect(
            preflightVersionTags(input, async () => {
                calls++
                return new Response(bytes)
            }),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toBe(1)
    })

    test('rejects invalid UTF-8 in a missing-manifest error detail', async () => {
        const bytes = Buffer.concat([
            Buffer.from('{"errors":[{"code":"MANIFEST_UNKNOWN","detail":"'),
            Buffer.from([0xff]),
            Buffer.from('"}]}'),
        ])
        const { fetcher } = registry([new Response(bytes, { status: 404 })])
        await expect(preflightVersionTags(input, fetcher)).rejects.toThrow(
            'Immutable image preflight failed',
        )
    })

    test('rejects a later conflict even when the first version is missing', async () => {
        const { fetcher, calls } = registry([missing(), new Response('different')])
        await expect(
            preflightVersionTags({ ...input, tags: ['v1.2.3', 'v1.2.4'] }, fetcher),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(calls).toHaveLength(3)
    })

    test('bounds hanging requests and response streams without exposing transport errors', async () => {
        const { fetcher } = registry([new Error('synthetic-password synthetic-bearer')])
        await expect(preflightVersionTags(input, fetcher)).rejects.toThrow(
            'Immutable image preflight failed; no publication is permitted',
        )
        await expect(
            preflightVersionTags(input, () => new Promise(() => undefined), {
                timeoutMs: 5,
                manifestBytes: 64,
            }),
        ).rejects.toThrow('Immutable image preflight failed')
        let cancelled = false
        const hanging = new Response(
            new ReadableStream({
                cancel() {
                    cancelled = true
                },
            }),
        )
        const stream = registry([hanging])
        await expect(
            preflightVersionTags(input, stream.fetcher, { timeoutMs: 5, manifestBytes: 64 }),
        ).rejects.toThrow('Immutable image preflight failed')
        expect(cancelled).toBe(true)
        expect(hanging.body?.locked).toBe(false)
    })
})
