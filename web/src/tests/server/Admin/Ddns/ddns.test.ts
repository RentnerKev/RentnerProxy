// oxlint-disable no-await-in-loop -- Verify each permission failure and altered receipt independently.
// oxlint-disable no-map-spread -- Provider fixtures must not mutate the source batch.
import { describe, expect, mock, spyOn, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { createDdnsService } from '@/server/Admin/Ddns/ddns.service.ts'
import { createDdnsReceiptService } from '@/server/Admin/Ddns/ddns-preview.service.ts'
import { DdnsDomainError } from '@/server/Admin/Ddns/ddns.errors.ts'
import type { DdnsDependencies } from '@/server/Admin/Ddns/Types/ddns.types.ts'
import {
    DDNS_ACTOR,
    DDNS_CONNECTION,
    ddnsBatch,
    ddnsSettings,
    ddnsSnapshot,
    ddnsTarget,
} from '@/tests/Helpers/ddnsFixture.ts'

const approved = ddnsSettings([
    ddnsTarget({ selection: { mode: 'adopt', recordId: 'c'.repeat(32) } }),
])
function setup(
    permissions: readonly PermissionKey[] = [
        PERMISSIONS.DDNS_VIEW,
        PERMISSIONS.DDNS_MANAGE,
        PERMISSIONS.DNS_CONNECTIONS_VIEW,
    ],
) {
    let state = ddnsSnapshot()
    const dependencies: DdnsDependencies = {
        authorize: mock(async (permission) => {
            if (!permissions.includes(permission)) throw new Error('denied')
            return { id: DDNS_ACTOR }
        }),
        controller: {
            status: mock(async () => state),
            preview: mock(async (input) => ddnsBatch(ddnsSettings(input.targets))),
            save: mock(async (input) => {
                state = ddnsSnapshot(
                    input.configuration,
                    input.configuration.enabled,
                    input.expectedRevision + 1,
                )
                return state
            }),
            enable: mock(async (input) => {
                state = ddnsSnapshot(approved, true, input.expectedRevision + 1)
                return state
            }),
            disable: mock(async (input) => {
                state = ddnsSnapshot(approved, false, input.expectedRevision + 1)
                return state
            }),
            sync: mock(async () => ({ ...ddnsBatch(approved), preview: false })),
        },
        connections: mock(async () => [DDNS_CONNECTION]),
        receipt: {
            issue: mock(async () => ({
                receipt: 'fixture-receipt',
                expiresAt: Date.now() + 180000,
            })),
            verify: mock(async () => {}),
        },
        limit: mock(async () => {}),
        audit: mock(async () => {}),
    }
    return {
        dependencies,
        service: createDdnsService(dependencies),
        setState: (next: typeof state) => {
            state = next
        },
    }
}
describe('DDNS web service', () => {
    test('empty reviewed lists can remove all targets without provider calls or activation', async () => {
        const { service, dependencies } = setup()
        const empty = { ...approved, targets: [] }
        const preview = await service.previewDdnsService({
            expectedRevision: 0,
            draft: empty,
            intent: 'save',
        })
        expect(preview.receipt).toBe('fixture-receipt')
        expect(dependencies.controller.preview).not.toHaveBeenCalled()
        await service.saveDdnsService({
            expectedRevision: 0,
            draft: empty,
            receipt: preview.receipt!,
            confirmedPause: false,
        })
        await expect(
            service.enableDdnsService({ expectedRevision: 1, receipt: 'fixture', confirmed: true }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
    })
    test('denies every operation before any controller request', async () => {
        const { service, dependencies } = setup([])
        for (const operation of [
            () => service.applyDdnsService({ expectedRevision: 0, draft: approved, enabled: true }),
            () => service.getDdnsStatusService(),
            () => service.getDdnsConnectionsService(),
            () =>
                service.previewDdnsService({
                    expectedRevision: 0,
                    draft: approved,
                    intent: 'save',
                }),
            () =>
                service.saveDdnsService({
                    expectedRevision: 0,
                    draft: approved,
                    receipt: 'fixture',
                    confirmedPause: false,
                }),
            () =>
                service.enableDdnsService({
                    expectedRevision: 1,
                    receipt: 'fixture',
                    confirmed: true,
                }),
            () => service.disableDdnsService({ expectedRevision: 1 }),
            () => service.syncDdnsService({ expectedRevision: 1 }),
        ])
            await expect(operation()).rejects.toThrow('denied')
        for (const method of Object.values(dependencies.controller))
            expect(method).not.toHaveBeenCalled()
        expect(dependencies.connections).not.toHaveBeenCalled()
    })
    test('read-only users cannot discover new connection metadata or mutate', async () => {
        const { service, dependencies } = setup([PERMISSIONS.DDNS_VIEW])
        expect(await service.getDdnsStatusService()).toEqual(ddnsSnapshot())
        await expect(service.getDdnsConnectionsService()).rejects.toThrow('denied')
        await expect(service.disableDdnsService({ expectedRevision: 1 })).rejects.toThrow('denied')
        expect(dependencies.controller.disable).not.toHaveBeenCalled()
    })
    test('connection choices require DNS view even for a DDNS manager', async () => {
        const { service, dependencies } = setup([PERMISSIONS.DDNS_MANAGE])
        await expect(service.getDdnsConnectionsService()).rejects.toThrow('denied')
        expect(dependencies.connections).not.toHaveBeenCalled()
    })
    test('does not issue a receipt before explicit adoption and fresh preview', async () => {
        const { service, dependencies } = setup()
        expect(
            (
                await service.previewDdnsService({
                    expectedRevision: 0,
                    draft: ddnsSettings(),
                    intent: 'save',
                })
            ).receipt,
        ).toBeNull()
        expect(dependencies.receipt.issue).not.toHaveBeenCalled()
        expect(
            (
                await service.previewDdnsService({
                    expectedRevision: 0,
                    draft: approved,
                    intent: 'save',
                })
            ).receipt,
        ).toBe('fixture-receipt')
        expect(dependencies.controller.save).not.toHaveBeenCalled()
        expect(dependencies.controller.preview).toHaveBeenCalledWith(
            expect.objectContaining({ actorUserId: DDNS_ACTOR }),
        )
    })
    test('saves paused with server actor and verifies the exact receipt', async () => {
        const { service, dependencies } = setup()
        await service.saveDdnsService({
            expectedRevision: 0,
            draft: approved,
            receipt: 'fixture',
            confirmedPause: false,
        })
        expect(dependencies.receipt.verify).toHaveBeenCalledWith(
            DDNS_ACTOR,
            'save',
            0,
            approved,
            'fixture',
        )
        expect(dependencies.controller.save).toHaveBeenCalledWith({
            expectedRevision: 0,
            actorUserId: DDNS_ACTOR,
            configuration: { ...approved, enabled: false },
        })
        expect(dependencies.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'update',
                metadata: { changedFields: ['ddns'] },
                result: 'success',
            }),
        )
        expect(
            JSON.stringify((dependencies.audit as ReturnType<typeof mock>).mock.calls),
        ).not.toContain('receipt')
    })
    test('rejects stale revision and requires confirmation before pausing active settings', async () => {
        const { service, dependencies, setState } = setup()
        setState(ddnsSnapshot(approved, true, 4))
        await expect(
            service.saveDdnsService({
                expectedRevision: 3,
                draft: approved,
                receipt: 'fixture',
                confirmedPause: true,
            }),
        ).rejects.toMatchObject({ code: 'conflict' })
        await expect(
            service.saveDdnsService({
                expectedRevision: 4,
                draft: approved,
                receipt: 'fixture',
                confirmedPause: false,
            }),
        ).rejects.toMatchObject({ code: 'pause_confirmation_required' })
        expect(dependencies.controller.save).not.toHaveBeenCalled()
        await service.saveDdnsService({
            expectedRevision: 4,
            draft: approved,
            receipt: 'fixture',
            confirmedPause: true,
        })
    })
    test('rejects caller actor injection, enabling via save and enable without confirmation', async () => {
        const { service, dependencies } = setup()
        const input = {
            expectedRevision: 0,
            draft: approved,
            receipt: 'fixture',
            confirmedPause: false,
        }
        await expect(
            service.saveDdnsService({ ...input, actorUserId: DDNS_ACTOR } as typeof input),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            service.saveDdnsService({
                ...input,
                draft: { ...approved, enabled: true },
            } as typeof input),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            service.enableDdnsService({
                expectedRevision: 1,
                receipt: 'fixture',
                confirmed: false,
            } as unknown as Parameters<typeof service.enableDdnsService>[0]),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(dependencies.controller.save).not.toHaveBeenCalled()
        expect(dependencies.controller.enable).not.toHaveBeenCalled()
    })
    test('activation preview must equal saved settings and activation is a separate operation', async () => {
        const { service, dependencies, setState } = setup()
        setState(ddnsSnapshot(approved))
        await expect(
            service.previewDdnsService({
                expectedRevision: 1,
                draft: { ...approved, intervalSeconds: 600 },
                intent: 'enable',
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await service.previewDdnsService({ expectedRevision: 1, draft: approved, intent: 'enable' })
        expect(dependencies.controller.enable).not.toHaveBeenCalled()
        await service.enableDdnsService({
            expectedRevision: 1,
            receipt: 'fixture',
            confirmed: true,
        })
        expect(dependencies.receipt.verify).toHaveBeenCalledWith(
            DDNS_ACTOR,
            'enable',
            1,
            approved,
            'fixture',
        )
    })
    test('audit failure does not turn a committed operation into a retry invitation', async () => {
        const { service, dependencies } = setup()
        spyOn(dependencies, 'audit').mockRejectedValue(new Error('unavailable'))
        expect(
            (await service.disableDdnsService({ expectedRevision: 1 })).configuration?.settings
                .enabled,
        ).toBe(false)
    })
    test('unexpected controller errors are redacted', async () => {
        const { service, dependencies } = setup()
        dependencies.controller.sync = mock(async () => {
            throw new Error('private-token-never-return')
        })
        const error = await service
            .syncDdnsService({ expectedRevision: 1 })
            .catch((value: unknown) => value)
        expect(error).toBeInstanceOf(DdnsDomainError)
        expect(JSON.stringify(error)).not.toContain('private-token')
    })
})

describe('automatic DDNS record changes', () => {
    test('inspects and binds existing provider IDs before atomically saving an active list', async () => {
        const { service, dependencies } = setup()
        await service.applyDdnsService({
            expectedRevision: 0,
            draft: ddnsSettings(),
            enabled: true,
        })
        expect(dependencies.controller.preview).toHaveBeenCalledTimes(2)
        expect(dependencies.controller.save).toHaveBeenCalledWith({
            expectedRevision: 0,
            actorUserId: DDNS_ACTOR,
            configuration: { ...approved, enabled: true },
        })
        expect(dependencies.controller.enable).not.toHaveBeenCalled()
        expect(dependencies.receipt.issue).not.toHaveBeenCalled()
        expect(dependencies.limit).toHaveBeenCalledWith(DDNS_ACTOR, true)
    })
    test('ignores browser-provided approval and approves creation only after an absent-record inspection', async () => {
        const { service, dependencies } = setup()
        dependencies.controller.preview = mock(async (input) => {
            const batch = ddnsBatch(ddnsSettings(input.targets))
            return {
                ...batch,
                targets: batch.targets.map((result, index) => ({
                    ...result,
                    current: null,
                    status:
                        input.targets[index]!.selection.mode === 'inspect'
                            ? ('creation_required' as const)
                            : ('would_create' as const),
                    error:
                        input.targets[index]!.selection.mode === 'inspect'
                            ? ('creation_required' as const)
                            : null,
                })),
            }
        })
        const untrusted = ddnsSettings([
            ddnsTarget({ selection: { mode: 'adopt', recordId: 'f'.repeat(32) } }),
        ])
        await service.applyDdnsService({ expectedRevision: 0, draft: untrusted, enabled: true })
        expect(dependencies.controller.preview).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                targets: [expect.objectContaining({ selection: { mode: 'inspect' } })],
            }),
        )
        expect(dependencies.controller.save).toHaveBeenCalledWith(
            expect.objectContaining({
                configuration: expect.objectContaining({
                    targets: [expect.objectContaining({ selection: { mode: 'create' } })],
                }),
            }),
        )
    })
    test('saved provider IDs cannot be replaced by a browser and changed identities require new target IDs', async () => {
        const { service, dependencies, setState } = setup()
        setState(ddnsSnapshot(approved, true))
        await service.applyDdnsService({
            expectedRevision: 1,
            enabled: true,
            draft: ddnsSettings([
                ddnsTarget({ selection: { mode: 'adopt', recordId: 'f'.repeat(32) } }),
            ]),
        })
        expect(dependencies.controller.preview).not.toHaveBeenCalled()
        expect(dependencies.controller.save).toHaveBeenCalledWith(
            expect.objectContaining({ configuration: { ...approved, enabled: true } }),
        )
        await expect(
            service.applyDdnsService({
                expectedRevision: 2,
                enabled: true,
                draft: ddnsSettings([ddnsTarget({ name: 'changed.example.com' })]),
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
    })
    test('provider conflicts and failed inspections never persist a newly expanded live scope', async () => {
        const { service, dependencies } = setup()
        dependencies.controller.preview = mock(async () => ({
            ...ddnsBatch(approved),
            targets: [
                {
                    ...ddnsBatch(approved).targets[0]!,
                    status: 'failed' as const,
                    error: 'record_conflict' as const,
                },
            ],
        }))
        await expect(
            service.applyDdnsService({ expectedRevision: 0, draft: approved, enabled: true }),
        ).rejects.toMatchObject({ code: 'preview_failed', recordError: 'record_conflict' })
        expect(dependencies.controller.save).not.toHaveBeenCalled()
        expect(dependencies.audit).toHaveBeenCalledWith(
            expect.objectContaining({ result: 'failure' }),
        )
    })
    test('disabling or removing records works during provider outages and retains global enable intent', async () => {
        const { service, dependencies, setState } = setup()
        setState(ddnsSnapshot(approved, true))
        dependencies.controller.preview = mock(async () => {
            throw new Error('provider offline')
        })
        await service.applyDdnsService({
            expectedRevision: 1,
            enabled: true,
            draft: ddnsSettings([{ ...approved.targets[0]!, enabled: false }]),
        })
        expect(dependencies.controller.preview).not.toHaveBeenCalled()
        await service.applyDdnsService({
            expectedRevision: 2,
            enabled: false,
            draft: ddnsSettings([]),
        })
        expect(dependencies.controller.preview).not.toHaveBeenCalled()
        expect(dependencies.controller.save).toHaveBeenCalledTimes(2)
    })
    test('reactivation and proxy changes are inspected while interval-only edits need no provider', async () => {
        const { service, dependencies, setState } = setup()
        setState(ddnsSnapshot(approved, true))
        await service.applyDdnsService({
            expectedRevision: 1,
            enabled: true,
            draft: { ...approved, intervalSeconds: 600 },
        })
        expect(dependencies.controller.preview).not.toHaveBeenCalled()
        await service.applyDdnsService({
            expectedRevision: 2,
            enabled: true,
            draft: ddnsSettings([{ ...approved.targets[0]!, proxied: false }]),
        })
        expect(dependencies.controller.preview).toHaveBeenCalledTimes(1)
        setState(ddnsSnapshot(ddnsSettings([{ ...approved.targets[0]!, enabled: false }]), true, 4))
        await service.applyDdnsService({ expectedRevision: 4, enabled: true, draft: approved })
        expect(dependencies.controller.preview).toHaveBeenCalledTimes(2)
    })
    test('rejects stale changes, actor injection and empty first activation before saving', async () => {
        const { service, dependencies } = setup()
        await expect(
            service.applyDdnsService({ expectedRevision: 1, draft: approved, enabled: true }),
        ).rejects.toMatchObject({ code: 'conflict' })
        await expect(
            service.applyDdnsService({
                expectedRevision: 0,
                draft: ddnsSettings([]),
                enabled: true,
            }),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        const input = {
            expectedRevision: 0,
            draft: approved,
            enabled: true,
            actorUserId: DDNS_CONNECTION.id,
        }
        await expect(service.applyDdnsService(input)).rejects.toMatchObject({
            code: 'invalid_input',
        })
        expect(dependencies.controller.save).not.toHaveBeenCalled()
    })
})
describe('authenticated DDNS preview receipts', () => {
    test('binds receipt to actor, operation, exact settings, revision, integrity and expiry', async () => {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
            'encrypt',
            'decrypt',
        ])
        let now = 1_792_200_000_000
        const service = createDdnsReceiptService({
            now: () => now,
            encrypt: async (text, context) => {
                const iv = crypto.getRandomValues(new Uint8Array(12))
                const ciphertext = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
                    key,
                    new TextEncoder().encode(text),
                )
                return { iv, ciphertext: new Uint8Array(ciphertext) }
            },
            decrypt: async (value, context) =>
                new TextDecoder().decode(
                    await crypto.subtle.decrypt(
                        {
                            name: 'AES-GCM',
                            iv: value.iv as Uint8Array<ArrayBuffer>,
                            additionalData: new TextEncoder().encode(context),
                        },
                        key,
                        value.ciphertext as Uint8Array<ArrayBuffer>,
                    ),
                ),
        })
        const { receipt } = await service.issue(DDNS_ACTOR, 'save', 2, approved)
        await service.verify(DDNS_ACTOR, 'save', 2, approved, receipt)
        for (const verify of [
            () => service.verify(DDNS_CONNECTION.id, 'save', 2, approved, receipt),
            () => service.verify(DDNS_ACTOR, 'enable', 2, approved, receipt),
            () => service.verify(DDNS_ACTOR, 'save', 3, approved, receipt),
            () =>
                service.verify(
                    DDNS_ACTOR,
                    'save',
                    2,
                    { ...approved, intervalSeconds: 60 },
                    receipt,
                ),
            () => service.verify(DDNS_ACTOR, 'save', 2, approved, `${receipt.slice(0, -3)}AAA`),
        ])
            await expect(verify()).rejects.toMatchObject({ code: 'preview_required' })
        now += 180000
        await expect(
            service.verify(DDNS_ACTOR, 'save', 2, approved, receipt),
        ).rejects.toMatchObject({ code: 'preview_required' })
    })
})
