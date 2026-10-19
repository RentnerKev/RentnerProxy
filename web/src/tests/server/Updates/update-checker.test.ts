import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import { createUpdateChecker } from '@/server/Updates/releases.service.ts'
import { getUpgradeCompatibility, parseReleaseReadiness } from '@/server/Updates/readiness.ts'

const publication = '2026-10-18T12:00:00Z'
const revision = 'a'.repeat(40)
const sha256 = (body: string) => `sha256:${createHash('sha256').update(body).digest('hex')}`

function fixture(tag = 'v1.0.0-beta.2') {
    const config = JSON.stringify({
        os: 'linux',
        architecture: 'amd64',
        config: {
            Labels: {
                'org.opencontainers.image.source': 'https://github.com/RentnerKev/RentnerProxy',
                'org.opencontainers.image.version': tag,
                'org.opencontainers.image.revision': revision,
            },
        },
    })
    const manifest = JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: {
            mediaType: 'application/vnd.oci.image.config.v1+json',
            digest: sha256(config),
            size: Buffer.byteLength(config),
        },
        layers: [],
    })
    const metadata: ReleaseReadiness = {
        schemaVersion: 1,
        releaseId: 42,
        tag,
        channel: tag.includes('-beta') ? 'beta' : 'stable',
        publishedAt: publication,
        revision,
        image: {
            repository: 'ghcr.io/rentnerkev/rentnerproxy',
            digest: sha256(manifest),
            platforms: ['linux/amd64'],
        },
        upgrade: { policy: 'beta1-appliance-v1', minimumVersion: 'v1.0.0-beta.1' },
    }
    const release = {
        id: 42,
        tag_name: tag,
        draft: false,
        prerelease: metadata.channel !== 'stable',
        published_at: publication,
        body: '## Changes\nRelease notes <script>untrusted()</script>',
        assets: [{ id: 99, name: 'rentnerproxy-update.json', state: 'uploaded', size: 1024 }],
    }
    const calls: string[] = []
    let intercept: ((url: URL) => Response | undefined) | undefined
    const fetcher = (async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input)
        calls.push(url.href)
        const intercepted = intercept?.(url)
        if (intercepted) return intercepted
        if (url.hostname === 'api.github.com') {
            return Response.json(url.pathname.endsWith('/assets/99') ? metadata : [release])
        }
        if (url.hostname === 'ghcr.io' && url.pathname === '/token')
            return Response.json({ token: 'anonymous' })
        if (url.hostname === 'ghcr.io' && url.pathname.endsWith(`/manifests/${tag}`))
            return new Response(manifest)
        if (url.hostname === 'ghcr.io' && url.pathname.endsWith(`/blobs/${sha256(config)}`))
            return new Response(config)
        throw new Error('Unexpected fixture request')
    }) as typeof fetch
    return {
        metadata,
        release,
        calls,
        fetcher,
        intercept: (handler: typeof intercept) => {
            intercept = handler
        },
    }
}

const checkerFor = (data: ReturnType<typeof fixture>, now?: () => number) =>
    createUpdateChecker({
        fetcher: data.fetcher,
        platform: 'linux/amd64',
        ...(now ? { now } : {}),
    })

describe('read-only update checker', () => {
    test('verifies a published release and returns its immutable image and supported path', async () => {
        const data = fixture()
        const result = await checkerFor(data)('v1.0.0-beta.1')
        expect(result.status).toBe('available')
        expect(result.currentChannel).toBe('beta')
        expect(result.latest?.image).toEqual({
            status: 'verified',
            platform: 'linux/amd64',
            reference: `ghcr.io/rentnerkev/rentnerproxy:${data.metadata.tag}@${data.metadata.image.digest}`,
            digest: data.metadata.image.digest,
        })
        expect(result.latest?.compatibility.status).toBe('supported')
        expect(result.latest?.notes).toContain('<script>untrusted()</script>')
        expect(result.latest?.url).toBe(
            'https://github.com/RentnerKev/RentnerProxy/releases/tag/v1.0.0-beta.2',
        )
    })
    test('does not make requests for dev, PR, invalid or unknown builds', async () => {
        const data = fixture()
        const check = checkerFor(data)
        await Promise.all(
            [
                'dev-0123456789ab',
                'pr-42',
                '0.0.0-dev',
                '1.0.0-beta.2+pr.42',
                '1.0.0-rc.1',
                '1.0.0-beta.01',
            ].map(async (version) => {
                expect((await check(version)).status).toBe('disabled')
            }),
        )
        expect(data.calls).toEqual([])
    })
    test('only declares current after a successful and complete eligible-release lookup', async () => {
        const data = fixture()
        const result = await checkerFor(data)('v1.0.0')
        expect(result).toMatchObject({ status: 'current', latest: null, currentChannel: 'stable' })
        expect(data.calls).toHaveLength(1)
    })
    test('deduplicates concurrent checks and caches completed verification', async () => {
        const data = fixture()
        const check = checkerFor(data)
        const results = await Promise.all([
            check('1.0.0-beta.1'),
            check('1.0.0-beta.1'),
            check('1.0.0-beta.1'),
        ])
        expect(results.every((result) => result.latest?.image.status === 'verified')).toBe(true)
        await check('1.0.0-beta.1')
        expect(data.calls.filter((url) => url.includes('?per_page'))).toHaveLength(1)
        expect(data.calls.filter((url) => url.includes('/token'))).toHaveLength(1)
    })
    test('separates the release publication race from image verification', async () => {
        const data = fixture()
        data.release.assets = []
        const result = await checkerFor(data)('1.0.0-beta.1')
        expect(result.status).toBe('available')
        expect(result.latest?.image).toMatchObject({
            status: 'pending',
            reference: null,
            digest: null,
        })
        expect(result.latest?.compatibility.status).toBe('unsupported')
        expect(data.calls).toHaveLength(1)
    })
    test('rechecks incomplete publication after five minutes', async () => {
        const data = fixture()
        const assets = data.release.assets
        data.release.assets = []
        let now = Date.parse(publication)
        const check = checkerFor(data, () => now)
        expect((await check('1.0.0-beta.1')).latest?.image.status).toBe('pending')
        data.release.assets = assets
        now += 5 * 60 * 1000
        expect((await check('1.0.0-beta.1')).latest?.image.status).toBe('verified')
    })
    test('never reuses verified data after a failed refresh', async () => {
        const data = fixture()
        let now = Date.parse(publication)
        const check = checkerFor(data, () => now)
        expect((await check('1.0.0-beta.1')).latest?.image.status).toBe('verified')
        now += 60 * 60 * 1000
        data.intercept(() => new Response('', { status: 403 }))
        expect(await check('1.0.0-beta.1')).toMatchObject({ status: 'unavailable', latest: null })
    })
    test('preserves release notes but removes image verification on registry failure', async () => {
        await Promise.all(
            (
                [
                    [404, 'pending'],
                    [429, 'unavailable'],
                ] as const
            ).map(async ([status, expected]) => {
                const data = fixture()
                data.intercept((url) =>
                    url.pathname.includes('/manifests/') ? new Response('', { status }) : undefined,
                )
                const result = await checkerFor(data)('1.0.0-beta.1')
                expect(result.latest?.image).toMatchObject({
                    status: expected,
                    reference: null,
                    digest: null,
                })
                expect(result.latest?.notes).toBe(data.release.body)
            }),
        )
    })
    test('rejects readiness for a different release, publication or target', async () => {
        await Promise.all(
            [
                { releaseId: 43 },
                { tag: 'v1.0.0-beta.3' },
                { publishedAt: '2026-10-19T12:00:00Z' },
                { schemaVersion: 2 },
                { revision: 'bad' },
            ].map(async (mutation) => {
                const data = fixture()
                Object.assign(data.metadata, mutation)
                const result = await checkerFor(data)('1.0.0-beta.1')
                expect(result.latest?.image.status).toBe('invalid')
                expect(data.calls.some((url) => new URL(url).hostname === 'ghcr.io')).toBe(false)
            }),
        )
    })
    test('restricts release-asset redirects to GitHub delivery hosts', async () => {
        const data = fixture()
        data.intercept((url) =>
            url.pathname.endsWith('/assets/99')
                ? new Response(null, {
                      status: 302,
                      headers: { location: 'https://attacker.example/metadata.json' },
                  })
                : undefined,
        )
        const result = await checkerFor(data)('1.0.0-beta.1')
        expect(result.latest?.image.status).toBe('invalid')
        expect(data.calls.some((url) => new URL(url).hostname === 'attacker.example')).toBe(false)
    })
    test('follows a bounded official release-asset redirect', async () => {
        const data = fixture()
        data.intercept((url) => {
            if (url.pathname.endsWith('/assets/99'))
                return new Response(null, {
                    status: 302,
                    headers: {
                        location: 'https://release-assets.githubusercontent.com/metadata.json',
                    },
                })
            if (url.hostname === 'release-assets.githubusercontent.com')
                return Response.json(data.metadata)
            return undefined
        })
        expect((await checkerFor(data)('1.0.0-beta.1')).latest?.image.status).toBe('verified')
    })
    test('checks later publication pages before choosing the newest SemVer', async () => {
        const data = fixture()
        const old = { ...data.release, tag_name: 'v1.0.0-alpha.1', assets: [] }
        data.intercept((url) =>
            url.searchParams.has('page')
                ? Response.json(
                      url.searchParams.get('page') === '1'
                          ? Array.from({ length: 100 }, (_, index) => ({ ...old, id: index + 1 }))
                          : [{ ...data.release, tag_name: 'v1.0.0-beta.10', assets: [] }],
                  )
                : undefined,
        )
        const result = await checkerFor(data)('1.0.0-beta.1')
        expect(result.latest?.version).toBe('1.0.0-beta.10')
        expect(data.calls.filter((url) => url.includes('?per_page'))).toHaveLength(2)
    })
    test('reports unknown on truncated pagination, rate limits or malformed responses', async () => {
        await Promise.all(
            [
                () =>
                    Response.json(
                        Array.from({ length: 100 }, () => ({ ...fixture().release, assets: [] })),
                    ),
                () => new Response('', { status: 429 }),
                () => Response.json({ message: 'Unavailable' }),
                () => new Response('{bad json'),
            ].map(async (response) => {
                const data = fixture()
                data.intercept(response)
                expect(await checkerFor(data)('1.0.0-beta.1')).toMatchObject({
                    status: 'unavailable',
                    latest: null,
                })
                expect(data.calls.length).toBeLessThanOrEqual(5)
            }),
        )
    })
    test('ignores drafts, null publication and misleading prerelease flags', async () => {
        const data = fixture()
        data.intercept(() =>
            Response.json([
                { ...data.release, draft: true },
                { ...data.release, published_at: null },
                { ...data.release, prerelease: false },
            ]),
        )
        expect((await checkerFor(data)('1.0.0-beta.1')).status).toBe('current')
    })
    test('does not pretend an unsupported platform can use a verified image', async () => {
        const data = fixture()
        const check = createUpdateChecker({ fetcher: data.fetcher, platform: 'linux/arm64' })
        expect((await check('1.0.0-beta.1')).latest?.image).toMatchObject({
            status: 'unsupported-platform',
            reference: null,
        })
    })
    test('shows required Beta 1 intermediate step even before target image publication', async () => {
        const data = fixture()
        data.release.assets = []
        const result = await checkerFor(data)('1.0.0-alpha.10')
        expect(result.latest?.compatibility).toEqual({
            status: 'requires-beta1',
            minimumVersion: 'v1.0.0-beta.1',
            intermediateVersion: 'v1.0.0-beta.1',
        })
    })
})

describe('declared upgrade compatibility', () => {
    test('never recommends a Beta 1 downgrade or applies its policy to another target family', () => {
        for (const [source, target] of [
            ['1.0.0-alpha.1', '1.1.0-alpha.1'],
            ['1.0.0-alpha.1', '2.0.0'],
            ['1.1.0-alpha.1', '1.2.0-beta.1'],
        ]) {
            expect(getUpgradeCompatibility(source!, target!, null).status).toBe('unsupported')
        }
        const data = fixture()
        expect(
            getUpgradeCompatibility('1.0.0-alpha.1', data.release.tag_name, {
                ...data.metadata,
                upgrade: { policy: 'manual-review', minimumVersion: null },
            }).status,
        ).toBe('unsupported')
    })
    test('restricts direct upgrades to declared supported major-one sources', () => {
        const data = fixture()
        for (const source of ['1.0.0-beta.1', '1.0.0-beta.1+build.2']) {
            expect(
                getUpgradeCompatibility(source, data.release.tag_name, data.metadata).status,
            ).toBe('supported')
        }
        for (const source of ['1.0.0-beta.0', '1.0.0-beta.2', '1.0.0', '2.0.0-beta.1', 'dev-sha']) {
            expect(
                getUpgradeCompatibility(source, data.release.tag_name, data.metadata).status,
            ).toBe('unsupported')
        }
        expect(getUpgradeCompatibility('1.0.0-beta.1', data.release.tag_name, null).status).toBe(
            'unsupported',
        )
    })
    test('does not accept a compatibility claim for another target family', () => {
        const data = fixture('v2.0.0')
        const identity = {
            id: 42,
            tag: data.release.tag_name,
            channel: data.metadata.channel,
            publishedAt: publication,
            notes: null,
            readinessAssetId: 99,
            version: '2.0.0',
        }
        expect(parseReleaseReadiness(data.metadata, identity)).toBeNull()
        expect(
            parseReleaseReadiness(
                { ...data.metadata, upgrade: { policy: 'manual-review', minimumVersion: null } },
                identity,
            ),
        ).not.toBeNull()
    })
})
