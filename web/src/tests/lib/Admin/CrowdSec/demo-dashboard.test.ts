import { expect, test } from 'bun:test'

import { createCrowdSecDemoDashboard } from '../../../../../../scripts/development/seed-crowdsec-dashboard-demo.ts'
import countryCodeFromGeoRecord from '@/lib/Admin/CrowdSec/countryCodeFromGeoRecord.ts'
import filterCrowdSecDashboard from '@/lib/Admin/CrowdSec/filterCrowdSecDashboard.ts'
import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import {
    filterCrowdSecDemoDashboard,
    isLocalCrowdSecDemoEnvironment,
} from '@/lib/Admin/CrowdSec/demoDashboard.ts'

test('allows CrowdSec demo data only for a loopback development app and database', () => {
    const local = {
        NODE_ENV: 'development',
        APP_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/rentnerproxy',
    }
    expect(isLocalCrowdSecDemoEnvironment(local)).toBe(true)
    expect(isLocalCrowdSecDemoEnvironment({ ...local, NODE_ENV: 'production' })).toBe(false)
    expect(
        isLocalCrowdSecDemoEnvironment({ ...local, APP_URL: 'https://proxy.example.test' }),
    ).toBe(false)
    expect(
        isLocalCrowdSecDemoEnvironment({
            ...local,
            DATABASE_URL: 'postgresql://user:password@db.example.test:5432/rentnerproxy',
        }),
    ).toBe(false)
})

test('paginates and filters synthetic decisions without changing the stored snapshot', () => {
    const source = createCrowdSecDemoDashboard()
    const filtered = filterCrowdSecDemoDashboard(source, {
        offset: 0,
        limit: 2,
        search: 'http-probing',
        origin: 'CAPI',
        scope: 'Ip',
        country: '',
    })
    expect(filtered.demo).toBe(true)
    expect(filtered.decisions?.total).toBe(32)
    expect(filtered.decisions?.filteredTotal).toBeGreaterThan(1)
    expect(filtered.decisions?.entries).toHaveLength(2)
    expect(source.metrics?.decisionsByOrigin).toEqual(
        ['crowdsec', 'CAPI', 'cscli'].map((origin) => ({
            origin,
            count: source.decisions?.entries.filter((entry) => entry.origin === origin).length ?? 0,
        })),
    )
    expect(
        filtered.decisions?.entries.every(
            (entry) =>
                entry.origin === 'CAPI' &&
                entry.scope === 'Ip' &&
                entry.scenario.includes('http-probing'),
        ),
    ).toBe(true)
    expect(source.demo).toBeUndefined()
    expect(source.decisions?.entries).toHaveLength(32)
    const nextPage = filterCrowdSecDemoDashboard(source, {
        offset: 1,
        limit: 2,
        search: 'http-probing',
        origin: 'CAPI',
        scope: 'Ip',
        country: '',
    })
    expect(nextPage.decisions?.entries).toHaveLength(1)
})

test('accepts country-only and GeoLite2 country records but rejects invalid codes', () => {
    expect(countryCodeFromGeoRecord({ country_code: 'DE' })).toBe('DE')
    expect(countryCodeFromGeoRecord({ country: { iso_code: 'NL' } })).toBe('NL')
    expect(countryCodeFromGeoRecord({ country_code: '../DE' })).toBeNull()
    expect(countryCodeFromGeoRecord({ country_code: 'de' })).toBeNull()
    expect(countryCodeFromGeoRecord(null)).toBeNull()
})

test('combines country, origin, type and search before pagination across the complete snapshot', () => {
    const template = createCrowdSecDemoDashboard().decisions!.entries[1]!
    const entries = [
        ...Array.from({ length: 200 }, (_, id) => ({ ...template, id, countryCode: 'FR' })),
        ...Array.from({ length: 5 }, (_, index) => ({
            ...template,
            id: 201 + index,
            countryCode: 'DE',
        })),
        { ...template, id: 206, countryCode: 'DE', origin: 'other' },
        { ...template, id: 207, countryCode: 'DE', scope: 'Range' as const },
        { ...template, id: 208, countryCode: 'DE', scenario: 'ssh-bf' },
        { ...template, id: 209, countryCode: null },
    ]
    const source: CrowdSecDashboard = {
        collectedAt: 1,
        metrics: null,
        decisions: {
            total: entries.length,
            filteredTotal: entries.length,
            offset: 0,
            limit: 15,
            availableOrigins: [template.origin, 'other'],
            entries,
        },
    }
    const query: CrowdSecDashboardQuery = {
        offset: 2,
        limit: 2,
        search: 'http',
        origin: template.origin,
        scope: 'Ip',
        country: 'DE',
    }
    const filtered = filterCrowdSecDashboard(source, query)
    expect(filtered.decisions?.filteredTotal).toBe(5)
    expect(filtered.decisions?.total).toBe(209)
    expect(filtered.decisions?.entries.map(({ id }) => id)).toEqual([203, 204])
    expect(filtered.decisions?.availableOrigins).toEqual(source.decisions!.availableOrigins)
    expect(
        filterCrowdSecDashboard(source, { ...query, country: '' }).decisions?.filteredTotal,
    ).toBe(206)
    expect(
        filterCrowdSecDashboard(source, { ...query, country: 'US' }).decisions?.filteredTotal,
    ).toBe(0)
    expect(source.decisions?.entries).toHaveLength(209)
    expect(source.decisions?.filteredTotal).toBe(209)
    const demo = filterCrowdSecDemoDashboard(source, query)
    expect(demo.decisions).toEqual(filtered.decisions)
    expect(demo.demo).toBeTrue()
})
