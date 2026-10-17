import { describe, expect, test } from 'bun:test'
import { editableDdnsRecordDraft, withDdnsRecordFamilies } from '@/lib/Ddns/recordFamilies.ts'
import { ddnsSettings, ddnsTarget } from '@/tests/Helpers/ddnsFixture.ts'

describe('record-owned DDNS address families', () => {
    test('activating an AAAA record enables IPv6 without a second global switch', () => {
        const draft = ddnsSettings([ddnsTarget({ recordType: 'AAAA' })])
        expect(draft.ipv6).toBe(false)
        expect(withDdnsRecordFamilies(draft)).toMatchObject({ ipv4: false, ipv6: true })
    })

    test('legacy global pauses become per-record pauses without enabling other records', () => {
        const original = ddnsSettings([
            ddnsTarget(),
            ddnsTarget({ id: '0198d98a-0000-7000-8000-000000000004', recordType: 'AAAA' }),
            ddnsTarget({
                id: '0198d98a-0000-7000-8000-000000000005',
                name: 'paused.example.com',
                enabled: false,
            }),
        ])
        const editable = editableDdnsRecordDraft(original)
        expect(editable.targets.map((target) => target.enabled)).toEqual([true, false, false])
        expect(original.targets[1]!.enabled).toBe(true)
        const reenabled = withDdnsRecordFamilies({
            ...editable,
            targets: editable.targets.map((target, index) =>
                index === 1 ? Object.assign({}, target, { enabled: true }) : target,
            ),
        })
        expect(reenabled).toMatchObject({ ipv4: true, ipv6: true })
        expect(reenabled.targets[2]!.enabled).toBe(false)
    })

    test('only enabled record types require discovery; all paused records require neither family', () => {
        const draft = ddnsSettings([ddnsTarget({ enabled: false })])
        expect(withDdnsRecordFamilies(draft)).toMatchObject({ ipv4: false, ipv6: false })
        expect(withDdnsRecordFamilies({ ...draft, targets: [] })).toMatchObject({
            ipv4: false,
            ipv6: false,
        })
    })
})
