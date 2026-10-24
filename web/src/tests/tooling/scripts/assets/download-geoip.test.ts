import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { downloadGeoip } from '../../../../../../scripts/assets/download-geoip.ts'

const database = new TextEncoder().encode('verified country database')
const repositoryApi = 'https://api.github.com/repos/sapics/ip-location-db'
const metadataUrl = repositoryApi + '/releases/tags/latest'
const databaseUrl = repositoryApi + '/releases/assets/123'
function metadata(bytes = database, id = 123) {
    return {
        id: 456,
        url: repositoryApi + '/releases/456',
        html_url: 'https://github.com/sapics/ip-location-db/releases/tag/latest',
        tag_name: 'latest',
        draft: false,
        assets: [
            {
                id,
                name: 'user-country.mmdb',
                url: repositoryApi + '/releases/assets/' + id,
                browser_download_url:
                    'https://github.com/sapics/ip-location-db/releases/download/latest/user-country.mmdb',
                state: 'uploaded',
                size: bytes.byteLength,
                digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
            },
        ],
    }
}
function validResponse(url: string): Response {
    return url === metadataUrl ? Response.json(metadata()) : new Response(database)
}

describe('GeoIP release asset download', () => {
    test.each([1, 64 * 1024 * 1024])(
        'accepts inclusive database size boundary %i',
        async (length) => {
            const body = new Uint8Array(length)
            body[0] = 42
            const snapshot = metadata(body)
            const bytes = await downloadGeoip(async (url) =>
                url === metadataUrl ? Response.json(snapshot) : new Response(body),
            )
            expect(bytes.byteLength).toBe(length)
            expect(new Uint8Array(bytes)[0]).toBe(42)
        },
    )

    test('binds bounded bytes to an asset ID, size and digest in stable official metadata', async () => {
        const requests: string[] = []
        const bytes = await downloadGeoip(async (url, options) => {
            requests.push(url)
            expect(new Headers(options.headers).get('Accept')).toBe(
                url === metadataUrl ? 'application/vnd.github+json' : 'application/octet-stream',
            )
            expect(new Headers(options.headers).get('Cache-Control')).toBe('no-cache')
            expect(new Headers(options.headers).get('Accept-Encoding')).toBe('identity')
            expect(options.signal).toBeInstanceOf(AbortSignal)
            expect(options).not.toHaveProperty('credentials')
            return validResponse(url)
        })
        expect(new Uint8Array(bytes)).toEqual(database)
        expect(requests).toEqual([metadataUrl, databaseUrl, metadataUrl])
    })

    test.each([
        { id: 0 },
        { id: -1 },
        { id: 1.5 },
        { id: Number.MAX_SAFE_INTEGER + 1 },
        { url: 'https://api.github.com/repos/foreign/repo/releases/assets/123' },
        { url: databaseUrl + '?token=evil' },
        { browser_download_url: 'https://evil.example/user-country.mmdb' },
        { state: 'new' },
        { name: 'evil-country.mmdb' },
        { size: 0 },
        { size: -1 },
        { size: 1.5 },
        { size: '24' },
        { size: 67108865 },
        { digest: null },
        { digest: undefined },
        { digest: '' },
        { digest: 'sha256:' + 'A'.repeat(64) },
        { digest: 'sha256:' + 'g'.repeat(64) },
        { digest: 'sha512:' + 'a'.repeat(64) },
        { digest: 'sha256:' + 'a'.repeat(63) },
    ])('rejects invalid asset metadata before fetching bytes: %j', async (overrides) => {
        let requests = 0
        const release = metadata()
        await expect(
            downloadGeoip(async () => {
                requests += 1
                return Response.json({
                    ...release,
                    assets: [{ ...release.assets[0], ...overrides }],
                })
            }),
        ).rejects.toThrow('GeoIP asset metadata is invalid')
        expect(requests).toBe(1)
    })

    test.each([
        null,
        [[]],
        {},
        { ...metadata(), id: 0 },
        { ...metadata(), url: 'https://api.github.com/repos/foreign/repo/releases/456' },
        { ...metadata(), html_url: 'https://github.com/foreign/repo/releases/tag/latest' },
        { ...metadata(), tag_name: 'other' },
        { ...metadata(), draft: true },
        { ...metadata(), assets: null },
        { ...metadata(), assets: [] },
        { ...metadata(), assets: [null] },
        { ...metadata(), assets: [...metadata().assets, ...metadata().assets] },
    ])('rejects malformed, foreign or duplicate release metadata: %j', async (release) => {
        let requests = 0
        await expect(
            downloadGeoip(async () => {
                requests += 1
                return Response.json(release)
            }),
        ).rejects.toThrow('metadata is invalid')
        expect(requests).toBe(1)
    })

    test.each(['not JSON', '{', '{} trailing', '\uFFFD'])(
        'rejects malformed JSON: %j',
        async (body) => {
            await expect(downloadGeoip(async () => new Response(body))).rejects.toThrow(
                'GeoIP metadata JSON is invalid',
            )
        },
    )
    test('rejects invalid UTF-8 metadata', async () => {
        await expect(
            downloadGeoip(async () => new Response(new Uint8Array([255]))),
        ).rejects.toThrow('GeoIP metadata JSON is invalid')
    })

    test.each([metadataUrl, databaseUrl])(
        'rejects missing response body for %s',
        async (missing) => {
            await expect(
                downloadGeoip(async (url) =>
                    url === missing ? new Response(null) : validResponse(url),
                ),
            ).rejects.toThrow('body is missing')
        },
    )
    test('rejects corrupted bytes without retrying immutable asset data', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return url === metadataUrl
                    ? validResponse(url)
                    : new Response(new Uint8Array(database.length))
            }),
        ).rejects.toThrow('GeoIP asset checksum mismatch')
        expect(requests).toBe(2)
    })
    test.each(['0', '-1', '1.5', 'abc', '67108865', '9007199254740993'])(
        'rejects invalid declared database sizes: %s',
        async (length) => {
            await expect(
                downloadGeoip(async (url) =>
                    url === metadataUrl
                        ? validResponse(url)
                        : new Response(database, { headers: { 'Content-Length': length } }),
                ),
            ).rejects.toThrow('GeoIP asset size is invalid')
        },
    )
    test('rejects truncated bytes, empty data, mismatched lengths and metadata size headers', async () => {
        await Promise.all(
            [database.slice(1), new Uint8Array(0)].map(async (body) => {
                await expect(
                    downloadGeoip(async (url) =>
                        url === metadataUrl ? validResponse(url) : new Response(body),
                    ),
                ).rejects.toThrow('GeoIP asset size mismatch')
            }),
        )
        await expect(
            downloadGeoip(async (url) =>
                url === metadataUrl
                    ? validResponse(url)
                    : new Response(database, {
                          headers: { 'Content-Length': String(database.length - 1) },
                      }),
            ),
        ).rejects.toThrow('GeoIP asset size mismatch')
        await expect(
            downloadGeoip(
                async () => new Response('{}', { headers: { 'Content-Length': '1048577' } }),
            ),
        ).rejects.toThrow('GeoIP metadata size is invalid')
        await expect(
            downloadGeoip(async () => new Response('{}', { headers: { 'Content-Length': '100' } })),
        ).rejects.toThrow('GeoIP metadata size mismatch')
    })
    test.each([metadataUrl, databaseUrl])(
        'cancels oversized streams from %s',
        async (oversized) => {
            let pulled = 0
            let cancelled = false
            const chunk = new Uint8Array(1024 * 1024)
            await expect(
                downloadGeoip(async (url) =>
                    url !== oversized
                        ? validResponse(url)
                        : new Response(
                              new ReadableStream<Uint8Array>({
                                  pull(controller) {
                                      pulled += 1
                                      controller.enqueue(chunk)
                                  },
                                  cancel() {
                                      cancelled = true
                                  },
                              }),
                          ),
                ),
            ).rejects.toThrow('exceeds size limit')
            expect(cancelled).toBeTrue()
            expect(pulled).toBeLessThanOrEqual(3)
        },
    )

    test('refreshes metadata and downloads the new concrete ID after replacement', async () => {
        const replacement = new TextEncoder().encode('new official country database')
        let requests = 0
        const urls: string[] = []
        const bytes = await downloadGeoip(async (url) => {
            urls.push(url)
            requests += 1
            return url === metadataUrl
                ? Response.json(requests === 1 ? metadata() : metadata(replacement, 789))
                : new Response(requests === 2 ? database : replacement)
        })
        expect(new Uint8Array(bytes)).toEqual(replacement)
        expect(urls).toEqual([
            metadataUrl,
            databaseUrl,
            metadataUrl,
            metadataUrl,
            repositoryApi + '/releases/assets/789',
            metadataUrl,
        ])
    })
    test('bounds retries when assets keep changing', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return url === metadataUrl
                    ? Response.json(metadata(database, requests))
                    : new Response(database)
            }),
        ).rejects.toThrow('GeoIP asset changed during download')
        expect(requests).toBe(6)
    })
    test('rejects malformed final metadata even after valid bytes', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return requests === 3 ? Response.json({}) : validResponse(url)
            }),
        ).rejects.toThrow('GeoIP release metadata is invalid')
        expect(requests).toBe(3)
    })
    test.each([0, 1, 2])('retries 404 once at request position %i', async (position) => {
        let requests = 0
        const bytes = await downloadGeoip(async (url) =>
            requests++ === position
                ? new Response('private error body', { status: 404 })
                : validResponse(url),
        )
        expect(new Uint8Array(bytes)).toEqual(database)
        expect(requests).toBe(position + 4)
    })
    test.each([metadataUrl, databaseUrl])(
        'bounds retries when %s stays unavailable',
        async (missing) => {
            let requests = 0
            await expect(
                downloadGeoip(async (url) => {
                    requests += 1
                    return url === missing
                        ? new Response('private error body', { status: 404 })
                        : validResponse(url)
                }),
            ).rejects.toThrow('download failed (HTTP 404)')
            expect(requests).toBe(missing === metadataUrl ? 2 : 4)
        },
    )
    test.each([403, 429, 500])(
        'does not retry other HTTP failures or expose response contents: %i',
        async (status) => {
            await Promise.all(
                [metadataUrl, databaseUrl].map(async (failed) => {
                    let requests = 0
                    await expect(
                        downloadGeoip(async (url) => {
                            requests += 1
                            return url === failed
                                ? new Response('private error body', { status })
                                : validResponse(url)
                        }),
                    ).rejects.toThrow('download failed (HTTP ' + status + ')')
                    expect(requests).toBe(failed === metadataUrl ? 1 : 2)
                }),
            )
        },
    )
})
