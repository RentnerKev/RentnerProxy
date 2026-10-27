import { describe, expect, test } from 'bun:test'
import {
    certificateConnectionZones,
    connectionSupportsOperation,
    verifiedConnectionZones,
    zoneCoversDomains,
} from '@/lib/DnsConnections/connectionEligibility.ts'
import { DDNS_CONNECTION } from '@/tests/Helpers/ddnsFixture.ts'
import type { DnsProviderDescriptor } from '@/lib/DnsConnections/Types/dns-provider.types.ts'

const providers: readonly DnsProviderDescriptor[] = [
    {
        id: 'cloudflare',
        capabilities: {
            zoneDiscovery: true,
            txtCreate: true,
            txtCleanup: true,
            addressRecordTypes: ['A', 'AAAA'],
            proxyOptions: 'cloudflare',
        },
    },
]

describe('verified provider eligibility', () => {
    test('untested, failed and disconnected accounts cannot be offered as usable', () => {
        for (const status of ['untested', 'failed', 'disconnected'] as const) {
            const connection = {
                ...DDNS_CONNECTION,
                verification: { status, checkedAt: null, zoneIds: [], error: null },
            }
            expect(verifiedConnectionZones(connection)).toEqual([])
            expect(connectionSupportsOperation(connection, providers, 'dns01')).toBeFalse()
            expect(connectionSupportsOperation(connection, providers, 'A')).toBeFalse()
        }
        expect(
            connectionSupportsOperation(
                { ...DDNS_CONNECTION, verification: undefined },
                providers,
                'dns01',
            ),
        ).toBeFalse()
    })
    test('requires adapter capabilities for the selected operation and verified zone', () => {
        expect(connectionSupportsOperation(DDNS_CONNECTION, providers, 'dns01')).toBeTrue()
        expect(connectionSupportsOperation(DDNS_CONNECTION, providers, 'both')).toBeTrue()
        const reduced = [
            {
                ...providers[0]!,
                capabilities: {
                    ...providers[0]!.capabilities,
                    txtCleanup: false,
                    addressRecordTypes: ['A'] as const,
                },
            },
        ]
        expect(connectionSupportsOperation(DDNS_CONNECTION, reduced, 'dns01')).toBeFalse()
        expect(connectionSupportsOperation(DDNS_CONNECTION, reduced, 'A')).toBeTrue()
        expect(connectionSupportsOperation(DDNS_CONNECTION, reduced, 'both')).toBeFalse()
        expect(connectionSupportsOperation(DDNS_CONNECTION, [], 'A')).toBeFalse()
    })
    test('covers all SANs on label boundaries, including apex and wildcard', () => {
        const zone = DDNS_CONNECTION.zones[0]!
        expect(
            zoneCoversDomains(zone, ['Example.COM.', '*.example.com', ' edge.example.com ']),
        ).toBeTrue()
        expect(zoneCoversDomains(zone, ['notexample.com'])).toBeFalse()
        expect(zoneCoversDomains(zone, ['example.com', 'example.org'])).toBeFalse()
        expect(zoneCoversDomains(zone, [''])).toBeFalse()
    })
})

test('delegated zone eligibility permits outside SAN zones but still requires verification', () => {
    const domains = ['*.customer.example.net', 'customer.example.net']
    expect(certificateConnectionZones(DDNS_CONNECTION, domains, 'provider')).toEqual([])
    expect(certificateConnectionZones(DDNS_CONNECTION, domains, undefined)).toEqual([])
    expect(certificateConnectionZones(DDNS_CONNECTION, domains, 'delegated')).toEqual([
        ...DDNS_CONNECTION.zones,
    ])
    for (const status of ['untested', 'disconnected', 'failed'] as const) {
        expect(
            certificateConnectionZones(
                {
                    ...DDNS_CONNECTION,
                    verification: { status, checkedAt: null, zoneIds: [], error: null },
                },
                domains,
                'delegated',
            ),
        ).toEqual([])
    }
})
