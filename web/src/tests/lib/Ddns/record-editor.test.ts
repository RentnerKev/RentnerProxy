import { describe, expect, test } from 'bun:test'
import { buildDdnsRecordDraft, ddnsRecordEditorValues } from '@/lib/Ddns/recordEditor.ts'
import { activeDdnsTarget, ddnsDraft } from '@/lib/Ddns/targets.ts'
import { ddnsTargetSchema } from '@/lib/Ddns/validation.ts'
import { DDNS_CONNECTION, ddnsSettings, ddnsTarget } from '@/tests/Helpers/ddnsFixture.ts'

describe('individual DDNS record editor', () => {
    test('automatically matches each input to its longest permitted zone and keeps unrelated rows untouched', () => {
        const existing = ddnsTarget({ name: 'fixed.example.com', enabled: false })
        const values = {
            ...ddnsRecordEditorValues(null),
            connectionId: DDNS_CONNECTION.id,
            domains: [
                { id: 'first', value: '*.EXAMPLE.org.' },
                { id: 'second', value: 'home.example.com' },
            ],
            proxied: false,
        }
        const draft = buildDdnsRecordDraft(
            ddnsSettings([existing]),
            values,
            [DDNS_CONNECTION],
            null,
        )
        expect(draft.targets[0]).toEqual(existing)
        expect(draft.targets.slice(1)).toEqual([
            expect.objectContaining({
                name: '*.example.org',
                zoneId: 'b'.repeat(32),
                proxied: false,
            }),
            expect.objectContaining({
                name: 'home.example.com',
                zoneId: 'a'.repeat(32),
                proxied: false,
            }),
        ])
        expect(draft.targets.some((target) => target.name === 'test.example.com')).toBe(false)
    })
    test('metadata changes preserve the approved target identity even without connection enumeration', () => {
        const target = ddnsTarget({ selection: { mode: 'adopt', recordId: 'c'.repeat(32) } })
        const draft = buildDdnsRecordDraft(
            ddnsSettings([target]),
            { ...ddnsRecordEditorValues(target), proxied: false, enabled: false },
            [],
            target,
        )
        expect(draft.targets[0]).toEqual({ ...target, proxied: false, enabled: false })
        expect(activeDdnsTarget(draft, draft.targets[0]!)).toBe(false)
    })
    test('changing a hostname replaces its identity and resets approval instead of reusing a provider record ID', () => {
        const target = ddnsTarget({ selection: { mode: 'adopt', recordId: 'c'.repeat(32) } })
        const values = {
            ...ddnsRecordEditorValues(target),
            domains: [{ id: 'first', value: 'new.example.com' }],
        }
        const draft = buildDdnsRecordDraft(
            ddnsSettings([target]),
            values,
            [DDNS_CONNECTION],
            target,
        )
        expect(draft.targets[0]!.id).not.toBe(target.id)
        expect(draft.targets[0]!.selection).toEqual({ mode: 'inspect' })
    })
    test('rejects mixed-input duplicates and out-of-zone names before submitting any change', () => {
        const values = {
            ...ddnsRecordEditorValues(null),
            connectionId: DDNS_CONNECTION.id,
            domains: [
                { id: 'first', value: 'example.com' },
                { id: 'second', value: 'example.com' },
            ],
        }
        expect(() => buildDdnsRecordDraft(ddnsDraft(), values, [DDNS_CONNECTION], null)).toThrow(
            'duplicate',
        )
        expect(() =>
            buildDdnsRecordDraft(
                ddnsDraft(),
                { ...values, zoneId: 'b'.repeat(32), domains: values.domains.slice(0, 1) },
                [DDNS_CONNECTION],
                null,
            ),
        ).toThrow('zone')
    })
    test('old persisted targets default to enabled; selected families remain an independent gate', () => {
        const { enabled: _enabled, ...legacy } = ddnsTarget()
        expect(ddnsTargetSchema.parse(legacy).enabled).toBe(true)
        const draft = ddnsSettings([ddnsTarget({ recordType: 'AAAA' })])
        expect(activeDdnsTarget(draft, draft.targets[0]!)).toBe(false)
    })
})
