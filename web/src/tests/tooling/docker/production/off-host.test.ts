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
import type { ManagedBackupJob } from '../../../../lib/Backups/Types/backups.types.ts'

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

describe('off-host backup service', () => {
    test('wraps credentials and recovery key at rest and exposes only public status', async () => {
        const f = fixture()
        const service = await createOffHostBackupService(f.dependencies)
        const configuration = f.config()
        await service.configure(configuration)
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
        const status = await service.configure(configuration)
        const writes = f.writes()
        expect(await service.configure(configuration)).toEqual(status)
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
        await service.configure(f.config())
        const first = await service.upload(f.job(), 1)
        await service.configure({ ...f.config(1), bucket: 'other-backups' })
        const second = await service.upload(f.job(), 1)
        await service.configure({
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
        await service.configure(original)
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
                await service.configure({
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
        await service.configure(f.config(2))
        expect(await service.upload(f.job(), 1)).not.toBeNull()
    })

    test.each(['hash', 'network', 'credentials'] as const)(
        'preserves old copies after %s verification failure',
        async (failure) => {
            const f = fixture()
            const service = await createOffHostBackupService(f.dependencies)
            await service.configure(f.config())
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
        await service.configure(f.config())
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
        await service.configure(f.config())
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
        await service.configure(f.config())
        const receipt = await service.upload(f.job(), 1)
        f.persisted().receipts = Array.from({ length: 100 }, (_, index) => ({
            ...receipt!,
            objectKey: receipt!.targetId + '/' + index + '.rpbk',
        }))
        service = await createOffHostBackupService(f.dependencies)
        await service.configure({ ...f.config(1), bucket: 'rotated-target' })
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
        await service.configure(f.config())
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
        await service.configure(f.config())
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
