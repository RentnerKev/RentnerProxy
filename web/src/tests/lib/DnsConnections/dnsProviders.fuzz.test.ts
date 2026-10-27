import { expect, test } from 'bun:test'
import * as fc from 'fast-check'
import { dnsProviderCatalogSchema, dnsProviderIdSchema } from '@/lib/DnsConnections/validation.ts'

test('provider identifiers are a closed built-in set, never plugin names or paths', () => {
    fc.assert(
        fc.property(fc.string(), (value) => {
            expect(dnsProviderIdSchema.safeParse(value).success).toBe(
                value === 'cloudflare' || value === 'desec' || value === 'hetzner',
            )
        }),
        { numRuns: 500 },
    )
})

test('malformed capability values cannot advertise a supported operation', () => {
    fc.assert(
        fc.property(fc.jsonValue(), (capabilities) => {
            const parsed = dnsProviderCatalogSchema.safeParse({
                providers: [{ id: 'cloudflare', capabilities }],
            })
            if (parsed.success) {
                const value = parsed.data.providers[0]!.capabilities
                expect(typeof value.zoneDiscovery).toBe('boolean')
                expect(typeof value.txtCreate).toBe('boolean')
                expect(typeof value.txtCleanup).toBe('boolean')
                expect(new Set(value.addressRecordTypes).size).toBe(value.addressRecordTypes.length)
                expect(['none', 'cloudflare']).toContain(value.proxyOptions)
            } else expect(parsed.success).toBe(false)
        }),
        { numRuns: 500 },
    )
})
