import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import { verifyReleaseImage } from '@/server/Updates/image.service.ts'
import { readBoundedText } from '@/server/Updates/http.ts'

const manifestType = 'application/vnd.oci.image.manifest.v1+json'
const indexType = 'application/vnd.oci.image.index.v1+json'
const repository = 'ghcr.io/rentnerkev/rentnerproxy'
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const encode = (value: unknown) => JSON.stringify(value)

function fixture(
    options: { index?: boolean; architecture?: string; labels?: Record<string, string> } = {},
) {
    const config = encode({
        os: 'linux',
        architecture: options.architecture ?? 'amd64',
        config: {
            Labels: options.labels ?? {
                'org.opencontainers.image.source': 'https://github.com/RentnerKev/RentnerProxy',
                'org.opencontainers.image.version': 'v1.0.0-beta.2',
                'org.opencontainers.image.revision': 'a'.repeat(40),
            },
        },
    })
    const manifest = encode({
        schemaVersion: 2,
        mediaType: manifestType,
        config: {
            mediaType: 'application/vnd.oci.image.config.v1+json',
            digest: digest(config),
            size: Buffer.byteLength(config),
        },
    })
    const index = encode({
        schemaVersion: 2,
        mediaType: indexType,
        manifests: [
            {
                mediaType: manifestType,
                digest: digest(manifest),
                size: Buffer.byteLength(manifest),
                platform: { os: 'linux', architecture: 'amd64' },
            },
            {
                mediaType: manifestType,
                digest: `sha256:${'b'.repeat(64)}`,
                size: 123,
                platform: { os: 'unknown', architecture: 'unknown' },
                annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
            },
        ],
    })
    const root = options.index ? index : manifest
    const readiness: ReleaseReadiness = {
        schemaVersion: 1,
        releaseId: 42,
        tag: 'v1.0.0-beta.2',
        channel: 'beta',
        publishedAt: '2026-10-18T12:00:00Z',
        revision: 'a'.repeat(40),
        image: { repository, digest: digest(root), platforms: ['linux/amd64'] },
        upgrade: { policy: 'beta1-appliance-v1', minimumVersion: 'v1.0.0-beta.1' },
    }
    const bodies = new Map<string, string>([
        [`https://ghcr.io/v2/rentnerkev/rentnerproxy/manifests/${readiness.tag}`, root],
        [`https://ghcr.io/v2/rentnerkev/rentnerproxy/manifests/${digest(manifest)}`, manifest],
        [`https://ghcr.io/v2/rentnerkev/rentnerproxy/blobs/${digest(config)}`, config],
    ])
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        requests.push({ url, init })
        if (url.startsWith('https://ghcr.io/token?'))
            return Response.json({ token: 'anonymous_token' })
        const body = bodies.get(url)
        return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
    }) as typeof fetch
    return { readiness, bodies, fetcher, requests, config, manifest, root }
}

describe('bounded GHCR release image verification', () => {
    test.each([false, true])(
        'verifies root digest, platform and config labels (index=%s)',
        async (index) => {
            const data = fixture({ index })
            const result = await verifyReleaseImage(
                data.readiness,
                'linux/amd64',
                data.fetcher,
                new AbortController().signal,
            )
            expect(result).toEqual({
                status: 'verified',
                reference: `${repository}:${data.readiness.tag}@${data.readiness.image.digest}`,
                digest: data.readiness.image.digest,
                platform: 'linux/amd64',
            })
            expect(
                data.requests.every(
                    (item) => item.init?.method === 'GET' && item.init.redirect === 'manual',
                ),
            ).toBe(true)
            expect(data.requests.some((item) => item.url.includes('b'.repeat(64)))).toBe(false)
        },
    )

    test('reports tag publication races without exposing a reference', async () => {
        const data = fixture()
        data.bodies.clear()
        expect(
            await verifyReleaseImage(
                data.readiness,
                'linux/amd64',
                data.fetcher,
                new AbortController().signal,
            ),
        ).toEqual({ status: 'pending', reference: null, digest: null, platform: 'linux/amd64' })
    })

    test('rejects stale retags and inconsistent digest headers', async () => {
        const data = fixture()
        const rootUrl = `https://ghcr.io/v2/rentnerkev/rentnerproxy/manifests/${data.readiness.tag}`
        data.bodies.set(rootUrl, data.root + ' ')
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
        const headerFetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            const response = await data.fetcher(input, init)
            if (String(input) === rootUrl)
                response.headers.set('docker-content-digest', `sha256:${'c'.repeat(64)}`)
            return response
        }) as typeof fetch
        data.bodies.set(rootUrl, data.root)
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    headerFetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
    })

    test.each(['manifests', 'blobs'])('checks %s raw digests', async (kind) => {
        const data = fixture({ index: true })
        const target = [...data.bodies.keys()].find((url) => url.includes(`/${kind}/sha256:`))!
        data.bodies.set(target, data.bodies.get(target)! + ' ')
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
    })

    test('rejects invalid JSON even when the digest matches', async () => {
        const data = fixture()
        const body = '{bad json'
        data.bodies.set(
            `https://ghcr.io/v2/rentnerkev/rentnerproxy/manifests/${data.readiness.tag}`,
            body,
        )
        const readiness = {
            ...data.readiness,
            image: { ...data.readiness.image, digest: digest(body) },
        }
        expect(
            (
                await verifyReleaseImage(
                    readiness,
                    'linux/amd64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
    })

    test.each(['source', 'version', 'revision'])('requires exact %s label', async (label) => {
        const labels = JSON.parse(fixture().config).config.Labels as Record<string, string>
        labels[`org.opencontainers.image.${label}`] = 'wrong'
        const data = fixture({ labels })
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
    })

    test('refuses undeclared platforms before networking and checks actual config platform', async () => {
        const data = fixture({ architecture: 'arm64' })
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/arm64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unsupported-platform')
        expect(data.requests).toHaveLength(0)
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    data.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unsupported-platform')
        const indexed = fixture({ index: true, architecture: 'arm64' })
        expect(
            (
                await verifyReleaseImage(
                    indexed.readiness,
                    'linux/amd64',
                    indexed.fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('invalid')
    })

    test.each([
        'pkg-containers.githubusercontent.com',
        'evil.example',
        'pkg-containers.githubusercontent.com.evil.example',
    ])('restricts blob redirects and authorization for %s', async (host) => {
        const data = fixture()
        const calls: { url: string; auth: string | null }[] = []
        const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
            if (url.includes('/blobs/'))
                return new Response(null, {
                    status: 307,
                    headers: { Location: `https://${host}/blob?signed=value` },
                })
            if (url.startsWith(`https://${host}/`)) return new Response(data.config)
            return data.fetcher(input, init)
        }) as typeof fetch
        const result = await verifyReleaseImage(
            data.readiness,
            'linux/amd64',
            fetcher,
            new AbortController().signal,
        )
        expect(result.status).toBe(
            host === 'pkg-containers.githubusercontent.com' ? 'verified' : 'unavailable',
        )
        const redirected = calls.find((call) => call.url.startsWith(`https://${host}/`))
        if (host === 'pkg-containers.githubusercontent.com') expect(redirected?.auth).toBeNull()
        else expect(redirected).toBeUndefined()
    })

    test.each([302, 429, 503])('rejects token redirects and HTTP %s', async (status) => {
        const data = fixture()
        const fetcher = (async () =>
            new Response(null, {
                status,
                headers: { location: 'https://evil.example/' },
            })) as unknown as typeof fetch
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unavailable')
    })

    test('bounds streamed bodies and cancels readers', async () => {
        let cancelled = false
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(20))
            },
            cancel() {
                cancelled = true
            },
        })
        await expect(readBoundedText(new Response(stream), 10)).rejects.toThrow(
            'Response body exceeds limit',
        )
        expect(cancelled).toBe(true)
        await expect(
            readBoundedText(new Response('abc', { headers: { 'content-length': '99999999' } }), 10),
        ).rejects.toThrow('Response body exceeds limit')
    })

    test('aborts an incomplete streamed body', async () => {
        const controller = new AbortController()
        const response = new Response(new ReadableStream())
        const reading = readBoundedText(response, 100, controller.signal)
        controller.abort()
        await expect(reading).rejects.toThrow()
    })

    test('classifies body transport failures as unavailable', async () => {
        const data = fixture()
        const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).includes('/manifests/'))
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.error(new Error('connection reset'))
                        },
                    }),
                )
            return data.fetcher(input, init)
        }) as typeof fetch
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unavailable')
    })

    test('does not request anything after the parent deadline', async () => {
        const data = fixture()
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    data.fetcher,
                    AbortSignal.abort(),
                )
            ).status,
        ).toBe('unavailable')
        expect(data.requests).toHaveLength(0)
    })

    test.each([
        { label: 'empty', token: '' },
        { label: 'oversized', token: 'x'.repeat(16385) },
        { label: 'injected', token: 'token\r\ninjected' },
    ])('rejects malformed anonymous token $label', async ({ token }) => {
        const data = fixture()
        const fetcher = (async () => Response.json({ token })) as unknown as typeof fetch
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unavailable')
    })

    test.each([
        'http://pkg-containers.githubusercontent.com/blob',
        'https://user:pass@pkg-containers.githubusercontent.com/blob',
        'https://pkg-containers.githubusercontent.com:8443/blob',
    ])('rejects unsafe CDN location %s', async (location) => {
        const data = fixture()
        let redirects = 0
        const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).includes('/blobs/')) {
                redirects++
                return new Response(null, { status: 307, headers: { location } })
            }
            return data.fetcher(input, init)
        }) as typeof fetch
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unavailable')
        expect(redirects).toBe(1)
    })

    test('limits CDN redirect loops to three hops', async () => {
        const data = fixture()
        let redirects = 0
        const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).includes('/blobs/') || String(input).includes('pkg-containers.')) {
                redirects++
                return new Response(null, {
                    status: 307,
                    headers: {
                        location: `https://pkg-containers.githubusercontent.com/blob/${redirects}`,
                    },
                })
            }
            return data.fetcher(input, init)
        }) as typeof fetch
        expect(
            (
                await verifyReleaseImage(
                    data.readiness,
                    'linux/amd64',
                    fetcher,
                    new AbortController().signal,
                )
            ).status,
        ).toBe('unavailable')
        expect(redirects).toBe(4)
    })
})
