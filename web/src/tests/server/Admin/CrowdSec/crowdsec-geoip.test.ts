import { expect, mock, test } from 'bun:test'

import type { CrowdSecDashboard } from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import filterCrowdSecDashboard from '@/lib/Admin/CrowdSec/filterCrowdSecDashboard.ts'

const lookup = mock((ip: string) => (ip === '203.0.113.120' ? { country_code: 'DE' } : null))
mock.module('maxmind', () => ({ default: { open: async () => ({ get: lookup }) } }))

const { enrichCrowdSecCountryCodes } =
    await import('@/server/Admin/CrowdSec/crowdsec-geoip.server.ts')

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
