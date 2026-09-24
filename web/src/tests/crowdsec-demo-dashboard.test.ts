import { expect, test } from 'bun:test'

import { createCrowdSecDemoDashboard } from '../../../scripts/seed-crowdsec-dashboard-demo'
import countryCodeFromGeoRecord from '../features/Admin/CrowdSec/Helpers/countryCodeFromGeoRecord'
import {
    filterCrowdSecDemoDashboard,
    isLocalCrowdSecDemoEnvironment,
} from '../features/Admin/CrowdSec/Helpers/demoDashboard'

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
