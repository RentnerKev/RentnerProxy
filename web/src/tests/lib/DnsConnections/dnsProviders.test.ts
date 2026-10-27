import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
    dnsProviderForId,
    supportsDdns,
    supportsDns01,
    supportsProxyOption,
} from '@/lib/DnsConnections/dnsProviders.ts'
import { dnsProviderCatalogSchema } from '@/lib/DnsConnections/validation.ts'
import type { DnsProviderDescriptor } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
import {
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
} from '@/features/Admin/DnsConnections/validation.ts'

const fixture: unknown = JSON.parse(
    await readFile(
        new URL('../../../../../core/tests/fixtures/dns-provider-catalog.json', import.meta.url),
        'utf8',
    ),
)
const catalog = dnsProviderCatalogSchema.parse(fixture)
const cloudflare = catalog.providers[0]!

describe('shared DNS provider contract', () => {
    test('accepts the same golden catalogue as the authoritative Rust runtime', () => {
        expect(fixture).toEqual(catalog)
        expect(catalog.providers.map((provider) => provider.id)).toEqual([
            'cloudflare',
            'desec',
            'hetzner',
        ])
        const desec = dnsProviderForId(catalog.providers, 'desec')
        expect(supportsDns01(desec)).toBe(true)
        expect(supportsDdns(desec, 'A')).toBe(true)
        expect(supportsDdns(desec, 'AAAA')).toBe(true)
        expect(supportsProxyOption(desec, false)).toBe(true)
        expect(supportsProxyOption(desec, true)).toBe(false)
        const hetzner = dnsProviderForId(catalog.providers, 'hetzner')
        expect(supportsDns01(hetzner)).toBe(true)
        expect(supportsDdns(hetzner, 'A')).toBe(true)
        expect(supportsDdns(hetzner, 'AAAA')).toBe(true)
        expect(supportsProxyOption(hetzner, false)).toBe(true)
        expect(supportsProxyOption(hetzner, true)).toBe(false)
        expect(supportsDns01(cloudflare)).toBe(true)
        expect(supportsDdns(cloudflare, 'A')).toBe(true)
        expect(supportsDdns(cloudflare, 'AAAA')).toBe(true)
        expect(supportsProxyOption(cloudflare, true)).toBe(true)
        expect(dnsProviderForId(catalog.providers, 'unknown')).toBeUndefined()
    })

    test('uses individual capabilities and fails closed for unavailable adapters', () => {
        const limited: DnsProviderDescriptor = {
            ...cloudflare,
            capabilities: {
                zoneDiscovery: false,
                txtCreate: true,
                txtCleanup: false,
                addressRecordTypes: ['A'],
                proxyOptions: 'none',
            },
        }
        expect(supportsDns01(limited)).toBe(false)
        expect(supportsDdns(limited, 'A')).toBe(true)
        expect(supportsDdns(limited, 'AAAA')).toBe(false)
        expect(supportsProxyOption(limited, false)).toBe(true)
        expect(supportsProxyOption(limited, true)).toBe(false)
        expect(supportsDns01(undefined)).toBe(false)
        expect(supportsDdns(undefined, 'A')).toBe(false)
        expect(supportsProxyOption(undefined, false)).toBe(false)
    })

    test.each([
        null,
        { providers: [] },
        { providers: [cloudflare, cloudflare] },
        { providers: [{ ...cloudflare, id: 'manual' }] },
        { providers: [{ ...cloudflare, credentials: 'secret' }] },
        {
            providers: [
                { ...cloudflare, capabilities: { ...cloudflare.capabilities, txtCreate: 'true' } },
            ],
        },
        {
            providers: [
                {
                    ...cloudflare,
                    capabilities: { ...cloudflare.capabilities, addressRecordTypes: ['A', 'A'] },
                },
            ],
        },
        {
            providers: [
                {
                    ...cloudflare,
                    capabilities: { ...cloudflare.capabilities, addressRecordTypes: ['TXT'] },
                },
            ],
        },
        {
            providers: [
                {
                    ...cloudflare,
                    capabilities: { ...cloudflare.capabilities, proxyOptions: 'custom' },
                },
            ],
        },
        {
            providers: [
                {
                    ...cloudflare,
                    capabilities: { ...cloudflare.capabilities, module: '/tmp/plugin' },
                },
            ],
        },
    ])('rejects malformed or unregistered catalogue data %#', (value) => {
        expect(dnsProviderCatalogSchema.safeParse(value).success).toBe(false)
    })

    test('retains legacy save/test input while rejecting unregistered provider selectors', () => {
        const legacy = {
            expectedRevision: 0,
            name: 'Existing',
            apiToken: 'fixture-token',
            zoneIds: ['a'.repeat(32)],
        }
        expect(saveDnsConnectionSchema.parse(legacy)).toEqual(legacy)
        expect(saveDnsConnectionSchema.parse({ ...legacy, provider: 'cloudflare' }).provider).toBe(
            'cloudflare',
        )
        for (const provider of ['manual', 'Desec', 'Cloudflare', 'cloudflare ', '', null]) {
            expect(saveDnsConnectionSchema.safeParse({ ...legacy, provider }).success).toBe(false)
            expect(
                testDnsConnectionSchema.safeParse({ apiToken: legacy.apiToken, provider }).success,
            ).toBe(false)
        }
    })
})
