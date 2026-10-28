import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import type { Reader } from 'mmdb-lib'

import type {
    CrowdSecDashboard,
    CrowdSecDecision,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import filterCrowdSecDashboard from '@/lib/Admin/CrowdSec/filterCrowdSecDashboard.ts'

const database = Buffer.from('country-database')
const stat = mock(async () => ({ size: database.length, isFile: (): boolean => true }))
const read = mock(async (buffer: Buffer, offset: number, length: number, position: number) => ({
    bytesRead: database.copy(buffer, offset, position, position + length),
    buffer,
}))
const close = mock(async () => undefined)
const file = { stat, read, close }
const open = mock(async (_path: string, _flags: string) => file)
const lookup = mock((ip: string): unknown =>
    ip === '203.0.113.120' ? { country_code: 'DE' } : null,
)
const construct = mock(function (
    _bytes: Buffer,
    _options: NonNullable<ConstructorParameters<typeof Reader>[1]>,
) {
    return { get: lookup }
})
mock.module('node:fs/promises', () => ({ open }))
mock.module('mmdb-lib', () => ({ Reader: construct }))

const { createGeoReader, enrichCrowdSecCountryCodes } =
    await import('@/server/Admin/CrowdSec/crowdsec-geoip.server.ts')

beforeEach(() => {
    stat.mockReset().mockResolvedValue({ size: database.length, isFile: () => true })
    read.mockReset().mockImplementation(async (buffer, offset, length, position) => ({
        bytesRead: database.copy(buffer, offset, position, position + length),
        buffer,
    }))
    close.mockReset().mockResolvedValue(undefined)
    open.mockReset().mockResolvedValue(file)
    lookup
        .mockReset()
        .mockImplementation((ip) => (ip === '203.0.113.120' ? { country_code: 'DE' } : null))
    construct.mockReset().mockImplementation(function () {
        return { get: lookup }
    })
})

describe('local country database reader', () => {
    test('uses an absolute configured path and the existing development and production defaults', async () => {
        const configured = process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH
        const environment = process.env.NODE_ENV
        try {
            const path = join(process.cwd(), 'configured-country.mmdb')
            process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH = ` ${path} `
            await createGeoReader()()
            expect(open).toHaveBeenLastCalledWith(path, 'r')
            process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH = 'relative-country.mmdb'
            process.env.NODE_ENV = 'test'
            await createGeoReader()()
            expect(open).toHaveBeenLastCalledWith(
                join(process.cwd(), '.local', 'geoip', 'user-country.mmdb'),
                'r',
            )
            process.env.NODE_ENV = 'production'
            await createGeoReader()()
            expect(open).toHaveBeenLastCalledWith(
                '/usr/share/rentnerproxy/geoip/user-country.mmdb',
                'r',
            )
        } finally {
            if (configured === undefined) delete process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH
            else process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH = configured
            if (environment === undefined) delete process.env.NODE_ENV
            else process.env.NODE_ENV = environment
        }
    })

    test('shares one load across concurrent and subsequent callers', async () => {
        const path = join(process.cwd(), 'country.mmdb')
        const load = createGeoReader(() => path)
        const [first, second] = await Promise.all([load(), load()])
        expect(first).not.toBeNull()
        expect(second).toBe(first)
        expect(await load()).toBe(first)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith(path, 'r')
        expect(construct).toHaveBeenCalledTimes(1)
        expect(construct.mock.calls[0]?.[0]).toEqual(database)
        expect(close).toHaveBeenCalledTimes(1)
    })

    test('assembles partial reads without passing the spare byte to the parser', async () => {
        read.mockImplementation(async (buffer, offset, length, position) => ({
            bytesRead: database.copy(buffer, offset, position, position + Math.min(length, 3)),
            buffer,
        }))
        expect(await createGeoReader()()).not.toBeNull()
        expect(read.mock.calls.length).toBeGreaterThan(2)
        expect(construct.mock.calls[0]?.[0]).toEqual(database)
        expect(close).toHaveBeenCalledTimes(1)
    })

    test.each([0, 64 * 1024 * 1024 + 1])(
        'rejects a file of %i bytes before reading',
        async (size) => {
            stat.mockResolvedValue({ size, isFile: () => true })
            expect(await createGeoReader()()).toBeNull()
            expect(read).not.toHaveBeenCalled()
            expect(construct).not.toHaveBeenCalled()
            expect(close).toHaveBeenCalledTimes(1)
        },
    )

    test('rejects a non-regular file before reading', async () => {
        stat.mockResolvedValue({ size: database.length, isFile: () => false })
        expect(await createGeoReader()()).toBeNull()
        expect(read).not.toHaveBeenCalled()
        expect(close).toHaveBeenCalledTimes(1)
    })

    test.each([-1, 1])(
        'rejects a file whose size changes by %i bytes while loading',
        async (delta) => {
            stat.mockResolvedValue({ size: database.length + delta, isFile: () => true })
            expect(await createGeoReader()()).toBeNull()
            expect(construct).not.toHaveBeenCalled()
            expect(close).toHaveBeenCalledTimes(1)
            expect(read.mock.calls[0]?.[0].length).toBe(database.length + delta + 1)
        },
    )

    test.each(['missing file', 'permission denied'])(
        'retries after an open failure: %s',
        async (message) => {
            open.mockRejectedValueOnce(new Error(message))
            const load = createGeoReader()
            const failed = await Promise.all([load(), load()])
            expect(failed).toEqual([null, null])
            expect(open).toHaveBeenCalledTimes(1)
            expect(close).not.toHaveBeenCalled()
            expect(await load()).not.toBeNull()
            expect(open).toHaveBeenCalledTimes(2)
        },
    )

    test.each(['stat', 'read', 'parse'] as const)(
        'closes the file and retries after a %s failure',
        async (stage) => {
            if (stage === 'stat') stat.mockRejectedValueOnce(new Error('stat failed'))
            if (stage === 'read') read.mockRejectedValueOnce(new Error('read failed'))
            if (stage === 'parse')
                construct.mockImplementationOnce(() => {
                    throw new Error('invalid mmdb')
                })
            const load = createGeoReader()
            expect(await load()).toBeNull()
            expect(close).toHaveBeenCalledTimes(1)
            expect(await load()).not.toBeNull()
            expect(close).toHaveBeenCalledTimes(2)
        },
    )

    test('bounds the decoder cache and evicts the least recently used entry', async () => {
        await createGeoReader()()
        const cache = construct.mock.calls[0]?.[1].cache
        expect(cache).toBeDefined()
        if (!cache) throw new Error('Reader cache is missing')
        for (let key = 0; key < 10_000; key++) cache.set(key, { key })
        const original = cache.get(0)
        expect(original).toEqual({ key: 0 })
        cache.set(10_000, 'new entry')
        expect(cache.get(1)).toBeUndefined()
        expect(cache.get(0)).toBe(original)
        cache.set(0, 'updated entry')
        expect(cache.get(2)).toEqual({ key: 2 })
        cache.set('string key', null)
        expect(cache.get(3)).toBeUndefined()
        expect(cache.get('string key')).toBeNull()
        expect(cache.get(0)).toBe('updated entry')
        for (let key = 10_001; key < 25_000; key++) cache.set(key, key)
        const retained = Array.from({ length: 25_000 }, (_, key) => cache.get(key)).filter(
            (value) => value !== undefined,
        )
        expect(retained).toHaveLength(10_000)
        await createGeoReader()()
        expect(construct.mock.calls[1]?.[1].cache?.get(24_999)).toBeUndefined()
    })
})

test('filters using local GeoIP countries beyond the first page without dropping known metadata', async () => {
    const source: CrowdSecDashboard = {
        collectedAt: 1,
        metrics: null,
        decisions: {
            total: 121,
            filteredTotal: 121,
            offset: 0,
            limit: 15,
            availableOrigins: ['crowdsec'],
            entries: Array.from({ length: 121 }, (_, id) => ({
                id,
                scope: 'Ip',
                value: `203.0.113.${id + 1}`,
                origin: 'crowdsec',
                scenario: 'http-bf',
                duration: '2h',
                countryCode: id === 120 ? 'DE' : null,
            })),
        },
    }
    const enriched = await enrichCrowdSecCountryCodes(source)
    const filtered = filterCrowdSecDashboard(enriched, {
        offset: 0,
        limit: 15,
        search: '',
        origin: '',
        scope: '',
        country: 'DE',
    })
    expect(filtered.decisions?.filteredTotal).toBe(2)
    expect(filtered.decisions?.total).toBe(121)
    expect(filtered.decisions?.entries.map(({ id }) => id)).toEqual([119, 120])
    expect(lookup).not.toHaveBeenCalledWith('203.0.113.121')
    expect(source.decisions?.entries[119]?.countryCode).toBeNull()
})

test('preserves known metadata and skips non-IP scopes, invalid IPs and failed lookups', async () => {
    const values = [
        '2001:db8::1',
        '203.0.113.5',
        '203.0.113.6',
        'invalid-ip',
        '203.0.113.7',
        '203.0.113.0/24',
    ]
    const entries = values.map((value, id): CrowdSecDecision => ({
        id,
        scope: id === 5 ? 'Range' : 'Ip',
        value,
        origin: 'crowdsec',
        scenario: 'http-bf',
        duration: '2h',
        countryCode: id === 4 ? 'FR' : null,
    }))
    const source: CrowdSecDashboard = {
        collectedAt: 1,
        metrics: null,
        decisions: {
            total: entries.length,
            filteredTotal: entries.length,
            offset: 0,
            limit: 15,
            availableOrigins: ['crowdsec'],
            entries,
        },
    }
    lookup.mockImplementation((ip) => {
        if (ip === '2001:db8::1') return { country: { iso_code: 'NL' } }
        if (ip === '203.0.113.5') throw new Error('invalid data pointer')
        return { country_code: 'de' }
    })
    const enriched = await enrichCrowdSecCountryCodes(source)
    expect(enriched.decisions?.entries.map((entry) => entry.countryCode)).toEqual([
        'NL',
        null,
        null,
        null,
        'FR',
        null,
    ])
    expect(lookup).toHaveBeenCalledTimes(3)
    expect(enriched.decisions?.entries.slice(1)).toEqual(entries.slice(1))
    expect(source.decisions?.entries[0]?.countryCode).toBeNull()
    expect(source.decisions?.entries[4]?.countryCode).toBe('FR')
})

test('keeps dashboards unchanged when there are no countries to enrich', async () => {
    const source: CrowdSecDashboard = { collectedAt: 1, metrics: null, decisions: null }
    expect(await enrichCrowdSecCountryCodes(source)).toBe(source)
    expect(open).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
})
