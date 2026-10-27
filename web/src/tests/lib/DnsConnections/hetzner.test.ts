import { describe, expect, test } from 'bun:test'
import {
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
    dnsConnectionReferenceSchema,
} from '@/features/Admin/DnsConnections/validation.ts'
import {
    dnsConnectionMetadataSchema,
    dnsConnectionTestResultSchema,
} from '@/server/Controller/dns-connections.validation.ts'
import {
    dnsZoneIdSchema,
    hetznerZoneIdSchema,
    isDnsZoneIdForProvider,
} from '@/lib/DnsConnections/validation.ts'
import {
    requestCertificateInputSchema,
    certificateRequestInputFromForm,
} from '@/features/Admin/CertificateManagement/validation.ts'
import { ddnsTargetSchema } from '@/lib/Ddns/validation.ts'
import { DDNS_CONNECTION, ddnsTarget } from '@/tests/Helpers/ddnsFixture.ts'

const connectionId = DDNS_CONNECTION.id
const zoneId = '9223372036854775807'
const create = {
    provider: 'hetzner',
    name: 'Hetzner Cloud DNS',
    expectedRevision: 0,
    apiToken: 'fixture-token',
    zoneIds: [zoneId],
}

describe('Hetzner Cloud DNS contracts', () => {
    test.each(['1', '123456', '9223372036854775807'])(
        'accepts canonical positive int64 zone %s across connection boundaries',
        (id) => {
            expect(hetznerZoneIdSchema.safeParse(id).success).toBe(true)
            expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds: [id] }).success).toBe(
                true,
            )
            expect(
                testDnsConnectionSchema.safeParse({
                    provider: 'hetzner',
                    apiToken: create.apiToken,
                    zoneIds: [id],
                }).success,
            ).toBe(true)
            expect(
                dnsConnectionReferenceSchema.safeParse({
                    connectionId,
                    zoneId: id,
                    consumer: { type: 'dns01', id: connectionId },
                }).success,
            ).toBe(true)
        },
    )
    test.each([
        '',
        '0',
        '-1',
        '+1',
        '01',
        ' 1',
        '1 ',
        '1\n',
        '1\r\n',
        '\t1',
        '1.0',
        '1e3',
        '9223372036854775808',
        '99999999999999999999',
        'example.com',
        'a'.repeat(32),
        '1/records',
        '1\\records',
    ])('rejects invalid Hetzner zone %s', (id) => {
        expect(hetznerZoneIdSchema.safeParse(id).success).toBe(false)
        expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds: [id] }).success).toBe(false)
    })
    test('keeps provider zone formats distinct and legacy Cloudflare defaults strict', () => {
        expect(dnsZoneIdSchema.safeParse(zoneId).success).toBe(true)
        for (const provider of ['cloudflare', 'desec'] as const) {
            expect(isDnsZoneIdForProvider(zoneId, provider)).toBe(false)
            expect(saveDnsConnectionSchema.safeParse({ ...create, provider }).success).toBe(false)
        }
        expect(saveDnsConnectionSchema.safeParse({ ...create, provider: undefined }).success).toBe(
            false,
        )
        expect(
            saveDnsConnectionSchema.safeParse({
                ...create,
                provider: undefined,
                connectionId,
                expectedRevision: 1,
                apiToken: undefined,
            }).success,
        ).toBe(true)
    })
    test('validates metadata, verification and references against the declared provider', () => {
        const zones = [{ id: zoneId, name: 'example.com' }]
        const metadata = {
            ...DDNS_CONNECTION,
            provider: 'hetzner',
            zones,
            references: [{ zoneId, consumer: { type: 'dns01', id: connectionId } }],
            verification: {
                status: 'connected',
                checkedAt: DDNS_CONNECTION.updatedAt,
                zoneIds: [zoneId],
                error: null,
            },
        }
        expect(dnsConnectionMetadataSchema.safeParse(metadata).success).toBe(true)
        expect(
            dnsConnectionTestResultSchema.safeParse({
                zones,
                selectedZoneIds: [zoneId],
                checkedAt: DDNS_CONNECTION.updatedAt,
                dnsWriteVerified: false,
            }).success,
        ).toBe(true)
        for (const invalid of [
            { ...metadata, provider: 'cloudflare' },
            { ...metadata, zones: DDNS_CONNECTION.zones },
            {
                ...metadata,
                references: [
                    { zoneId: 'example.com', consumer: { type: 'dns01', id: connectionId } },
                ],
            },
            { ...metadata, verification: { ...metadata.verification, zoneIds: ['example.com'] } },
        ])
            expect(dnsConnectionMetadataSchema.safeParse(invalid).success).toBe(false)
    })
    test('uses saved Hetzner references for DNS-01 without exposing inline credentials', () => {
        const request = certificateRequestInputFromForm({
            name: 'edge',
            domains: ['example.com', '*.example.com'],
            environment: 'staging',
            challengeType: 'dns-01',
            dnsZoneId: zoneId,
            dnsApiToken: 'unused-secret',
            dnsConnectionId: connectionId,
            dnsConnectionProvider: 'hetzner',
            contactEmail: '',
            acceptTerms: true,
        })
        expect(requestCertificateInputSchema.safeParse(request).success).toBe(true)
        expect(request.dnsProvider).toEqual({
            type: 'connection',
            provider: 'hetzner',
            connectionId,
            zoneId,
        })
        expect(JSON.stringify(request)).not.toContain('unused-secret')
        expect(
            requestCertificateInputSchema.safeParse({
                ...request,
                dnsProvider: { type: 'hetzner', zoneId, apiToken: 'fixture-token' },
            }).success,
        ).toBe(false)
        expect(
            requestCertificateInputSchema.safeParse({
                ...request,
                dnsProvider: {
                    type: 'connection',
                    provider: 'hetzner',
                    connectionId,
                    zoneId: 'example.com',
                },
            }).success,
        ).toBe(false)
    })
    test('accepts numeric DDNS zones while keeping adoption IDs opaque lowercase hex', () => {
        for (const recordType of ['A', 'AAAA'] as const) {
            const target = ddnsTarget({
                zoneId,
                recordType,
                proxied: false,
                selection: { mode: 'adopt', recordId: 'b'.repeat(32) },
            })
            expect(ddnsTargetSchema.safeParse(target).success).toBe(true)
            for (const recordId of [zoneId, 'B'.repeat(32), 'b'.repeat(31)])
                expect(
                    ddnsTargetSchema.safeParse({
                        ...target,
                        selection: { mode: 'adopt', recordId },
                    }).success,
                ).toBe(false)
        }
    })
})
