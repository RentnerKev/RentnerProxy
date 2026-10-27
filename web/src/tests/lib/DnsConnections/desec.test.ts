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
import { desecZoneIdSchema } from '@/lib/DnsConnections/validation.ts'
import {
    requestCertificateInputSchema,
    certificateRequestInputFromForm,
} from '@/features/Admin/CertificateManagement/validation.ts'
import { ddnsTargetSchema } from '@/lib/Ddns/validation.ts'
import { DDNS_CONNECTION, ddnsTarget } from '@/tests/Helpers/ddnsFixture.ts'

const zoneId = 'xn--bcher-kva.example'
const connectionId = DDNS_CONNECTION.id
const create = {
    provider: 'desec',
    name: 'deSEC',
    expectedRevision: 0,
    apiToken: 'fixture-token',
    zoneIds: [zoneId],
}

describe('deSEC connection contracts', () => {
    test('accepts creation, read tests and saved references using canonical domain zones', () => {
        expect(saveDnsConnectionSchema.safeParse(create).success).toBe(true)
        expect(
            testDnsConnectionSchema.safeParse({
                provider: 'desec',
                apiToken: create.apiToken,
                zoneIds: [zoneId],
            }).success,
        ).toBe(true)
        expect(
            dnsConnectionReferenceSchema.safeParse({
                connectionId,
                zoneId,
                consumer: { type: 'ddns', id: connectionId },
            }).success,
        ).toBe(true)
        expect(
            saveDnsConnectionSchema.safeParse({
                ...create,
                provider: undefined,
                connectionId,
                expectedRevision: 1,
                apiToken: undefined,
            }).success,
        ).toBe(true)
        expect(saveDnsConnectionSchema.safeParse({ ...create, provider: undefined }).success).toBe(
            false,
        )
        expect(
            saveDnsConnectionSchema.safeParse({ ...create, provider: 'cloudflare' }).success,
        ).toBe(false)
        expect(
            saveDnsConnectionSchema.safeParse({ ...create, zoneIds: ['a'.repeat(32)] }).success,
        ).toBe(false)
    })
    test.each([
        'Example.com',
        'example.com.',
        'localhost',
        '*.example.com',
        '-bad.example',
        'bad-.example',
        'bad..example',
        'https://example.com',
        'example.com/records',
        'example.com%2f',
        'example.com?key=x',
        'example.com\\path',
        '127.0.0.1',
        'bücher.example',
        'a'.repeat(64) + '.example',
    ])('rejects malformed domain zones: %s', (invalid) => {
        expect(desecZoneIdSchema.safeParse(invalid).success).toBe(false)
        expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds: [invalid] }).success).toBe(
            false,
        )
        expect(
            dnsConnectionReferenceSchema.safeParse({
                connectionId,
                zoneId: invalid,
                consumer: { type: 'dns01', id: connectionId },
            }).success,
        ).toBe(false)
    })
    test('enforces the deSEC 191-character zone boundary with valid DNS labels', () => {
        const maximum = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63)].join('.')
        const oversized = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(62), 'd'].join('.')
        expect(maximum.length).toBe(191)
        expect(oversized.length).toBe(192)
        expect(desecZoneIdSchema.safeParse(maximum).success).toBe(true)
        expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds: [maximum] }).success).toBe(
            true,
        )
        expect(desecZoneIdSchema.safeParse(oversized).success).toBe(false)
        expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds: [oversized] }).success).toBe(
            false,
        )
        expect(ddnsTargetSchema.safeParse(ddnsTarget({ zoneId: oversized })).success).toBe(false)
    })
    test('validates declared-provider metadata including verification and references', () => {
        const metadata = {
            ...DDNS_CONNECTION,
            provider: 'desec',
            zones: [{ id: zoneId, name: zoneId }],
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
            dnsConnectionMetadataSchema.safeParse({ ...metadata, provider: 'cloudflare' }).success,
        ).toBe(false)
        expect(
            dnsConnectionMetadataSchema.safeParse({ ...metadata, zones: DDNS_CONNECTION.zones })
                .success,
        ).toBe(false)
        expect(
            dnsConnectionTestResultSchema.safeParse({
                zones: metadata.zones,
                selectedZoneIds: [zoneId],
                checkedAt: DDNS_CONNECTION.updatedAt,
                dnsWriteVerified: false,
            }).success,
        ).toBe(true)
    })
    test('uses connection references for DNS-01 and rejects raw deSEC credentials', () => {
        const form = {
            name: 'edge',
            domains: ['example.com', '*.example.com'],
            environment: 'staging',
            challengeType: 'dns-01',
            dnsZoneId: 'example.com',
            dnsApiToken: 'unused-secret',
            dnsConnectionId: connectionId,
            dnsConnectionProvider: 'desec' as const,
            contactEmail: '',
            acceptTerms: true,
        }
        const request = certificateRequestInputFromForm(form)
        expect(requestCertificateInputSchema.safeParse(request).success).toBe(true)
        expect(request.dnsProvider).toEqual({
            type: 'connection',
            provider: 'desec',
            connectionId,
            zoneId: 'example.com',
        })
        expect(JSON.stringify(request)).not.toContain('unused-secret')
        const invalidZone = requestCertificateInputSchema.safeParse({
            ...request,
            dnsProvider: {
                type: 'connection',
                provider: 'desec',
                connectionId,
                zoneId: 'https://example.com',
            },
        })
        expect(invalidZone.success).toBe(false)
        if (!invalidZone.success)
            expect(invalidZone.error.issues[0]?.message).toBe(
                'admin.certificates.validation.dnsZoneId',
            )
        expect(
            requestCertificateInputSchema.safeParse({
                ...request,
                dnsProvider: { type: 'desec', zoneId: 'example.com', apiToken: 'fixture-token' },
            }).success,
        ).toBe(false)
        expect(
            requestCertificateInputSchema.safeParse({
                ...request,
                dnsProvider: {
                    type: 'connection',
                    provider: 'desec',
                    connectionId,
                    zoneId: 'a'.repeat(32),
                },
            }).success,
        ).toBe(false)
    })
    test('keeps DDNS adoption record IDs as lowercase hex while permitting domain zone IDs', () => {
        for (const recordType of ['A', 'AAAA']) {
            const target = ddnsTarget({
                zoneId,
                recordType: recordType as 'A' | 'AAAA',
                proxied: false,
                selection: { mode: 'adopt', recordId: 'b'.repeat(32) },
            })
            expect(ddnsTargetSchema.safeParse(target).success).toBe(true)
            for (const recordId of [zoneId, 'B'.repeat(32), 'b'.repeat(31), 'b'.repeat(32) + '/']) {
                expect(
                    ddnsTargetSchema.safeParse({
                        ...target,
                        selection: { mode: 'adopt', recordId },
                    }).success,
                ).toBe(false)
            }
        }
    })
})
