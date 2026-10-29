// oxlint-disable no-map-spread -- Preserve the original immutable selection for comparison.
import { describe, expect, test } from 'bun:test'
import {
    addDdnsDomains,
    approveDdnsInspection,
    canonicalDdnsName,
    createDdnsTargetId,
    ddnsDraft,
    readyDdnsPreview,
} from '@/lib/Ddns/targets.ts'
import {
    ddnsDraftSchema,
    ddnsBatchSchema,
    ddnsIdSchema,
    ddnsSnapshotSchema,
    ddnsTargetSchema,
} from '@/lib/Ddns/validation.ts'
import {
    DDNS_CONNECTION,
    ddnsBatch,
    ddnsSettings,
    ddnsSnapshot,
    ddnsTarget,
} from '@/tests/Helpers/ddnsFixture.ts'

describe('explicit DDNS record selection', () => {
    test('accepts an unsupported update result and keeps its preview blocked', () => {
        const settings = ddnsSettings()
        const batch = ddnsBatch(settings)
        batch.targets[0] = {
            ...batch.targets[0]!,
            status: 'failed',
            error: 'update_precondition_unsupported',
        }
        expect(ddnsBatchSchema.safeParse(batch).success).toBe(true)
        expect(readyDdnsPreview(settings, batch)).toBe(false)
    })
    test('reproduces multi-zone IPv4 wildcard and Git proxy exception without selecting sibling hosts', () => {
        const draft = addDdnsDomains(
            ddnsDraft(),
            DDNS_CONNECTION,
            '',
            'example.com, *.example.com\nexample.org; *.example.org git.example.com',
        )
        const settings = {
            ...draft,
            targets: draft.targets.map((target) => ({
                ...target,
                proxied: target.name !== 'git.example.com',
            })),
        }
        expect(
            settings.targets.map((target) => [target.name, target.recordType, target.proxied]),
        ).toEqual([
            ['example.com', 'A', true],
            ['*.example.com', 'A', true],
            ['example.org', 'A', true],
            ['*.example.org', 'A', true],
            ['git.example.com', 'A', false],
        ])
        expect(settings.targets.some((target) => target.name === 'test.example.com')).toBe(false)
        expect(new Set(settings.targets.map((target) => target.id)).size).toBe(5)
        expect(settings.targets[2]?.zoneId).toBe('b'.repeat(32))
    })
    test('normalizes international hostnames and selects A/AAAA independently', () => {
        expect(canonicalDdnsName(' *.BÜCHER.example. ')).toBe('*.xn--bcher-kva.example')
        const draft = addDdnsDomains(
            { ...ddnsDraft(), ipv6: true },
            DDNS_CONNECTION,
            '',
            'example.com',
        )
        expect(draft.targets.map((target) => target.recordType)).toEqual(['A', 'AAAA'])
        expect(ddnsIdSchema.safeParse(createDdnsTargetId()).success).toBe(true)
    })
    test('rejects duplicates, zone escapes, URLs, ports and too many records atomically', () => {
        expect(() =>
            addDdnsDomains(ddnsDraft(), DDNS_CONNECTION, '', 'example.com example.com'),
        ).toThrow('duplicate')
        expect(() =>
            addDdnsDomains(ddnsDraft(), DDNS_CONNECTION, 'a'.repeat(32), 'example.org'),
        ).toThrow('zone')
        expect(() =>
            addDdnsDomains(ddnsDraft(), DDNS_CONNECTION, '', 'example.com.evil.test'),
        ).toThrow('zone')
        for (const input of [
            'https://example.com',
            'example.com:443',
            'foo.*.example.com',
            'example.com/path',
            '127.0.0.1',
        ])
            expect(() => canonicalDdnsName(input)).toThrow()
        expect(
            ddnsDraftSchema.safeParse(ddnsSettings(Array.from({ length: 101 }, () => ddnsTarget())))
                .success,
        ).toBe(false)
    })
    test('adoption binds the inspected ID and requires a second preview', () => {
        const draft = ddnsSettings()
        const first = ddnsBatch(draft)
        expect(readyDdnsPreview(draft, first)).toBe(false)
        const approved = approveDdnsInspection(draft, first)
        expect(approved.targets[0]?.selection).toEqual({ mode: 'adopt', recordId: 'c'.repeat(32) })
        expect(readyDdnsPreview(approved, first)).toBe(false)
        expect(readyDdnsPreview(approved, ddnsBatch(approved))).toBe(true)
        expect(readyDdnsPreview(approved, { ...ddnsBatch(approved), targets: [] })).toBe(false)
    })
    test('missing records require explicit creation approval before a ready preview', () => {
        const draft = ddnsSettings()
        const batch = ddnsBatch(draft)
        batch.targets[0] = {
            ...batch.targets[0]!,
            current: null,
            status: 'creation_required',
            error: 'creation_required',
        }
        const approved = approveDdnsInspection(draft, batch)
        expect(approved.targets[0]?.selection).toEqual({ mode: 'create' })
        expect(readyDdnsPreview(approved, batch)).toBe(false)
    })
})

test('snapshot creation recovery accepts only optional canonical record IDs', () => {
    const snapshot = ddnsSnapshot(ddnsSettings())
    expect(ddnsSnapshotSchema.safeParse(snapshot).success).toBe(true)
    const withRecord = {
        ...snapshot,
        targets: snapshot.targets.map((target) => ({ ...target, createdRecordId: 'd'.repeat(32) })),
    }
    expect(ddnsSnapshotSchema.parse(withRecord).targets[0]?.createdRecordId).toBe('d'.repeat(32))
    for (const createdRecordId of [
        null,
        '',
        'D'.repeat(32),
        'd'.repeat(31),
        'example.com',
        'd'.repeat(32) + '/',
    ]) {
        expect(
            ddnsSnapshotSchema.safeParse({
                ...snapshot,
                targets: snapshot.targets.map((target) => ({ ...target, createdRecordId })),
            }).success,
        ).toBe(false)
    }
})

test('creation recovery IDs cannot be supplied through DDNS configuration input', () => {
    const target = { ...ddnsTarget(), createdRecordId: 'd'.repeat(32) }
    expect(ddnsTargetSchema.safeParse(target).success).toBe(false)
    expect(ddnsDraftSchema.safeParse(ddnsSettings([target])).success).toBe(false)
    expect(
        ddnsDraftSchema.safeParse({ ...ddnsSettings(), createdRecordId: 'd'.repeat(32) }).success,
    ).toBe(false)
})
