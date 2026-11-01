import { describe, expect, test } from 'bun:test'
import {
    chmod,
    link,
    lstat,
    mkdtemp,
    opendir,
    readFile,
    readdir,
    rm,
    unlink,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    cleanupOffHostTemporaryFiles,
    createOffHostBackupService,
} from '../../../../../../docker/production/backups/off-host.ts'
import { recoveryKeyId } from '../../../../../../scripts/backup/offhost/envelope.ts'
import { createManagedBackupEngine } from '../../../../../../scripts/backup/managed-jobs.ts'
import type { ManagedBackupDependencies } from '../../../../../../scripts/backup/Types/managed-jobs.types.ts'
import type {
    ManagedBackupJob,
    ManagedBackupState,
} from '../../../../lib/Backups/Types/backups.types.ts'

type Dependencies = NonNullable<Parameters<typeof createOffHostBackupService>[0]>
type State = Parameters<Dependencies['write']>[0]
const recoveryKey = Buffer.alloc(32, 22).toString('base64')
const applicationKey = Buffer.alloc(32, 11)
const digest = 'a'.repeat(64)

function fixture() {
    let sequence = 10
    let saved: State | null = null
    let writes = 0
    const id = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
    const puts: string[] = []
    const gets: string[] = []
    const removed: string[] = []
    const filesRemoved: string[] = []
    const dependencies: Dependencies = {
        read: async () => structuredClone(saved),
        write: async (value) => {
            saved = structuredClone(value)
            writes++
        },
        wrappingKey: async () => Buffer.from(applicationKey),
        storage: () => ({
            put: async (key) => {
                puts.push(key)
            },
            get: async (key) => {
                gets.push(key)
            },
            remove: async (key) => {
                removed.push(key)
            },
        }),
        validateTarget: async (target) => target,
        encrypt: async (_input, _output, key) => ({
            bytes: 123,
            sha256: digest,
            keyId: recoveryKeyId(key),
        }),
        hash: async () => ({ bytes: 123, sha256: digest }),
        removeFile: async (path) => {
            filesRemoved.push(path)
        },
        artifacts: '/synthetic/artifacts',
        temporary: '/synthetic/temporary',
        now: () => 1234,
        id,
    }
    const config = (expectedRevision = 0) => ({
        requestId: id(),
        actorId: id(),
        expectedRevision,
        enabled: true,
        endpoint: 'https://s3.example.test',
        region: 'eu-test-1',
        bucket: 'backups',
        prefix: 'production',
        accessKeyId: 'fixture-access-key',
        secretAccessKey: 'fixture-secret-access-key',
        recoveryKey,
        recoveryKeySaved: true,
    })
    const job = (): ManagedBackupJob => ({
        id: id(),
        requestId: id(),
        origin: 'manual',
        actorId: id(),
        scheduledFor: null,
        state: 'succeeded',
        requestedAt: 0,
        startedAt: 0,
        finishedAt: 1,
        durationMs: 1,
        error: null,
        retained: true,
        source: { imageId: null, revision: null, version: 'fixture', buildSha256: digest },
        artifact: { id: id(), metadataSha256: digest, bytes: 100 },
    })
    return {
        dependencies,
        id,
        config,
        job,
        puts,
        gets,
        removed,
        filesRemoved,
        persisted: () => saved!,
        writes: () => writes,
    }
}

async function configure(
    service: Awaited<ReturnType<typeof createOffHostBackupService>>,
    input: unknown,
) {
    const status = await service.configure(input)
    const pending = await service.pendingConfigurationAudit()
    if (pending) await service.acknowledgeConfigurationAudit(pending)
    return status
}

function managedFixture(
    f: ReturnType<typeof fixture>,
    service: Awaited<ReturnType<typeof createOffHostBackupService>>,
) {
    let saved: ManagedBackupState | null = null
    const dependencies: ManagedBackupDependencies = {
        read: async () => structuredClone(saved),
        write: async (state) => {
            saved = structuredClone(state)
        },
        now: () => 1234,
        id: f.id,
        source: () => f.job().source,
        execute: async (job) => ({ id: job.id, metadataSha256: digest, bytes: 100 }),
        verify: async () => true,
        remove: async () => {},
        offHostAudit: {
            pending: service.pendingConfigurationAudit,
            acknowledge: service.acknowledgeConfigurationAudit,
        },
    }
    return { dependencies, persisted: () => saved! }
}

describe('off-host backup service', () => {
    test('wraps credentials and recovery key at rest and exposes only public status', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const configuration = f.config()
        await configure(service, configuration)
        const persisted = JSON.stringify(f.persisted())
        const publicStatus = JSON.stringify(service.status())
        for (const secret of [
            configuration.accessKeyId,
            configuration.secretAccessKey,
            configuration.recoveryKey,
            applicationKey.toString('base64'),
        ]) {
            expect(persisted).not.toContain(secret)
            expect(publicStatus).not.toContain(secret)
        }
        expect(f.persisted().sealed?.ciphertext.length).toBeGreaterThan(50)
        const restarted = await createOffHostBackupService(f.dependencies)
        await restarted.upload(f.job(), 1)
        expect(f.puts).toHaveLength(1)
    })

    test('replays an identical request without another write and fences stale or changed requests', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const configuration = f.config()
        const status = await configure(service, configuration)
        const writes = f.writes()
        expect(await configure(service, configuration)).toEqual(status)
        expect(f.writes()).toBe(writes)
        await expect(
            service.configure({ ...configuration, prefix: 'changed' }),
        ).rejects.toMatchObject({ code: 'revision_conflict' })
        await expect(service.configure(f.config())).rejects.toMatchObject({
            code: 'revision_conflict',
        })
    })

    test('requires a separately saved recovery key and rejects application-key reuse', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        await expect(service.configure({ ...f.config(), recoveryKeySaved: false })).rejects.toThrow(
            'saved',
        )
        await expect(
            service.configure({ ...f.config(), recoveryKey: applicationKey.toString('base64') }),
        ).rejects.toThrow('independent')
        expect(f.writes()).toBe(0)
    })

    test('concurrent configuration updates cannot both consume the same expected revision', async () => {
        const f = fixture()
        const gate = Promise.withResolvers<void>()
        f.dependencies.validateTarget = async (target) => {
            await gate.promise
            return target
        }
        const service = await createOffHostBackupService(f.dependencies)
        const first = service.configure(f.config())
        const second = service.configure({ ...f.config(), prefix: 'different-target' })
        gate.resolve()
        const results = await Promise.allSettled([first, second])
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({
            reason: { code: 'revision_conflict' },
        })
        expect(service.status().revision).toBe(1)
        expect(f.persisted().requests).toHaveLength(1)
    })

    test('rotates target and recovery-key namespaces while preserving copies belonging to older targets', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        const first = await service.upload(f.job(), 1)
        await configure(service, { ...f.config(1), bucket: 'other-backups' })
        const second = await service.upload(f.job(), 1)
        await configure(service, {
            ...f.config(2),
            bucket: 'other-backups',
            recoveryKey: Buffer.alloc(32, 33).toString('base64'),
        })
        const third = await service.upload(f.job(), 1)
        expect(new Set([first?.targetId, second?.targetId, third?.targetId]).size).toBe(3)
        expect(first?.keyId).toBe(second?.keyId)
        expect(third?.keyId).not.toBe(second?.keyId)
        expect(f.removed).toEqual([])
        expect(f.persisted().receipts).toHaveLength(3)
        expect(service.status().retainedCopies).toBe(1)
    })

    test('disables offline without unwrapping old secrets and full-secret replacement recovers after key loss', async () => {
        const f = fixture()
        let service = await createOffHostBackupService(f.dependencies)
        const original = f.config()
        await configure(service, original)
        f.dependencies.wrappingKey = async () => {
            throw new Error('lost wrapping key')
        }
        f.dependencies.validateTarget = async () => {
            throw new Error('offline')
        }
        service = await createOffHostBackupService(f.dependencies)
        const {
            accessKeyId: _access,
            secretAccessKey: _secret,
            recoveryKey: _recovery,
            recoveryKeySaved: _saved,
            ...publicConfig
        } = original
        expect(
            (
                await configure(service, {
                    ...publicConfig,
                    requestId: f.id(),
                    expectedRevision: 1,
                    enabled: false,
                })
            ).enabled,
        ).toBe(false)
        expect(await service.upload(f.job(), 1)).toBeNull()
        expect(f.puts).toEqual([])
        f.dependencies.wrappingKey = async () => Buffer.alloc(32, 44)
        f.dependencies.validateTarget = async (target) => target
        await configure(service, f.config(2))
        expect(await service.upload(f.job(), 1)).not.toBeNull()
    })

    test.each(['hash', 'network', 'credentials'] as const)(
        'preserves old copies after %s verification failure',
        async (failure) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            await configure(service, f.config())
            const original = await service.upload(f.job(), 1)
            if (failure === 'hash')
                f.dependencies.hash = async () => ({ bytes: 123, sha256: 'b'.repeat(64) })
            else
                f.dependencies.storage = () => ({
                    put: async () => {
                        if (failure === 'credentials') throw new Error('OFFHOST_S3_AUTH')
                    },
                    get: async () => {
                        throw new Error('OFFHOST_S3_TRANSPORT')
                    },
                    remove: async () => {
                        throw new Error('must not delete')
                    },
                })
            await expect(service.upload(f.job(), 1)).rejects.toThrow()
            expect(f.persisted().receipts).toEqual([original!])
            expect(f.removed).toEqual([])
            expect(f.filesRemoved).toHaveLength(4)
        },
    )

    test('readback verification precedes replacement deletion and removes exact owned receipts only', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        const first = await service.upload(f.job(), 1)
        const originalHash = f.dependencies.hash
        f.dependencies.hash = async (...args) => {
            expect(f.removed).toEqual([])
            return originalHash(...args)
        }
        const second = await service.upload(f.job(), 1)
        expect(f.removed).toEqual([first!.objectKey])
        expect(f.persisted().receipts).toEqual([second!])
        expect(f.gets).toEqual(f.puts)
        expect(f.puts.every((key) => key.startsWith(service.status().targetId + '/'))).toBe(true)
    })

    test('refuses capacity overflow without uploading or deleting and pause stops replication', async () => {
        const f = fixture()
        let service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        const receipt = await service.upload(f.job(), 100)
        f.persisted().receipts = Array.from({ length: 100 }, (_, index) => ({
            ...receipt!,
            objectKey: receipt!.targetId + '/' + index + '.rpbk',
        }))
        service = await createOffHostBackupService(f.dependencies)
        const storage = f.dependencies.storage
        f.dependencies.storage = (...args) => ({
            ...storage(...args),
            remove: async () => {
                throw new Error('provider delete outage')
            },
        })
        await expect(service.upload(f.job(), 1)).rejects.toThrow('capacity')
        expect(f.puts).toHaveLength(1)
        expect(f.removed).toEqual([])
        expect(f.persisted().receipts).toHaveLength(100)
        f.dependencies.storage = storage
        await service.upload(f.job(), 1)
        expect(f.puts).toHaveLength(2)
        expect(f.persisted().receipts).toHaveLength(1)
        expect(f.removed).toHaveLength(100)
        await service.pause()
        expect(service.status().enabled).toBe(false)
        expect(service.status().revision).toBe(2)
        expect(await service.upload(f.job(), 1)).toBeNull()
    })

    test('reclaims obsolete ledger references at capacity without deleting old target objects', async () => {
        const f = fixture()
        let service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        const receipt = await service.upload(f.job(), 1)
        f.persisted().receipts = Array.from({ length: 100 }, (_, index) => ({
            ...receipt!,
            objectKey: receipt!.targetId + '/' + index + '.rpbk',
        }))
        service = await createOffHostBackupService(f.dependencies)
        await configure(service, { ...f.config(1), bucket: 'rotated-target' })
        const uploaded = await service.upload(f.job(), 1)
        expect(f.removed).toEqual([])
        expect(f.persisted().receipts).toHaveLength(100)
        expect(
            f.persisted().receipts.filter((entry) => entry.targetId === receipt!.targetId),
        ).toHaveLength(99)
        expect(uploaded?.targetId).not.toBe(receipt!.targetId)
        expect(service.status().retainedCopies).toBe(1)
    })

    test('capacity recovery cannot prune anything until an existing copy passes full readback verification', async () => {
        const f = fixture()
        let service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        const receipt = await service.upload(f.job(), 1)
        f.persisted().receipts = Array.from({ length: 100 }, (_, index) => ({
            ...receipt!,
            objectKey: receipt!.targetId + '/' + index + '.rpbk',
        }))
        f.dependencies.hash = async () => ({ bytes: 123, sha256: 'b'.repeat(64) })
        service = await createOffHostBackupService(f.dependencies)
        await expect(service.upload(f.job(), 1)).rejects.toThrow('capacity')
        expect(f.puts).toHaveLength(1)
        expect(f.removed).toEqual([])
        expect(f.persisted().receipts).toHaveLength(100)
    })

    test('reads the latest retention policy after readback and before each deletion', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        await configure(service, f.config())
        await service.upload(f.job(), 100)
        await service.upload(f.job(), 100)
        let keep = 1
        const hash = f.dependencies.hash
        f.dependencies.hash = async (...args) => {
            keep = 3
            return hash(...args)
        }
        await service.upload(f.job(), () => keep)
        expect(f.removed).toEqual([])
        expect(f.persisted().receipts).toHaveLength(3)
        f.dependencies.hash = hash
        const storage = f.dependencies.storage
        f.dependencies.storage = (...args) => ({
            ...storage(...args),
            remove: async (key) => {
                f.removed.push(key)
                keep = 3
            },
        })
        keep = 1
        await service.upload(f.job(), () => keep)
        expect(f.removed).toHaveLength(1)
        expect(f.persisted().receipts).toHaveLength(3)
    })
})

describe('durable off-host configuration audit outbox', () => {
    test('a failed target write has no audit and leaves no pending change', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const m = managedFixture(f, service)
        const engine = await createManagedBackupEngine(m.dependencies)
        f.dependencies.write = async () => {
            throw new Error('target write failed')
        }
        await expect(
            engine.configureOffHost(async () => {
                await service.configure(f.config())
            }),
        ).rejects.toThrow('target write failed')
        expect(service.status().revision).toBe(0)
        expect(await service.pendingConfigurationAudit()).toBeNull()
        expect((await engine.status()).auditEvents).toEqual([])
        expect((await engine.start({ requestId: f.id(), actorId: f.id() })).state).toBe('queued')
    })

    test.each([true, false])(
        'restart repairs target success followed by failed audit persistence (enabled: %s)',
        async (enabled) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            const m = managedFixture(f, service)
            let engine = await createManagedBackupEngine(m.dependencies)
            const initial = f.config()
            await engine.configureOffHost(async () => {
                await service.configure(initial)
            })
            const {
                accessKeyId: _access,
                secretAccessKey: _secret,
                recoveryKey: _key,
                recoveryKeySaved: _saved,
                ...publicConfiguration
            } = initial
            const request = {
                ...publicConfiguration,
                requestId: f.id(),
                expectedRevision: 1,
                enabled,
            }
            const write = m.dependencies.write
            m.dependencies.write = async () => {
                throw new Error('audit write failed')
            }
            await expect(
                engine.configureOffHost(async () => {
                    await service.configure(request)
                }),
            ).rejects.toThrow('audit write failed')
            expect(service.status()).toMatchObject({ enabled, revision: 2 })
            const pending = await service.pendingConfigurationAudit()
            expect(pending).toMatchObject({
                requestId: request.requestId,
                actorId: request.actorId,
            })
            expect(Object.keys(pending!).toSorted()).toEqual([
                'actorId',
                'fingerprint',
                'requestId',
            ])
            expect((await engine.status()).auditEvents).toHaveLength(1)
            await expect(
                engine.start({ requestId: f.id(), actorId: f.id() }),
            ).rejects.toMatchObject({ code: 'busy' })
            await expect(
                engine.updateConfiguration({
                    requestId: f.id(),
                    actorId: f.id(),
                    expectedRevision: 0,
                    enabled: false,
                    intervalHours: 1,
                    retentionCount: 1,
                }),
            ).rejects.toMatchObject({ code: 'busy' })
            await engine.tick()
            expect((await engine.status()).jobs).toEqual([])
            await expect(
                service.configure({ ...request, requestId: f.id(), expectedRevision: 2 }),
            ).rejects.toMatchObject({ code: 'busy' })
            for (const secret of [
                initial.accessKeyId,
                initial.secretAccessKey,
                initial.recoveryKey,
            ])
                expect(JSON.stringify(m.persisted())).not.toContain(secret)
            m.dependencies.write = write
            engine = await createManagedBackupEngine(m.dependencies)
            expect((await engine.status()).auditEvents).toHaveLength(2)
            expect(
                m.persisted().offHostConfigurationAudits?.map((entry) => entry.requestId),
            ).toEqual([initial.requestId, request.requestId])
            expect(await service.pendingConfigurationAudit()).toBeNull()
            await engine.configureOffHost(async () => {
                await service.configure(request)
            })
            expect((await engine.status()).auditEvents).toHaveLength(2)
        },
    )

    test('a target rename followed by failed fsync reloads its authoritative configuration and outbox', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const m = managedFixture(f, service)
        const engine = await createManagedBackupEngine(m.dependencies)
        const write = f.dependencies.write
        let first = true
        f.dependencies.write = async (state) => {
            await write(state)
            if (first) {
                first = false
                throw new Error('directory fsync failed after rename')
            }
        }
        const request = f.config()
        await expect(
            engine.configureOffHost(async () => {
                await service.configure(request)
            }),
        ).rejects.toThrow('directory fsync failed after rename')
        expect(service.status()).toMatchObject({ enabled: true, revision: 1 })
        expect((await engine.status()).auditEvents).toMatchObject([
            { kind: 'off_host_configuration_updated', actorId: request.actorId },
        ])
        expect(await service.pendingConfigurationAudit()).toBeNull()
        await engine.configureOffHost(async () => {
            await service.configure(request)
        })
        expect((await engine.status()).auditEvents).toHaveLength(1)
    })

    test('an unreadable authoritative target after a partial commit fences work until recovery can prove the change', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const m = managedFixture(f, service)
        const engine = await createManagedBackupEngine(m.dependencies)
        const write = f.dependencies.write
        const read = f.dependencies.read
        let unavailable = false
        f.dependencies.read = async () => {
            if (unavailable) throw new Error('target authority temporarily unreadable')
            return read()
        }
        f.dependencies.write = async (state) => {
            await write(state)
            unavailable = true
            throw new Error('target fsync failed after rename')
        }
        const request = f.config()
        await expect(
            engine.configureOffHost(async () => {
                await service.configure(request)
            }),
        ).rejects.toThrow('target authority temporarily unreadable')
        expect(f.persisted().configuration.revision).toBe(1)
        expect(f.persisted().pendingAudit?.requestId).toBe(request.requestId)
        expect((await engine.status()).auditEvents).toEqual([])
        await expect(engine.start({ requestId: f.id(), actorId: f.id() })).rejects.toMatchObject({
            code: 'busy',
        })
        unavailable = false
        f.dependencies.write = write
        await engine.tick()
        expect(service.status().revision).toBe(1)
        expect((await engine.status()).auditEvents).toHaveLength(1)
        expect(await service.pendingConfigurationAudit()).toBeNull()
        await engine.configureOffHost(async () => {
            await service.configure(request)
        })
        expect((await engine.status()).auditEvents).toHaveLength(1)
    })

    test.each(['actor', 'payload'] as const)(
        'a changed %s cannot reuse an audited request id or produce another audit',
        async (changed) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            const m = managedFixture(f, service)
            const engine = await createManagedBackupEngine(m.dependencies)
            const request = f.config()
            await engine.configureOffHost(async () => {
                await service.configure(request)
            })
            const forged =
                changed === 'actor'
                    ? { ...request, actorId: f.id() }
                    : { ...request, prefix: 'other-target' }
            await expect(
                engine.configureOffHost(async () => {
                    await service.configure(forged)
                }),
            ).rejects.toMatchObject({ code: 'revision_conflict' })
            expect((await engine.status()).auditEvents).toHaveLength(1)
            expect(m.persisted().offHostConfigurationAudits).toHaveLength(1)
            expect(service.status().revision).toBe(1)
            expect(await service.pendingConfigurationAudit()).toBeNull()
        },
    )

    test.each(['before', 'after'] as const)(
        'managed audit write failure %s rename reloads authority and never duplicates the event',
        async (phase) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            const m = managedFixture(f, service)
            const engine = await createManagedBackupEngine(m.dependencies)
            const write = m.dependencies.write
            let first = true
            m.dependencies.write = async (state) => {
                if (first && state.offHostConfigurationAudits?.length) {
                    first = false
                    if (phase === 'after') await write(state)
                    throw new Error('managed audit fsync failed')
                }
                await write(state)
            }
            const request = f.config()
            await expect(
                engine.configureOffHost(async () => {
                    await service.configure(request)
                }),
            ).rejects.toThrow('managed audit fsync failed')
            expect((await engine.status()).auditEvents).toHaveLength(phase === 'after' ? 1 : 0)
            await engine.tick()
            expect((await engine.status()).auditEvents).toHaveLength(1)
            expect(await service.pendingConfigurationAudit()).toBeNull()
            const restarted = await createManagedBackupEngine(m.dependencies)
            expect((await restarted.status()).auditEvents).toHaveLength(1)
        },
    )

    test.each(['before', 'after'] as const)(
        'source ACK failure %s rename survives restart and request replay exactly once',
        async (phase) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            const m = managedFixture(f, service)
            let engine = await createManagedBackupEngine(m.dependencies)
            const write = f.dependencies.write
            f.dependencies.write = async (state) => {
                if (f.persisted()?.pendingAudit && !state.pendingAudit) {
                    if (phase === 'after') await write(state)
                    throw new Error('source ack failed')
                }
                await write(state)
            }
            const request = f.config()
            await expect(
                engine.configureOffHost(async () => {
                    await service.configure(request)
                }),
            ).rejects.toThrow('source ack failed')
            const recorded = await engine.status()
            expect(recorded.auditEvents).toHaveLength(1)
            await engine.acknowledgeAudit({
                storeId: recorded.storeId,
                sequence: recorded.auditEvents[0]!.sequence,
            })
            expect((await engine.status()).auditEvents).toEqual([])
            f.dependencies.write = write
            engine = await createManagedBackupEngine(m.dependencies)
            await engine.configureOffHost(async () => {
                await service.configure(request)
            })
            expect((await engine.status()).auditEvents).toEqual([])
            expect(m.persisted().offHostConfigurationAudits).toHaveLength(1)
            expect(await service.pendingConfigurationAudit()).toBeNull()
        },
    )

    test.each(['actorId', 'fingerprint'] as const)(
        'mismatched managed %s receipt cannot forge an audit or acknowledge the source',
        async (field) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            const m = managedFixture(f, service)
            await createManagedBackupEngine(m.dependencies)
            const request = f.config()
            await service.configure(request)
            const pending = (await service.pendingConfigurationAudit())!
            m.persisted().offHostConfigurationAudits = [
                { ...pending, [field]: field === 'actorId' ? f.id() : 'b'.repeat(64) },
            ]
            const engine = await createManagedBackupEngine(m.dependencies)
            expect((await engine.status()).auditEvents).toEqual([])
            expect(await service.pendingConfigurationAudit()).toEqual(pending)
            await expect(
                engine.start({ requestId: f.id(), actorId: f.id() }),
            ).rejects.toMatchObject({ code: 'busy' })
            await expect(
                service.acknowledgeConfigurationAudit({
                    ...pending,
                    [field]: field === 'actorId' ? f.id() : 'b'.repeat(64),
                }),
            ).rejects.toMatchObject({ code: 'revision_conflict' })
        },
    )

    test('a full audit journal keeps startup/status/ACK available and drains the pending change after capacity is freed', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const m = managedFixture(f, service)
        await createManagedBackupEngine(m.dependencies)
        m.persisted().auditEvents = Array.from({ length: 600 }, (_, index) => ({
            sequence: index + 1,
            kind: 'configuration_updated',
            jobId: null,
            actorId: null,
            at: 0,
        }))
        let engine = await createManagedBackupEngine(m.dependencies)
        let applied = false
        await expect(
            engine.configureOffHost(async () => {
                applied = true
            }),
        ).rejects.toMatchObject({ code: 'capacity' })
        expect(applied).toBe(false)
        await service.configure(f.config())
        engine = await createManagedBackupEngine(m.dependencies)
        const status = await engine.status()
        expect(status.auditEvents).toHaveLength(600)
        expect(await service.pendingConfigurationAudit()).not.toBeNull()
        await expect(engine.start({ requestId: f.id(), actorId: f.id() })).rejects.toMatchObject({
            code: 'busy',
        })
        await engine.acknowledgeAudit({ storeId: status.storeId, sequence: 600 })
        expect((await engine.status()).auditEvents).toMatchObject([
            { sequence: 601, kind: 'off_host_configuration_updated' },
        ])
        expect(await service.pendingConfigurationAudit()).toBeNull()
        expect((await engine.start({ requestId: f.id(), actorId: f.id() })).state).toBe('queued')
    })

    test('a slow configuration keeps status and audit ACK responsive while fencing concurrent backup mutations', async () => {
        const f = fixture()
        const entered = Promise.withResolvers<void>()
        const finish = Promise.withResolvers<void>()
        f.dependencies.validateTarget = async (target) => {
            entered.resolve()
            await finish.promise
            return target
        }
        const service = await createOffHostBackupService(f.dependencies)
        const m = managedFixture(f, service)
        const engine = await createManagedBackupEngine(m.dependencies)
        const saving = engine.configureOffHost(async () => {
            await service.configure(f.config())
        })
        await entered.promise
        const status = await engine.status()
        expect(status.jobs).toEqual([])
        await engine.acknowledgeAudit({ storeId: status.storeId, sequence: 0 })
        await expect(engine.start({ requestId: f.id(), actorId: f.id() })).rejects.toMatchObject({
            code: 'busy',
        })
        await expect(engine.acquireDownload()).rejects.toMatchObject({ code: 'busy' })
        await expect(engine.configureOffHost(async () => {})).rejects.toMatchObject({
            code: 'busy',
        })
        await expect(
            engine.requestMaintenance(
                f.id(),
                { requestId: f.id(), actorId: f.id(), metadataSha256: null },
                'delete',
            ),
        ).rejects.toMatchObject({ code: 'busy' })
        await engine.tick()
        finish.resolve()
        await saving
        expect((await engine.status()).auditEvents).toHaveLength(1)
        expect((await engine.start({ requestId: f.id(), actorId: f.id() })).state).toBe('queued')
    })
})

describe('off-host crash temporary cleanup', () => {
    test.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0)(
        'removes crashed download hardlink names while preserving an unrelated inode name',
        async () => {
            const root = await mkdtemp(join(tmpdir(), 'rentner-offhost-linked-cleanup-'))
            const id = '00000000-0000-4000-8000-000000000001'
            const partial = '00000000-0000-4000-8000-000000000002'
            const unrelated = join(root, 'keep-original')
            try {
                await chmod(root, 0o700)
                await writeFile(unrelated, 'preserved cipher data', { mode: 0o600 })
                await link(unrelated, join(root, '.off-host-' + id + '.verify'))
                await link(
                    unrelated,
                    join(root, '.off-host-' + id + '.verify.' + partial + '.partial'),
                )
                await cleanupOffHostTemporaryFiles(root)
                expect(await readdir(root)).toEqual(['keep-original'])
                expect(await readFile(unrelated, 'utf8')).toBe('preserved cipher data')
                expect((await lstat(unrelated)).nlink).toBe(1)
            } finally {
                await rm(root, { recursive: true, force: true })
            }
        },
    )
    test('removes only exact owned private regular crash remnants and preserves unrelated or unsafe entries', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rentner-offhost-cleanup-'))
        const id = '00000000-0000-4000-8000-000000000001'
        const partial = '00000000-0000-4000-8000-000000000002'
        const linked = '.off-host-00000000-0000-4000-8000-000000000006'
        const removable = [
            '.off-host-' + id,
            '.off-host-' + id + '.verify',
            '.off-host-' + id + '.' + partial + '.partial',
            '.off-host-' + id + '.verify.' + partial + '.partial',
            linked,
        ]
        const foreign = '.off-host-00000000-0000-4000-8000-000000000003'
        const publicFile = '.off-host-00000000-0000-4000-8000-000000000004'
        const symbolic = '.off-host-00000000-0000-4000-8000-000000000005'
        const retained = [
            'off-host.json',
            '.off-host-not-a-uuid',
            '.off-host-' + id + '.other',
            '.off-host-' + id + '.verify.unrelated.partial',
            foreign,
            publicFile,
            symbolic,
        ]
        try {
            await Promise.all(
                [...removable, ...retained].map((name) =>
                    writeFile(join(root, name), 'synthetic crash data'),
                ),
            )
            await cleanupOffHostTemporaryFiles(root, {
                inspect: async (path) => {
                    const info = await lstat(path)
                    return Object.assign(info, {
                        uid: path === join(root, foreign) ? 123 : 0,
                        mode:
                            (info.mode & ~0o777) |
                            (path === root
                                ? 0o700
                                : path === join(root, publicFile)
                                  ? 0o644
                                  : 0o600),
                        nlink: path === join(root, linked) ? 2 : 1,
                        isSymbolicLink: () => path === join(root, symbolic),
                    })
                },
                directory: opendir,
                remove: unlink,
            })
            expect((await readdir(root)).toSorted()).toEqual(retained.toSorted())
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    test('refuses an unsafe root before scanning it', async () => {
        let scanned = false
        await expect(
            cleanupOffHostTemporaryFiles('/synthetic/private', {
                inspect: async () => Object.assign(await lstat(import.meta.filename), { uid: 123 }),
                directory: async (path) => {
                    scanned = true
                    return opendir(path)
                },
                remove: unlink,
            }),
        ).rejects.toThrow('unsafe')
        expect(scanned).toBe(false)
    })

    test('caps the directory scan even when all entries have unrelated names', async () => {
        let scanned = 0
        const directory = {
            async *[Symbol.asyncIterator]() {
                for (let index = 0; index < 10_002; index++) {
                    scanned++
                    yield { name: 'unrelated-' + index }
                }
            },
        } as unknown as Awaited<ReturnType<typeof opendir>>
        await expect(
            cleanupOffHostTemporaryFiles('/synthetic/private', {
                inspect: async () =>
                    Object.assign(await lstat(tmpdir()), { uid: 0, mode: 0o40700 }),
                directory: async () => directory,
                remove: async () => {
                    throw new Error('unrelated entry must survive')
                },
            }),
        ).rejects.toThrow('scan capacity')
        expect(scanned).toBe(10_001)
    })
})
