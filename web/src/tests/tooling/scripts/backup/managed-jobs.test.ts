/* eslint-disable no-await-in-loop -- Each backup must finish before the next admission. */
import { describe, expect, test } from 'bun:test'
import {
    createManagedBackupEngine,
    ManagedBackupError,
} from '../../../../../../scripts/backup/managed-jobs.ts'
import type { ManagedBackupDependencies } from '../../../../../../scripts/backup/Types/managed-jobs.types.ts'
import { BACKUP_AUDIT_POLICY } from '../../../../config/backups.config.ts'
import type { ManagedBackupState } from '../../../../lib/Backups/Types/backups.types.ts'
import {
    managedBackupConfigurationUpdateSchema,
    managedBackupStartSchema,
} from '../../../../lib/Backups/validation.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const digest = 'a'.repeat(64)
function fixture() {
    let counter = 10
    let now = 0
    let saved: ManagedBackupState | null = null
    const removed: string[] = []
    const id = () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`
    const dependencies: ManagedBackupDependencies = {
        read: async () => structuredClone(saved),
        write: async (state) => {
            saved = structuredClone(state)
        },
        now: () => now,
        id,
        source: () => ({
            imageId: null,
            revision: null,
            version: 'development',
            buildSha256: digest,
        }),
        execute: async () => ({ id: id(), metadataSha256: digest, bytes: 100 }),
        verify: async () => true,
        remove: async (job) => {
            removed.push(job.id)
        },
    }
    return {
        dependencies,
        id,
        removed,
        read: () => saved!,
        setNow: (value: number) => {
            now = value
        },
        request: () => ({ requestId: id(), actorId }),
        config: (expectedRevision = 0) => ({
            requestId: id(),
            actorId,
            expectedRevision,
            enabled: true,
            intervalHours: 1,
            retentionCount: 1,
        }),
    }
}

function gate() {
    const { promise, resolve } = Promise.withResolvers<void>()
    return { promise, release: resolve }
}

async function responsive<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error('control request waited for retention IO')),
                    500,
                )
            }),
        ])
    } finally {
        clearTimeout(timer)
    }
}

describe('durable bounded managed backup engine', () => {
    test('strict contracts reject paths, extra options, and invalid numeric values', () => {
        const fixtureState = fixture()
        expect(
            managedBackupStartSchema.safeParse({ ...fixtureState.request(), path: '/tmp' }).success,
        ).toBe(false)
        expect(
            managedBackupConfigurationUpdateSchema.safeParse({
                ...fixtureState.config(),
                intervalHours: 1.5,
            }).success,
        ).toBe(false)
        expect(
            managedBackupConfigurationUpdateSchema.safeParse({
                ...fixtureState.config(),
                retentionCount: 51,
            }).success,
        ).toBe(false)
    })

    test('concurrent admissions persist once and request replay returns immutable source snapshot', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        const request = f.request()
        const [first, repeated] = await Promise.all([engine.start(request), engine.start(request)])
        expect(first).toEqual(repeated)
        expect(f.read().jobs).toHaveLength(1)
        await expect(engine.start(f.request())).rejects.toMatchObject({ code: 'busy' })
        f.dependencies.source = () => ({
            imageId: null,
            revision: null,
            version: 'changed',
            buildSha256: digest,
        })
        expect((await engine.start(request)).source.version).toBe('development')
    })

    test('failed durable write does not admit an in-memory job', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        const write = f.dependencies.write
        f.dependencies.write = async () => {
            throw new Error('disk unavailable')
        }
        await expect(engine.start(f.request())).rejects.toThrow('disk unavailable')
        expect((await engine.status()).jobs).toEqual([])
        f.dependencies.write = write
        expect((await engine.start(f.request())).state).toBe('queued')
    })

    test('configuration uses CAS, replay receipts, and preserves schedule for retention-only changes', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        const request = f.config()
        const first = await engine.updateConfiguration(request)
        expect(await engine.updateConfiguration(request)).toEqual(first)
        f.setNow(100)
        const second = await engine.updateConfiguration({ ...f.config(1), retentionCount: 2 })
        expect(second.nextRunAt).toBe(first.nextRunAt)
        await expect(engine.updateConfiguration(f.config(0))).rejects.toMatchObject({
            code: 'revision_conflict',
        })
    })

    test('coalesces missed intervals and gives queued manual work priority', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        const manual = await engine.start(f.request())
        f.setNow(10 * 3600000 + 100)
        await engine.tick()
        expect((await engine.status()).jobs[0]?.id).toBe(manual.id)
        await engine.tick()
        const status = await engine.status()
        expect(status.jobs).toHaveLength(2)
        expect(status.jobs[1]).toMatchObject({
            origin: 'schedule',
            scheduledFor: 3600000,
            state: 'succeeded',
        })
        expect(status.configuration.nextRunAt).toBe(11 * 3600000)
        await engine.tick()
        expect((await engine.status()).jobs).toHaveLength(2)
    })

    test('concurrent ticks execute once while status and configuration remain available', async () => {
        const f = fixture()
        const entered = gate()
        const finish = gate()
        let executions = 0
        f.dependencies.execute = async () => {
            executions++
            entered.release()
            await finish.promise
            return { id: f.id(), metadataSha256: digest, bytes: 100 }
        }
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.start(f.request())
        const running = engine.tick()
        await entered.promise
        await engine.tick()
        expect((await engine.status()).jobs[0]?.state).toBe('running')
        await engine.updateConfiguration(f.config())
        expect(executions).toBe(1)
        finish.release()
        await running
        expect((await engine.status()).jobs[0]?.state).toBe('succeeded')
    })

    test.each(['verify', 'remove'] as const)(
        'blocked retention %s keeps status/config/ACK responsive and rejects new work without delayed admission',
        async (phase) => {
            const f = fixture()
            const engine = await createManagedBackupEngine(f.dependencies)
            await engine.updateConfiguration(f.config())
            const old = await engine.start(f.request())
            await engine.tick()
            const entered = gate()
            const finish = gate()
            let verifications = 0
            f.dependencies.verify = async () => {
                if (++verifications === 2 && phase === 'verify') {
                    entered.release()
                    await finish.promise
                }
                return true
            }
            f.dependencies.remove = async (job) => {
                if (phase === 'remove') {
                    entered.release()
                    await finish.promise
                }
                f.removed.push(job.id)
            }
            const request = f.request()
            const replacement = await engine.start(request)
            const running = engine.tick()
            const rejected = f.request()
            try {
                await responsive(entered.promise)
                const completed = await responsive(engine.status())
                expect(completed.jobs.find((job) => job.id === replacement.id)?.state).toBe(
                    'succeeded',
                )
                expect(f.read().jobs.find((job) => job.id === replacement.id)?.state).toBe(
                    'succeeded',
                )
                await expect(responsive(engine.start(rejected))).rejects.toMatchObject({
                    code: 'busy',
                })
                expect((await responsive(engine.start(request))).id).toBe(replacement.id)
                await expect(
                    responsive(engine.start({ ...request, actorId: f.id() })),
                ).rejects.toMatchObject({ code: 'revision_conflict' })
                await responsive(engine.tick())
                const acknowledgement = completed.auditEvents.at(-1)!.sequence
                await responsive(
                    engine.acknowledgeAudit({
                        storeId: completed.storeId,
                        sequence: acknowledgement,
                    }),
                )
                const configuration = await responsive(
                    engine.updateConfiguration({
                        ...f.config(1),
                        enabled: false,
                        intervalHours: 2,
                        retentionCount: 2,
                    }),
                )
                const during = await responsive(engine.status())
                expect(during.configuration).toEqual(configuration)
                expect(during.auditEvents.map((event) => event.kind)).toEqual([
                    'configuration_updated',
                ])
                finish.release()
                await running
                const after = await engine.status()
                expect(after.configuration).toEqual(configuration)
                expect(f.read().auditAcknowledged).toBe(acknowledgement)
                expect(after.auditEvents.every((event) => event.sequence > acknowledgement)).toBe(
                    true,
                )
                expect(after.auditEvents.map((event) => event.kind)).toEqual(
                    phase === 'verify'
                        ? ['configuration_updated']
                        : ['configuration_updated', 'pruned'],
                )
                expect(f.removed).toEqual(phase === 'verify' ? [] : [old.id])
                expect(
                    after.jobs.find((job) => job.requestId === rejected.requestId),
                ).toBeUndefined()
                expect((await engine.start(rejected)).state).toBe('queued')
            } finally {
                finish.release()
                await running
            }
        },
    )

    test('the first pruned commit retains the verified replacement before later slow IO', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration({ ...f.config(), retentionCount: 50 })
        for (let index = 0; index < 50; index++) {
            await engine.start(f.request())
            await engine.tick()
        }
        await engine.updateConfiguration(f.config(1))
        const entered = gate()
        const finish = gate()
        let verifications = 0
        f.dependencies.verify = async () => {
            if (++verifications === 3) {
                entered.release()
                await finish.promise
            }
            return true
        }
        const replacement = await engine.start(f.request())
        const running = engine.tick()
        try {
            await responsive(entered.promise)
            const during = await responsive(engine.status())
            expect(during.jobs.find((job) => job.id === replacement.id)?.retained).toBe(true)
            expect(during.jobs.filter((job) => job.retained)).toHaveLength(50)
            expect(during.auditEvents.filter((event) => event.kind === 'pruned')).toHaveLength(1)
            expect(f.removed).toHaveLength(1)
            await responsive(engine.updateConfiguration({ ...f.config(2), retentionCount: 50 }))
            finish.release()
            await running
            expect(f.removed).toHaveLength(1)
            expect((await engine.status()).jobs.filter((job) => job.retained)).toHaveLength(50)
        } finally {
            finish.release()
            await running
        }
    })

    test('busy retention still rejects a scheduled request key replayed as manual work', async () => {
        const f = fixture()
        let engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        const old = await engine.start(f.request())
        await engine.tick()
        const stored = f.read().jobs.find((job) => job.id === old.id)!
        stored.origin = 'schedule'
        stored.actorId = null
        engine = await createManagedBackupEngine(f.dependencies)
        const entered = gate()
        const finish = gate()
        f.dependencies.remove = async () => {
            entered.release()
            await finish.promise
        }
        await engine.start(f.request())
        const running = engine.tick()
        try {
            await responsive(entered.promise)
            await expect(
                responsive(engine.start({ requestId: old.requestId, actorId })),
            ).rejects.toMatchObject({ code: 'revision_conflict' })
        } finally {
            finish.release()
            await running
        }
    })

    test('a failed pruned commit confirms no deletion audit and restart resumes idempotent retention safely', async () => {
        const f = fixture()
        const physical = new Set<string>()
        f.dependencies.execute = async (job) => {
            physical.add(job.id)
            return { id: job.id, metadataSha256: digest, bytes: 100 }
        }
        f.dependencies.verify = async (job) => physical.has(job.id)
        f.dependencies.remove = async (job) => {
            physical.delete(job.id)
        }
        let engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        const old = await engine.start(f.request())
        await engine.tick()
        const replacement = await engine.start(f.request())
        const write = f.dependencies.write
        f.dependencies.write = async (draft) => {
            if (draft.auditEvents.at(-1)?.kind === 'pruned') throw new Error('pruned commit failed')
            await write(draft)
        }
        await expect(engine.tick()).rejects.toThrow('pruned commit failed')
        expect(physical.has(old.id)).toBe(false)
        expect(physical.has(replacement.id)).toBe(true)
        expect(f.read().jobs.find((job) => job.id === old.id)?.retained).toBe(true)
        expect(f.read().auditEvents.some((event) => event.kind === 'pruned')).toBe(false)
        expect(f.read().jobs.find((job) => job.id === replacement.id)?.state).toBe('succeeded')
        f.dependencies.write = write
        engine = await createManagedBackupEngine(f.dependencies)
        const next = await engine.start(f.request())
        await engine.tick()
        expect([...physical]).toEqual([next.id])
        const after = await engine.status()
        expect(after.jobs.filter((job) => job.retained).map((job) => job.id)).toEqual([next.id])
        expect(
            after.auditEvents
                .filter((event) => event.kind === 'pruned')
                .map((event) => event.jobId),
        ).toEqual([old.id, replacement.id])
    })

    test('restart interrupts a persisted running job and preserves published artifact without success promotion', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.start(f.request())
        const saved = f.read()
        saved.jobs[0]!.state = 'running'
        saved.jobs[0]!.startedAt = 0
        saved.jobs[0]!.artifact = { id: f.id(), metadataSha256: digest, bytes: 100 }
        f.setNow(100)
        const restarted = await createManagedBackupEngine(f.dependencies)
        expect((await restarted.status()).jobs[0]).toMatchObject({
            state: 'interrupted',
            error: 'interrupted',
            durationMs: 100,
            retained: false,
        })
        expect((await restarted.status()).jobs[0]?.artifact).not.toBeNull()
        expect(f.removed).toEqual([])
        expect((await restarted.status()).storeId).toBe(saved.storeId)
    })

    test('execution and recovery failures never prune retained recovery points or expose exception text', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        await engine.start(f.request())
        await engine.tick()
        for (const failure of [
            new Error('private secret'),
            new ManagedBackupError('recovery_failed'),
        ]) {
            f.dependencies.execute = async () => {
                throw failure
            }
            await engine.start(f.request())
            await engine.tick()
        }
        expect(f.removed).toEqual([])
        expect((await engine.status()).jobs.map((job) => job.error)).toEqual([
            null,
            'execution_failed',
            'recovery_failed',
        ])
        expect(JSON.stringify(await engine.status())).not.toContain('private secret')
    })

    test('revalidates replacement immediately before retention and preserves old point if it becomes corrupt', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        await engine.start(f.request())
        await engine.tick()
        let verifications = 0
        f.dependencies.verify = async () => ++verifications === 1
        await engine.start(f.request())
        await engine.tick()
        expect(f.removed).toEqual([])
        expect((await engine.status()).jobs[0]?.retained).toBe(true)
    })

    test('retention verification errors preserve old points and do not strand the engine', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        await engine.start(f.request())
        await engine.tick()
        let calls = 0
        f.dependencies.verify = async () => {
            if (++calls > 1) throw new Error('verification IO failure')
            return true
        }
        await engine.start(f.request())
        await engine.tick()
        expect(f.removed).toEqual([])
        expect((await engine.status()).jobs.every((job) => job.state === 'succeeded')).toBe(true)
        expect((await engine.start(f.request())).state).toBe('queued')
    })

    test('fifty retained points roll over safely without exceeding the hard cap', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration({ ...f.config(), retentionCount: 50 })
        for (let index = 0; index < 51; index++) {
            await engine.start(f.request())
            await engine.tick()
        }
        expect((await engine.status()).jobs.filter((job) => job.retained)).toHaveLength(50)
        expect(f.removed).toHaveLength(1)
    })
    test('failed pruning and later execution failures cannot discard the latest verified ownership record', async () => {
        const f = fixture()
        f.dependencies.execute = async (job) => ({
            id: job.id,
            metadataSha256: digest,
            bytes: 100,
        })
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration({ ...f.config(), retentionCount: 50 })
        for (let index = 0; index < 50; index++) {
            await engine.start(f.request())
            await engine.tick()
        }
        f.dependencies.remove = async () => {
            throw new Error('old artifact removal unavailable')
        }
        const replacement = await engine.start(f.request())
        await engine.tick()
        expect((await engine.status()).jobs.find((job) => job.id === replacement.id)).toMatchObject(
            {
                state: 'succeeded',
                retained: false,
                artifact: { id: replacement.id },
            },
        )
        f.dependencies.execute = async () => {
            throw new Error('capture unavailable')
        }
        for (let index = 0; index < 110; index++) {
            await engine.start(f.request())
            await engine.tick()
        }
        const restarted = await createManagedBackupEngine(f.dependencies)
        const status = await restarted.status()
        expect(status.jobs).toHaveLength(100)
        expect(status.jobs.filter((job) => job.retained)).toHaveLength(50)
        expect(status.jobs.find((job) => job.id === replacement.id)).toMatchObject({
            state: 'succeeded',
            retained: false,
            artifact: { id: replacement.id },
        })
        expect(f.removed).toEqual([])
    })
    test('idle ticks and identical request replays do not rewrite durable state', async () => {
        const f = fixture()
        const write = f.dependencies.write
        let writes = 0
        f.dependencies.write = async (state) => {
            writes++
            await write(state)
        }
        const engine = await createManagedBackupEngine(f.dependencies)
        expect(writes).toBe(1)
        await engine.tick()
        await engine.tick()
        expect(writes).toBe(1)
        const request = f.request()
        await engine.start(request)
        expect(writes).toBe(2)
        await engine.start(request)
        expect(writes).toBe(2)
    })

    test('rejects idempotency keys reused by another actor or changed configuration', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        const request = f.request()
        await engine.start(request)
        await expect(engine.start({ ...request, actorId: f.id() })).rejects.toMatchObject({
            code: 'revision_conflict',
        })
        const config = f.config()
        await engine.updateConfiguration(config)
        await expect(
            engine.updateConfiguration({ ...config, retentionCount: 2 }),
        ).rejects.toMatchObject({ code: 'revision_conflict' })
        await expect(
            engine.updateConfiguration({ ...config, actorId: f.id() }),
        ).rejects.toMatchObject({ code: 'revision_conflict' })
    })

    test('completion persistence failure prevents all retention deletion', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        const old = await engine.start(f.request())
        await engine.tick()
        const replacement = await engine.start(f.request())
        const write = f.dependencies.write
        f.dependencies.write = async (state) => {
            if (state.jobs.find((job) => job.id === replacement.id)?.state === 'succeeded')
                throw new Error('durability failed')
            await write(state)
        }
        await expect(engine.tick()).rejects.toThrow('durability failed')
        expect(f.removed).toEqual([])
        expect(f.read().jobs.find((job) => job.id === old.id)?.retained).toBe(true)
        expect(f.read().jobs.find((job) => job.id === replacement.id)?.state).toBe('running')
    })
    test('successful retention removes only older successes and bounds records, receipts, and audit events', async () => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.updateConfiguration(f.config())
        for (let index = 0; index < 120; index++) {
            await engine.start(f.request())
            await engine.tick()
            await engine.updateConfiguration({ ...f.config(index + 1), enabled: false })
            const batch = await engine.status()
            await engine.acknowledgeAudit({
                storeId: batch.storeId,
                sequence: batch.auditEvents.at(-1)!.sequence,
            })
        }
        const status = await engine.status()
        expect(status.jobs).toHaveLength(100)
        expect(status.jobs.filter((job) => job.retained)).toHaveLength(1)
        expect(f.removed).toHaveLength(119)
        expect(status.auditEvents).toHaveLength(0)
        expect(f.read().configurationRequests).toHaveLength(100)
        expect(f.read().auditAcknowledged).toBeGreaterThan(500)
    })
})

test('an ingestion outage preserves more than 500 events and backpressures admission across restart until durable acknowledgement', async () => {
    const f = fixture()
    let engine = await createManagedBackupEngine(f.dependencies)
    await engine.updateConfiguration(f.config())
    let completed = 0
    for (let index = 0; index < 200; index++) {
        try {
            await engine.start(f.request())
        } catch (error) {
            expect(error).toMatchObject({ code: 'capacity' })
            break
        }
        await engine.tick()
        completed++
    }
    expect(completed).toBeGreaterThan(120)
    const before = await engine.status()
    expect(before.auditEvents.length).toBeGreaterThan(500)
    expect(before.auditEvents.length).toBeLessThanOrEqual(BACKUP_AUDIT_POLICY.capacity)
    expect(before.auditEvents.map((event) => event.sequence)).toEqual(
        Array.from({ length: before.auditEvents.length }, (_, index) => index + 1),
    )
    engine = await createManagedBackupEngine(f.dependencies)
    await expect(engine.start(f.request())).rejects.toMatchObject({ code: 'capacity' })
    f.setNow(3_600_000)
    await engine.tick()
    expect(await engine.status()).toEqual(before)
    await expect(engine.acknowledgeAudit({ storeId: f.id(), sequence: 1 })).rejects.toMatchObject({
        code: 'revision_conflict',
    })
    await expect(
        engine.acknowledgeAudit({ storeId: before.storeId, sequence: 10_000 }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await engine.acknowledgeAudit({ storeId: before.storeId, sequence: 100 })
    await engine.acknowledgeAudit({ storeId: before.storeId, sequence: 90 })
    expect((await engine.status()).auditEvents).toEqual(before.auditEvents.slice(100))
    const last = before.auditEvents.at(-1)!.sequence
    await engine.acknowledgeAudit({ storeId: before.storeId, sequence: last })
    engine = await createManagedBackupEngine(f.dependencies)
    expect((await engine.status()).auditEvents).toEqual([])
    expect(f.read().auditAcknowledged).toBe(last)
    await engine.tick()
    const resumed = await engine.status()
    expect(resumed.auditEvents[0]?.sequence).toBe(last + 1)
    expect(resumed.jobs.at(-1)?.state).toBe('succeeded')
})

test('accepted work reserves the entire worst-case retention lifecycle while configuration admission is backpressured', async () => {
    const f = fixture()
    const engine = await createManagedBackupEngine(f.dependencies)
    await engine.updateConfiguration({ ...f.config(), retentionCount: 50 })
    for (let index = 0; index < 50; index++) {
        await engine.start(f.request())
        await engine.tick()
    }
    let revision = 1
    while (
        (await engine.status()).auditEvents.length <
        BACKUP_AUDIT_POLICY.capacity - BACKUP_AUDIT_POLICY.jobEvents - 1
    ) {
        await engine.updateConfiguration({ ...f.config(revision++), retentionCount: 50 })
    }
    await engine.updateConfiguration({ ...f.config(revision++), retentionCount: 1 })
    const before = await engine.status()
    await engine.start(f.request())
    await expect(engine.updateConfiguration(f.config(revision))).rejects.toMatchObject({
        code: 'capacity',
    })
    const write = f.dependencies.write
    let concurrentStart: Promise<unknown> | undefined
    let concurrentConfig: Promise<unknown> | undefined
    f.dependencies.write = async (state) => {
        await write(state)
        if (state.auditEvents.at(-1)?.kind === 'succeeded') {
            // Queue mutations at the persisted-success boundary, ahead of pruning.
            concurrentStart = engine.start(f.request()).catch((error: unknown) => error)
            concurrentConfig = engine
                .updateConfiguration(f.config(revision))
                .catch((error: unknown) => error)
        }
    }
    await engine.tick()
    expect(await concurrentStart).toMatchObject({ code: 'busy' })
    expect(await concurrentConfig).toMatchObject({ code: 'capacity' })
    const after = await engine.status()
    expect(after.jobs.at(-1)?.state).toBe('succeeded')
    expect(after.jobs.filter((job) => job.retained)).toHaveLength(1)
    expect(f.removed).toHaveLength(50)
    expect(after.auditEvents).toHaveLength(BACKUP_AUDIT_POLICY.capacity)
    expect(after.auditEvents.slice(0, before.auditEvents.length)).toEqual(before.auditEvents)
})

test.each(['queued', 'running'] as const)(
    'legacy 500-event journals can recover %s work without truncation',
    async (state) => {
        const f = fixture()
        const engine = await createManagedBackupEngine(f.dependencies)
        await engine.start(f.request())
        const legacy = structuredClone(f.read())
        delete legacy.auditAcknowledged
        legacy.jobs[0]!.state = state
        legacy.auditEvents = Array.from({ length: 500 }, (_, index) => ({
            sequence: index + 1,
            kind: 'configuration_updated' as const,
            jobId: null,
            actorId: null,
            at: 0,
        }))
        f.dependencies.read = async () => legacy
        const recovered = await createManagedBackupEngine(f.dependencies)
        await recovered.tick()
        const status = await recovered.status()
        expect(status.auditEvents.slice(0, 500)).toEqual(legacy.auditEvents)
        expect(status.auditEvents.length).toBeGreaterThan(500)
        expect(status.jobs[0]?.state).toBe(state === 'queued' ? 'succeeded' : 'interrupted')
    },
)

test('failed acknowledgement persistence cannot release the retained producer prefix', async () => {
    const f = fixture()
    const engine = await createManagedBackupEngine(f.dependencies)
    await engine.start(f.request())
    const before = await engine.status()
    const write = f.dependencies.write
    f.dependencies.write = async () => {
        throw new Error('ack write unavailable')
    }
    await expect(engine.acknowledgeAudit({ storeId: before.storeId, sequence: 1 })).rejects.toThrow(
        'ack write unavailable',
    )
    expect(await engine.status()).toEqual(before)
    f.dependencies.write = write
    await engine.acknowledgeAudit({ storeId: before.storeId, sequence: 1 })
    expect((await engine.status()).auditEvents).toEqual([])
})
