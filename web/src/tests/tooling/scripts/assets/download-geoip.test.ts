import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { downloadGeoip } from '../../../../../../scripts/assets/download-geoip.ts'

const database = new TextEncoder().encode('verified country database')
const checksumUrl =
    'https://github.com/sapics/ip-location-db/releases/download/checksum/user-country.mmdb.sha256'
const databaseUrl =
    'https://github.com/sapics/ip-location-db/releases/download/latest/user-country.mmdb'
function checksum(bytes = database): string {
    return createHash('sha256').update(bytes).digest('hex') + '  user-country.mmdb\n'
}
function validResponse(url: string): Response {
    return new Response(url === checksumUrl ? checksum() : database)
}

describe('GeoIP checksum download', () => {
    test.each([1, 64 * 1024 * 1024])(
        'accepts the inclusive database size boundary %i',
        async (length) => {
            const body = new Uint8Array(length)
            body[0] = 42
            const snapshot = checksum(body)
            const bytes = await downloadGeoip(
                async (url) => new Response(url === checksumUrl ? snapshot : body),
            )
            expect(bytes.byteLength).toBe(length)
            expect(new Uint8Array(bytes)[0]).toBe(42)
        },
    )

    test('does not accept an invalid final checksum even when the first snapshot matches the database', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return requests === 3 ? new Response('missing') : validResponse(url)
            }),
        ).rejects.toThrow('GeoIP checksum size mismatch')
        expect(requests).toBe(3)
    })

    test('binds bounded database bytes to two identical official checksum snapshots without API calls', async () => {
        const requests: string[] = []
        const bytes = await downloadGeoip(async (url, options) => {
            requests.push(url)
            expect(new Headers(options.headers).get('Accept')).toBe('application/octet-stream')
            expect(new Headers(options.headers).get('Cache-Control')).toBe('no-cache')
            expect(options.signal).toBeInstanceOf(AbortSignal)
            const body = url === checksumUrl ? checksum() : database
            return new Response(body, { headers: { 'Content-Length': String(body.length) } })
        })
        expect(new Uint8Array(bytes)).toEqual(database)
        expect(requests).toEqual([checksumUrl, databaseUrl, checksumUrl])
    })

    test.each([
        '',
        'a'.repeat(64) + ' user-country.mmdb\n',
        'A'.repeat(64) + '  user-country.mmdb\n',
        'a'.repeat(64) + '  evil-country.mmdb\n',
        checksum().replace('\n', '\r\n'),
        checksum().trimEnd(),
        checksum() + 'private extra line',
        'g'.repeat(64) + '  user-country.mmdb\n',
    ])('rejects malformed or missing checksum before fetching the database: %j', async (body) => {
        let requests = 0
        await expect(
            downloadGeoip(async () => {
                requests += 1
                return new Response(body)
            }),
        ).rejects.toThrow('GeoIP checksum')
        expect(requests).toBe(1)
    })

    test('rejects absent checksum or database response bodies', async () => {
        await expect(downloadGeoip(async () => new Response(null))).rejects.toThrow(
            'GeoIP checksum body is missing',
        )
        await expect(
            downloadGeoip(async (url) =>
                url === checksumUrl ? validResponse(url) : new Response(null),
            ),
        ).rejects.toThrow('GeoIP asset body is missing')
    })

    test('rejects corrupted or truncated bytes after exactly two attempts', async () => {
        await Promise.all(
            [database.slice(1), new Uint8Array(database.length)].map(async (body) => {
                let requests = 0
                await expect(
                    downloadGeoip(async (url) => {
                        requests += 1
                        return url === checksumUrl ? validResponse(url) : new Response(body)
                    }),
                ).rejects.toThrow('GeoIP asset checksum mismatch')
                expect(requests).toBe(6)
            }),
        )
    })

    test.each(['0', '-1', '1.5', 'abc', '67108865', '9007199254740993'])(
        'rejects invalid declared database sizes: %s',
        async (length) => {
            await expect(
                downloadGeoip(async (url) =>
                    url === checksumUrl
                        ? validResponse(url)
                        : new Response(database, { headers: { 'Content-Length': length } }),
                ),
            ).rejects.toThrow('GeoIP asset size is invalid')
        },
    )

    test('rejects declared lengths that disagree with actual bytes and empty data', async () => {
        await expect(
            downloadGeoip(async (url) =>
                url === checksumUrl
                    ? validResponse(url)
                    : new Response(database, {
                          headers: { 'Content-Length': String(database.length + 1) },
                      }),
            ),
        ).rejects.toThrow('GeoIP asset size mismatch')
        await expect(
            downloadGeoip(async (url) =>
                url === checksumUrl ? validResponse(url) : new Response(''),
            ),
        ).rejects.toThrow('GeoIP asset size mismatch')
        await expect(
            downloadGeoip(
                async () => new Response(checksum(), { headers: { 'Content-Length': '85' } }),
            ),
        ).rejects.toThrow('GeoIP checksum size is invalid')
    })

    test('cancels an oversized database stream before reading its unbounded remainder', async () => {
        let pulled = 0
        let cancelled = false
        const chunk = new Uint8Array(1024 * 1024)
        await expect(
            downloadGeoip(async (url) =>
                url === checksumUrl
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
        ).rejects.toThrow('GeoIP asset exceeds size limit')
        expect(cancelled).toBeTrue()
        expect(pulled).toBeLessThanOrEqual(66)
    })

    test('refreshes the full snapshot after a mid-download checksum replacement', async () => {
        const replacement = new TextEncoder().encode('new official country database')
        let requests = 0
        const bytes = await downloadGeoip(async (url) => {
            requests += 1
            return new Response(
                url === checksumUrl
                    ? requests === 1
                        ? checksum()
                        : checksum(replacement)
                    : replacement,
            )
        })
        expect(new Uint8Array(bytes)).toEqual(replacement)
        expect(requests).toBe(6)
    })

    test('fails closed when checksums keep changing', async () => {
        let requests = 0
        await expect(
            downloadGeoip(async (url) => {
                requests += 1
                return new Response(
                    url === checksumUrl && requests % 3 === 0
                        ? 'a'.repeat(64) + '  user-country.mmdb\n'
                        : url === checksumUrl
                          ? checksum()
                          : database,
                )
            }),
        ).rejects.toThrow('GeoIP checksum changed during download')
        expect(requests).toBe(6)
    })

    test.each([0, 1, 2])(
        'retries a removed checksum or database once at request position %i',
        async (position) => {
            let requests = 0
            const bytes = await downloadGeoip(async (url) => {
                const index = requests++
                return index === position
                    ? new Response('private error body', { status: 404 })
                    : validResponse(url)
            })
            expect(new Uint8Array(bytes)).toEqual(database)
            expect(requests).toBe(position + 4)
        },
    )

    test('bounds retries when the checksum or database stays unavailable', async () => {
        await Promise.all(
            [checksumUrl, databaseUrl].map(async (missingUrl) => {
                let requests = 0
                await expect(
                    downloadGeoip(async (url) => {
                        requests += 1
                        return url === missingUrl
                            ? new Response('private error body', { status: 404 })
                            : validResponse(url)
                    }),
                ).rejects.toThrow('download failed (HTTP 404)')
                expect(requests).toBe(missingUrl === checksumUrl ? 2 : 4)
            }),
        )
    })

    test.each([403, 429, 500])(
        'does not retry other HTTP failures or expose response contents: %i',
        async (status) => {
            await Promise.all(
                [checksumUrl, databaseUrl].map(async (failedUrl) => {
                    let requests = 0
                    await expect(
                        downloadGeoip(async (url) => {
                            requests += 1
                            return url === failedUrl
                                ? new Response('private error body', { status })
                                : validResponse(url)
                        }),
                    ).rejects.toThrow('download failed (HTTP ' + status + ')')
                    expect(requests).toBe(failedUrl === checksumUrl ? 1 : 2)
                }),
            )
        },
    )
})
