import { describe, expect, test } from 'bun:test'
import {
    deleteDnsConnectionSchema,
    dnsConnectionReferenceSchema,
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
} from '@/features/Admin/DnsConnections/validation.ts'

const connectionId = '0198d98a-0000-7000-8000-000000000001'
const zoneId = 'a'.repeat(32)
const create = {
    name: 'Home zones',
    expectedRevision: 0,
    apiToken: 'controlled-token',
    zoneIds: [zoneId],
}

describe('DNS connection input contracts', () => {
    test('supports several selected zones and blank-token retention only for edits', () => {
        expect(
            saveDnsConnectionSchema.parse({
                ...create,
                name: '  Home zones  ',
                zoneIds: [zoneId, 'b'.repeat(32)],
            }).name,
        ).toBe('Home zones')
        expect(
            saveDnsConnectionSchema.safeParse({
                ...create,
                connectionId,
                expectedRevision: 3,
                apiToken: undefined,
            }).success,
        ).toBe(true)
        for (const input of [
            { ...create, apiToken: undefined },
            { ...create, apiToken: '' },
            { ...create, expectedRevision: 1 },
            { ...create, connectionId },
            { ...create, expectedRevision: -1 },
            { ...create, connectionId, expectedRevision: 4_294_967_296 },
        ])
            expect(saveDnsConnectionSchema.safeParse(input).success).toBe(false)
    })

    test('bounds and deduplicates zone selection without accepting forged zone metadata', () => {
        const maximumZones = Array.from({ length: 50 }, (_, index) =>
            index.toString(16).padStart(32, '0'),
        )
        expect(
            saveDnsConnectionSchema.safeParse({ ...create, zoneIds: maximumZones }).success,
        ).toBe(true)
        for (const zoneIds of [
            [],
            [zoneId, zoneId],
            ['A'.repeat(32)],
            [zoneId.slice(1)],
            [zoneId + '/records'],
            [...maximumZones, 'f'.repeat(32)],
        ]) {
            expect(saveDnsConnectionSchema.safeParse({ ...create, zoneIds }).success).toBe(false)
        }
        expect(
            saveDnsConnectionSchema.safeParse({
                ...create,
                zones: [{ id: zoneId, name: 'forged.example' }],
            }).success,
        ).toBe(false)
    })

    test('rejects control and format characters, oversized names and unsafe tokens', () => {
        for (const name of [
            '',
            ' ',
            'x'.repeat(101),
            '😎'.repeat(51),
            'Home\u202ezones',
            'Home\nname',
        ]) {
            expect(saveDnsConnectionSchema.safeParse({ ...create, name }).success).toBe(false)
        }
        for (const apiToken of [
            '',
            'x'.repeat(513),
            'token value',
            'token\nvalue',
            'token\u0000value',
            'tökén',
        ]) {
            expect(saveDnsConnectionSchema.safeParse({ ...create, apiToken }).success).toBe(false)
        }
        expect(
            saveDnsConnectionSchema.safeParse({ ...create, actorUserId: connectionId }).success,
        ).toBe(false)
    })

    test('tests an explicit draft or saved connection without requiring zone writes', () => {
        for (const input of [
            { apiToken: create.apiToken },
            { connectionId },
            { connectionId, zoneIds: [zoneId] },
        ]) {
            expect(testDnsConnectionSchema.safeParse(input).success).toBe(true)
        }
        expect(testDnsConnectionSchema.safeParse({}).success).toBe(false)
        expect(
            testDnsConnectionSchema.safeParse({
                apiToken: create.apiToken,
                apiUrl: 'https://other.example',
            }).success,
        ).toBe(false)
        expect(
            testDnsConnectionSchema.safeParse({ connectionId, zoneIds: [zoneId, zoneId] }).success,
        ).toBe(false)
    })

    test('requires typed consumer identity and an optimistic deletion revision', () => {
        const reference = { connectionId, zoneId, consumer: { type: 'dns01', id: connectionId } }
        expect(dnsConnectionReferenceSchema.safeParse(reference).success).toBe(true)
        expect(
            dnsConnectionReferenceSchema.safeParse({
                ...reference,
                consumer: { type: 'ddns', id: connectionId },
            }).success,
        ).toBe(true)
        for (const consumer of [
            { type: 'other', id: connectionId },
            { type: 'ddns', id: 'consumer' },
            { type: 'ddns', id: connectionId, apiToken: create.apiToken },
        ]) {
            expect(dnsConnectionReferenceSchema.safeParse({ ...reference, consumer }).success).toBe(
                false,
            )
        }
        expect(
            deleteDnsConnectionSchema.safeParse({ connectionId, expectedRevision: 1 }).success,
        ).toBe(true)
        expect(
            deleteDnsConnectionSchema.safeParse({ connectionId, expectedRevision: 0 }).success,
        ).toBe(false)
    })
})
