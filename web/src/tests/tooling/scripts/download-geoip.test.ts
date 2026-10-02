import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { downloadGeoip } from '../../../../../scripts/download-geoip.ts'

const database = new TextEncoder().encode('verified country database')
const asset = {
    id: 100,
    name: 'user-country.mmdb',
    state: 'uploaded',
    size: database.byteLength,
    digest: 'sha256:' + createHash('sha256').update(database).digest('hex'),
    browser_download_url: 'https://untrusted.invalid/latest',
}

describe('GeoIP release download', () => {
    test('downloads the exact asset whose digest was read, without using a mutable download URL', async () => {
        const requests: { url: string; accept: string | null }[] = []
        const bytes = await downloadGeoip(async (url, options) => {
            requests.push({ url, accept: new Headers(options.headers).get('Accept') })
            return url.endsWith('/latest')
                ? Response.json({ assets: [asset] })
                : new Response(database)
        })
        expect(new Uint8Array(bytes)).toEqual(database)
        expect(requests).toEqual([
            {
                url: 'https://api.github.com/repos/sapics/ip-location-db/releases/tags/latest',
                accept: 'application/vnd.github+json',
            },
            {
                url: 'https://api.github.com/repos/sapics/ip-location-db/releases/assets/100',
                accept: 'application/octet-stream',
            },
        ])
    })

    test.each([
        {},
        { assets: [] },
        { assets: [{ ...asset, digest: null }] },
        { assets: [{ ...asset, digest: 'sha256:invalid' }] },
        { assets: [{ ...asset, id: '../private' }] },
        { assets: [{ ...asset, state: 'open' }] },
        { assets: [{ ...asset, size: 64 * 1024 * 1024 + 1 }] },
    ])('rejects invalid metadata before downloading bytes: %j', async (metadata) => {
        let requests = 0
        await expect(
            downloadGeoip(async () => {
                requests += 1
                return Response.json(metadata)
            }),
        ).rejects.toThrow('GeoIP release asset metadata is invalid')
        expect(requests).toBe(1)
    })

    test('rejects corrupted bytes even when the asset size matches', async () => {
        const corrupted = database.slice()
        corrupted[0] ^= 1
        await expect(
            downloadGeoip(async (url) =>
                url.endsWith('/latest')
                    ? Response.json({ assets: [asset] })
                    : new Response(corrupted),
            ),
        ).rejects.toThrow('GeoIP asset checksum mismatch')
    })

    test('rejects a truncated download', async () => {
        await expect(
            downloadGeoip(async (url) =>
                url.endsWith('/latest')
                    ? Response.json({ assets: [asset] })
                    : new Response(database.slice(1)),
            ),
        ).rejects.toThrow('GeoIP asset size mismatch')
    })

    test('refreshes metadata once if upstream removes an asset during an update', async () => {
        const requests: string[] = []
        let metadataRequests = 0
        const bytes = await downloadGeoip(async (url) => {
            requests.push(url)
            if (url.endsWith('/latest')) {
                metadataRequests += 1
                return Response.json({ assets: [{ ...asset, id: metadataRequests * 100 }] })
            }
            return url.endsWith('/100')
                ? new Response(null, { status: 404 })
                : new Response(database)
        })
        expect(new Uint8Array(bytes)).toEqual(database)
        expect(requests.map((url) => url.split('/').at(-1))).toEqual([
            'latest',
            '100',
            'latest',
            '200',
        ])
    })

    test('bounds retries when the asset stays unavailable', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return url.endsWith('/latest')
                    ? Response.json({ assets: [asset] })
                    : new Response(null, { status: 404 })
            }),
        ).rejects.toThrow('GeoIP asset download failed (HTTP 404)')
        expect(requests).toBe(4)
    })

    test('reports HTTP metadata failures without consuming error response contents', async () => {
        await expect(
            downloadGeoip(async () => new Response('private error body', { status: 429 })),
        ).rejects.toThrow('GeoIP metadata download failed (HTTP 429)')
    })
})
