import { describe, expect, spyOn, test } from 'bun:test'
import { createDdnsDemoApi } from '@/features/Admin/Ddns/Development/ddns-demo.ts'
import { ddnsSnapshotSchema } from '@/lib/Ddns/validation.ts'

describe('isolated development DDNS data', () => {
    test('representative paginated records and connections satisfy the real boundary schema', async () => {
        const api = createDdnsDemoApi()
        const value = await api.status()
        expect(ddnsSnapshotSchema.safeParse(value).success).toBe(true)
        expect(value.targets).toHaveLength(12)
        expect(
            value.configuration!.settings.targets.some((target) => target.recordType === 'AAAA'),
        ).toBe(true)
        expect(value.configuration!.settings.targets.some((target) => !target.enabled)).toBe(true)
        expect(value.configuration!.settings.targets.some((target) => !target.proxied)).toBe(true)
        expect(value.targets.some((target) => target.permanentFailure)).toBe(true)
        expect(value.targets.some((target) => target.lastResult?.status === 'updated')).toBe(true)
        expect(await api.connections()).toHaveLength(2)
        value.configuration!.settings.targets.length = 0
        expect((await api.status()).targets).toHaveLength(12)
    })

    test('CRUD, pause and manual updates stay in memory with independent sessions', async () => {
        const network = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('No network in a demo'),
        )
        try {
            const api = createDdnsDemoApi()
            const independent = createDdnsDemoApi()
            const before = await api.status()
            const draft = before.configuration!.settings
            const result = await api.apply({
                expectedRevision: 1,
                enabled: true,
                draft: {
                    intervalSeconds: draft.intervalSeconds,
                    updateOnStart: draft.updateOnStart,
                    ipv4: draft.ipv4,
                    ipv6: draft.ipv6,
                    targets: draft.targets.slice(1),
                },
            })
            expect(result.success).toBe(true)
            expect((await api.status()).targets).toHaveLength(11)
            expect((await independent.status()).targets).toHaveLength(12)
            expect((await api.sync({ expectedRevision: 2 })).success).toBe(true)
            expect((await api.disable({ expectedRevision: 2 })).success).toBe(true)
            expect((await api.status()).configuration!.settings.enabled).toBe(false)
            expect(
                (await api.status()).targets.every((target) => target.nextAttemptAt === null),
            ).toBe(true)
            expect((await api.sync({ expectedRevision: 3 })).success).toBe(false)
            expect(ddnsSnapshotSchema.safeParse(await api.status()).success).toBe(true)
            expect(network).not.toHaveBeenCalled()
        } finally {
            network.mockRestore()
        }
    })

    test('revision conflicts and invalid domains cannot mutate the current session', async () => {
        const api = createDdnsDemoApi()
        const before = await api.status()
        const saved = before.configuration!.settings
        const draft = {
            intervalSeconds: saved.intervalSeconds,
            updateOnStart: saved.updateOnStart,
            ipv4: saved.ipv4,
            ipv6: saved.ipv6,
            targets: saved.targets,
        }
        expect(await api.apply({ expectedRevision: 9, enabled: true, draft })).toMatchObject({
            success: false,
            message: 'admin.ddns.errors.conflict',
        })
        const rejected = await Promise.all(
            ['outside.example.net', 'example.com.evil.test', 'notexample.com'].map(async (name) =>
                api.apply({
                    expectedRevision: 1,
                    enabled: true,
                    draft: {
                        ...draft,
                        targets: [{ ...draft.targets[0]!, name }],
                    },
                }),
            ),
        )
        expect(rejected.map((result) => result.success)).toEqual([false, false, false])
        expect(await api.status()).toEqual(before)
    })
})
