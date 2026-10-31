/* eslint-disable no-await-in-loop -- Each backup must finish before the next admission. */
import { describe, expect, test } from 'bun:test'
import {
    createManagedBackupEngine,
    ManagedBackupError,
} from '../../../../../../scripts/backup/managed-jobs.ts'
import type { ManagedBackupDependencies } from '../../../../../../scripts/backup/Types/managed-jobs.types.ts'
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
        }
        const status = await engine.status()
        expect(status.jobs).toHaveLength(100)
        expect(status.jobs.filter((job) => job.retained)).toHaveLength(1)
        expect(f.removed).toHaveLength(119)
        expect(status.auditEvents).toHaveLength(500)
        expect(f.read().configurationRequests).toHaveLength(100)
        expect(status.auditEvents.at(-1)!.sequence).toBeGreaterThan(500)
    })
})
