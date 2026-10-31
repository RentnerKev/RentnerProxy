// oxlint-disable no-await-in-loop -- Filesystem fixtures assert each ordered cleanup and recovery boundary.
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    createBackupAgentHandler,
    loadManagedBackupState,
    reconcileBackupArtifacts,
    reconcileBackupControl,
    recoverManagedBackupState,
    removeRetainedBackup,
} from '../../../../../../docker/production/backups/agent.ts'
import { createManagedBackupEngine } from '../../../../../../scripts/backup/managed-jobs.ts'
import { verifyPublishedBackup } from '../../../../../../scripts/backup/publication.ts'
import type { ManagedBackupJob } from '../../../../../../web/src/lib/Backups/Types/backups.types.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
async function fixture() {
    let counter = 10
    const engine = await createManagedBackupEngine({
        read: async () => null,
        write: async () => {},
        now: () => 0,
        id: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
        source: () => ({
            imageId: null,
            revision: null,
            version: 'development',
            buildSha256: 'a'.repeat(64),
        }),
        execute: async () => {
            throw new Error('not executed from HTTP')
        },
        verify: async () => false,
        remove: async () => {},
    })
    return { engine, handle: createBackupAgentHandler(engine) }
}
function request(method: string, path: string, body?: unknown) {
    return new Request('http://localhost' + path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
}

describe('private root backup agent routes', () => {
    test('status returns bounded contract and exact route/method allowlist', async () => {
        const { handle } = await fixture()
        expect((await handle(request('GET', '/status'))).status).toBe(200)
        expect((await handle(request('POST', '/status'))).status).toBe(404)
        expect((await handle(request('GET', '/start'))).status).toBe(404)
        expect((await handle(request('POST', '/start/'))).status).toBe(404)
        expect((await handle(request('DELETE', '/config'))).status).toBe(404)
    })

    test('rejects malformed, oversized, unknown-field, and invalid actor requests before admission', async () => {
        const { handle, engine } = await fixture()
        expect(
            (
                await handle(
                    new Request('http://localhost/start', { method: 'POST', body: '{broken' }),
                )
            ).status,
        ).toBe(400)
        expect(
            (await handle(request('POST', '/start', { actorId, requestId, output: '/arbitrary' })))
                .status,
        ).toBe(400)
        expect(
            (await handle(request('POST', '/start', { actorId: 'invalid', requestId }))).status,
        ).toBe(400)
        expect(
            (
                await handle(
                    request('POST', '/start', { actorId, requestId, padding: 'a'.repeat(2048) }),
                )
            ).status,
        ).toBe(400)
        expect((await engine.status()).jobs).toHaveLength(0)
    })

    test('returns durable queued admission, handles replay, and reports busy without executing exports', async () => {
        const { handle } = await fixture()
        const first = await handle(request('POST', '/start', { actorId, requestId }))
        expect(first.status).toBe(200)
        const status = (await first.json()) as { jobs: { state: string }[] }
        expect(status.jobs[0]?.state).toBe('queued')
        expect((await handle(request('POST', '/start', { actorId, requestId }))).status).toBe(200)
        const busy = await handle(
            request('POST', '/start', {
                actorId,
                requestId: '00000000-0000-4000-8000-000000000003',
            }),
        )
        expect(busy.status).toBe(409)
        expect(await busy.json()).toEqual({ error: 'busy' })
    })

    test('validates configuration and maps revision conflict to safe API response', async () => {
        const { handle } = await fixture()
        const config = {
            actorId,
            requestId,
            expectedRevision: 0,
            enabled: true,
            intervalHours: 24,
            retentionCount: 7,
        }
        expect((await handle(request('PUT', '/config', config))).status).toBe(200)
        expect(
            (await handle(request('PUT', '/config', { ...config, retentionCount: 100 }))).status,
        ).toBe(400)
        const conflict = await handle(
            request('PUT', '/config', {
                ...config,
                requestId: '00000000-0000-4000-8000-000000000003',
            }),
        )
        expect(conflict.status).toBe(409)
        expect(await conflict.json()).toEqual({ error: 'conflict' })
    })

    test('startup clears interrupted active work without a result and preserves publication identity', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'interrupted'
        job.error = 'interrupted'
        job.artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const removed: string[] = []
        await reconcileBackupControl([job], 'startup', {
            read: async (path) => (path.endsWith('active.json') ? { id: job.id } : null),
            remove: async (path) => {
                removed.push(path)
            },
        })
        expect(removed).toHaveLength(1)
        expect(removed[0]).toEndWith('active.json')
        expect(job.state).toBe('interrupted')
        expect(job.artifact?.id).toBe(job.id)
    })

    test('runtime cannot remove an active marker without the correlated lifecycle result', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'interrupted'
        const removed: string[] = []
        await expect(
            reconcileBackupControl([job], 'runtime', {
                read: async (path) => (path.endsWith('active.json') ? { id: job.id } : null),
                remove: async (path) => {
                    removed.push(path)
                },
            }),
        ).rejects.toThrow('backup lifecycle incomplete')
        expect(removed).toEqual([])
        await expect(
            reconcileBackupControl([job], 'runtime', {
                read: async (path) =>
                    path.endsWith('active.json')
                        ? { id: job.id }
                        : { id: requestId, success: true },
                remove: async (path) => {
                    removed.push(path)
                },
            }),
        ).rejects.toThrow('backup lifecycle mismatch')
        expect(removed).toEqual([])
    })
    test('already removed canonical retained jobs are idempotent but partial damage is rejected', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'succeeded'
        job.retained = true
        job.artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const touched: string[] = []
        const io = {
            exists: async () => false,
            inspect: async (id: string) => {
                touched.push(id)
                return id
            },
            remove: async (directory: string) => {
                touched.push(directory)
            },
            sync: async () => {
                touched.push('sync')
            },
        }
        await removeRetainedBackup(job, io)
        expect(touched).toEqual([])
        io.exists = async () => true
        io.inspect = async () => {
            throw Object.assign(new Error('missing child'), { code: 'ENOENT' })
        }
        await expect(removeRetainedBackup(job, io)).rejects.toThrow('missing child')
        expect(touched).toEqual([])
    })

    test('startup discovers verified publication identity without promoting interrupted work to success', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        const input = { ...(await engine.status()), version: 1, configurationRequests: [] }
        input.jobs[0]!.state = 'running'
        const artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const recovered = await recoverManagedBackupState(input, async () => artifact)
        expect(recovered.jobs[0]?.artifact).toEqual(artifact)
        expect(recovered.jobs[0]?.state).toBe('running')
        expect(recovered.jobs[0]?.retained).toBe(false)
        expect(input.jobs[0]?.artifact).toBeNull()
        const missing = await recoverManagedBackupState(input, async () => {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        })
        expect(missing.jobs[0]?.artifact).toBeNull()
        const invalid = await recoverManagedBackupState(input, async () => {
            throw new Error('checksum mismatch')
        })
        expect(invalid.jobs[0]?.artifact).toBeNull()
        await expect(
            recoverManagedBackupState(input, async () => {
                throw Object.assign(new Error('IO failed'), { code: 'EIO' })
            }),
        ).rejects.toThrow('IO failed')
    })
    test('startup reconciles graceful-stop recovery failure without a result while runtime refuses it', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'failed'
        job.error = 'recovery_failed'
        job.startedAt = 0
        job.finishedAt = 100
        job.durationMs = 100
        const removed: string[] = []
        const io = {
            read: async (path: string) => (path.endsWith('active.json') ? { id: job.id } : null),
            remove: async (path: string) => {
                removed.push(path)
            },
        }
        await expect(reconcileBackupControl([job], 'runtime', io)).rejects.toThrow(
            'backup lifecycle incomplete',
        )
        expect(removed).toEqual([])
        await reconcileBackupControl([job], 'startup', io)
        expect(removed).toHaveLength(1)
        expect(removed[0]).toEndWith('active.json')
        expect(job).toMatchObject({
            state: 'failed',
            error: 'recovery_failed',
            artifact: null,
            retained: false,
        })
    })
    test('sanitizes internal persistence failures', async () => {
        const { engine } = await fixture()
        engine.start = async () => {
            throw new Error('sensitive internal details')
        }
        const response = await createBackupAgentHandler(engine)(
            request('POST', '/start', { actorId, requestId }),
        )
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ error: 'unavailable' })
    })
})

const rootFilesystem = process.platform === 'linux' && process.getuid?.() === 0
const idFor = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

async function filesystemFixture(run: (root: string, job: ManagedBackupJob) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), 'rentnerproxy-agent-reconcile-'))
    try {
        const { engine } = await fixture()
        await run(root, await engine.start({ actorId, requestId }))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

async function publishedFixture(root: string, job: ManagedBackupJob, staging = false) {
    const directory = join(root, (staging ? '.staging-' : '') + job.id)
    await mkdir(directory, { mode: 0o700 })
    const artifact = { bytes: 12, sha256: 'a'.repeat(64) }
    const metadata = {
        format: 'rentnerproxy-production-backup',
        version: 4,
        createdAt: '2026-10-31T00:00:00.000Z',
        redis: 'excluded',
        applicationEncryptionKey: { ...artifact, file: 'app-encryption-key' },
        postgres: {
            ...artifact,
            database: 'rentnerproxy',
            user: 'rentnerproxy',
            dump: 'postgres.dump',
        },
        controllerState: { ...artifact, archive: 'controller-state.tar' },
        crowdSecState: { ...artifact, archive: 'crowdsec-state.tar' },
        deployment: { publicOrigin: 'https://proxy.example.test', trustedProxyCidrs: '' },
        source: job.source,
    }
    // Deliberately invalid payload hashes model a post-publication verify failure.
    // Ownership inspection must not mistake validity of payloads for provenance.
    for (const name of [
        'app-encryption-key',
        'postgres.dump',
        'controller-state.tar',
        'crowdsec-state.tar',
    ]) {
        await writeFile(join(directory, name), 'synthetic fixture bytes: ' + name, { mode: 0o600 })
    }
    await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata), { mode: 0o600 })
    return directory
}

async function verifiedFixture(root: string, job: ManagedBackupJob) {
    const directory = await publishedFixture(root, job)
    const header = Buffer.alloc(512)
    header.write('./')
    header.write('0000700\0', 100)
    header.write('00000000000\0', 124)
    header.fill(32, 148, 156)
    header[156] = 53
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    const archive = Buffer.concat([header, Buffer.alloc(1024)])
    const metadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'))
    for (const [name, bytes, field] of [
        ['app-encryption-key', Buffer.from('A'.repeat(43) + '=\n'), 'applicationEncryptionKey'],
        ['postgres.dump', Buffer.from('synthetic dump'), 'postgres'],
        ['controller-state.tar', archive, 'controllerState'],
        ['crowdsec-state.tar', archive, 'crowdSecState'],
    ] as const) {
        await writeFile(join(directory, name), bytes)
        metadata[field].bytes = bytes.length
        metadata[field].sha256 = createHash('sha256').update(bytes).digest('hex')
    }
    await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata))
    const verified = await verifyPublishedBackup(directory)
    job.artifact = { id: job.id, metadataSha256: verified.metadataSha256, bytes: verified.bytes }
    return directory
}

describe.skipIf(!rootFilesystem)('root Linux backup publication reconciliation', () => {
    test('reclaims known corrupt failed publications, interrupted and trimmed orphans while preserving retained bytes and history', () =>
        filesystemFixture(async (root, base) => {
            const retained = { ...base, state: 'succeeded' as const, retained: true }
            const failed = { ...base, id: idFor(20), state: 'failed' as const }
            const interrupted = {
                ...base,
                id: idFor(21),
                state: 'interrupted' as const,
                artifact: { id: idFor(21), metadataSha256: 'b'.repeat(64), bytes: 100 },
            }
            const retainedPath = await publishedFixture(root, retained)
            const before = await Promise.all(
                (await readdir(retainedPath)).map(
                    async (name) => [name, await readFile(join(retainedPath, name))] as const,
                ),
            )
            const failedPath = await publishedFixture(root, failed)
            await writeFile(join(failedPath, 'metadata.json'), '{invalid metadata')
            await publishedFixture(root, interrupted)
            // This canonical UUID no longer has a job record after historical trimming.
            await publishedFixture(root, { ...base, id: idFor(22) })
            await publishedFixture(root, failed, true)
            const partial = { ...base, id: idFor(23), state: 'failed' as const }
            const partialPath = join(root, '.staging-' + partial.id)
            await mkdir(partialPath, { mode: 0o700 })
            await writeFile(join(partialPath, 'postgres.dump'), 'partial capture', { mode: 0o600 })
            const partialCanonical = join(root, partial.id)
            await mkdir(partialCanonical, { mode: 0o700 })
            await writeFile(join(partialCanonical, 'postgres.dump'), 'partial old cleanup', {
                mode: 0o600,
            })
            const history = structuredClone([retained, failed, interrupted, partial])
            await reconcileBackupArtifacts(history, root)
            expect(await readdir(root)).toEqual([retained.id])
            expect(history).toEqual([retained, failed, interrupted, partial])
            for (const [name, bytes] of before) {
                expect(await readFile(join(retainedPath, name))).toEqual(bytes)
            }
        }))

    test('preserves the latest verified success while retention is pending and removes only older unretained successes', () =>
        filesystemFixture(async (root, base) => {
            const older = {
                ...base,
                state: 'succeeded' as const,
                artifact: { id: base.id, metadataSha256: 'a'.repeat(64), bytes: 100 },
            }
            const latest = {
                ...older,
                id: idFor(24),
                artifact: { id: idFor(24), metadataSha256: 'b'.repeat(64), bytes: 100 },
            }
            const olderPath = await publishedFixture(root, older)
            await reconcileBackupArtifacts([older], root)
            expect(await readdir(root)).toEqual([older.id])
            const latestPath = await verifiedFixture(root, latest)
            const bytes = await readFile(join(latestPath, 'postgres.dump'))
            await reconcileBackupArtifacts([older, latest], root)
            expect(await readdir(root)).toEqual([latest.id])
            await expect(readFile(join(olderPath, 'postgres.dump'))).rejects.toThrow('ENOENT')
            expect(await readFile(join(latestPath, 'postgres.dump'))).toEqual(bytes)
            expect(latest.retained).toBe(false)
        }))

    test('a corrupted newest success cannot authorize deleting an older successful point', () =>
        filesystemFixture(async (root, base) => {
            const older = {
                ...base,
                state: 'succeeded' as const,
                artifact: { id: base.id, metadataSha256: 'a'.repeat(64), bytes: 100 },
            }
            const latest = {
                ...older,
                id: idFor(25),
                artifact: { id: idFor(25), metadataSha256: 'b'.repeat(64), bytes: 100 },
            }
            const olderPath = await publishedFixture(root, older)
            await verifiedFixture(root, latest)
            await writeFile(join(root, latest.id, 'postgres.dump'), 'corrupted replacement')
            const before = await readFile(join(olderPath, 'postgres.dump'))
            const history = structuredClone([older, latest])
            await reconcileBackupArtifacts(history, root)
            expect((await readdir(root)).toSorted()).toEqual([older.id, latest.id].toSorted())
            expect(await readFile(join(olderPath, 'postgres.dump'))).toEqual(before)
            expect(history).toEqual([older, latest])
        }))

    test.each(['known', 'orphan', 'empty'] as const)(
        'restarts a partially unlinked %s deletion receipt without depending on metadata',
        (kind) =>
            filesystemFixture(async (root, base) => {
                const retained = { ...base, state: 'succeeded' as const, retained: true }
                const retainedPath = await publishedFixture(root, retained)
                const key = await readFile(join(retainedPath, 'app-encryption-key'))
                const failed = { ...base, id: idFor(60), state: 'failed' as const }
                const canonical = await publishedFixture(root, failed)
                const receipt = join(root, '.deleting-' + idFor(900))
                const jobs = kind === 'orphan' ? [retained] : [retained, failed]
                const history = structuredClone(jobs)
                await expect(
                    reconcileBackupArtifacts(jobs, root, {
                        id: () => idFor(900),
                        verifyReplacement: async () => false,
                        remove: async (directory) => {
                            expect(directory).toBe(receipt)
                            await expect(
                                readFile(join(canonical, 'metadata.json')),
                            ).rejects.toThrow('ENOENT')
                            for (const name of kind === 'empty'
                                ? await readdir(directory)
                                : ['metadata.json', 'postgres.dump']) {
                                await rm(join(directory, name))
                            }
                            throw new Error('simulated stop after partial unlink')
                        },
                    }),
                ).rejects.toThrow('simulated stop after partial unlink')
                expect(await readdir(receipt)).toHaveLength(kind === 'empty' ? 0 : 3)
                await reconcileBackupArtifacts(jobs, root)
                expect(await readdir(root)).toEqual([retained.id])
                expect(await readFile(join(retainedPath, 'app-encryption-key'))).toEqual(key)
                expect(jobs).toEqual(history)
            }),
    )

    test('never overwrites an existing deletion receipt', () =>
        filesystemFixture(async (root, base) => {
            const failed = { ...base, state: 'failed' as const }
            const canonical = await publishedFixture(root, failed)
            const receipt = join(root, '.deleting-' + idFor(901))
            await expect(
                reconcileBackupArtifacts([failed], root, {
                    id: () => {
                        // Create the collision after enumeration, before rename.
                        mkdirSync(receipt, { mode: 0o700 })
                        writeFileSync(join(receipt, 'postgres.dump'), 'held receipt', {
                            mode: 0o600,
                        })
                        return idFor(901)
                    },
                    verifyReplacement: async () => false,
                    remove: async () => {
                        throw new Error('colliding receipt must never be removed')
                    },
                }),
            ).rejects.toThrow('backup deletion receipt already exists')
            expect(await readFile(join(receipt, 'postgres.dump'), 'utf8')).toBe('held receipt')
            expect(await readdir(canonical)).toHaveLength(5)
        }))

    test('preserves malformed deletion names and fails closed for foreign or linked receipt contents', () =>
        filesystemFixture(async (root, base) => {
            const retained = { ...base, state: 'succeeded' as const, retained: true }
            const retainedPath = await publishedFixture(root, retained)
            const key = await readFile(join(retainedPath, 'app-encryption-key'))
            const malformed = join(root, '.deleting-not-a-uuid')
            await mkdir(malformed, { mode: 0o700 })
            await writeFile(join(malformed, 'operator-note'), 'foreign data', { mode: 0o600 })
            await reconcileBackupArtifacts([retained], root)
            expect(await readFile(join(malformed, 'operator-note'), 'utf8')).toBe('foreign data')
            const receipt = join(root, '.deleting-' + idFor(902))
            await mkdir(receipt, { mode: 0o700 })
            await writeFile(join(receipt, 'operator-note'), 'foreign data', { mode: 0o600 })
            await expect(reconcileBackupArtifacts([retained], root)).rejects.toThrow(
                'invalid backup entries',
            )
            expect(await readFile(join(receipt, 'operator-note'), 'utf8')).toBe('foreign data')
            await rm(receipt, { recursive: true })
            await symlink(retainedPath, receipt)
            await expect(reconcileBackupArtifacts([retained], root)).rejects.toThrow(
                'invalid backup directory',
            )
            expect(await readFile(join(retainedPath, 'app-encryption-key'))).toEqual(key)
        }))

    test('journal loss in a nonempty store blocks fresh initialization before any state write', () =>
        filesystemFixture(async (root, base) => {
            const canonical = await publishedFixture(root, base)
            const key = await readFile(join(canonical, 'app-encryption-key'))
            let writes = 0
            const dependencies = {
                read: () =>
                    loadManagedBackupState({
                        read: async () =>
                            JSON.parse(await readFile(join(root, 'jobs.json'), 'utf8')),
                        entries: () => readdir(root),
                    }),
                write: async () => {
                    writes += 1
                },
                now: () => 0,
                id: () => requestId,
                source: () => base.source,
                execute: async () => {
                    throw new Error('not executed')
                },
                verify: async () => false,
                remove: async () => {},
            }
            await expect(createManagedBackupEngine(dependencies)).rejects.toThrow(
                'backup journal is missing',
            )
            expect(writes).toBe(0)
            expect(await readFile(join(canonical, 'app-encryption-key'))).toEqual(key)
            await rm(canonical, { recursive: true })
            await createManagedBackupEngine(dependencies)
            expect(writes).toBe(1)
        }))

    test('protects current running and queued directories during live cleanup', () =>
        filesystemFixture(async (root, base) => {
            for (const state of ['running', 'queued'] as const) {
                const job = { ...base, state }
                const canonical = await publishedFixture(root, job)
                const staging = await publishedFixture(root, job, true)
                await reconcileBackupArtifacts([job], root)
                expect((await readdir(root)).toSorted()).toEqual(
                    [job.id, '.staging-' + job.id].toSorted(),
                )
                await rm(canonical, { recursive: true })
                await rm(staging, { recursive: true })
            }
        }))

    test('leaves unrelated names, legacy metadata, unsafe orphan directories and linked files untouched', () =>
        filesystemFixture(async (root, base) => {
            await writeFile(join(root, 'operator-note'), 'foreign data')
            const legacy = await publishedFixture(root, { ...base, id: idFor(30) })
            const metadataPath = join(legacy, 'metadata.json')
            const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
            metadata.source = { imageId: 'sha256:' + 'c'.repeat(64), revision: null, version: null }
            await writeFile(metadataPath, JSON.stringify(metadata))
            const foreign = await publishedFixture(root, { ...base, id: idFor(31) })
            await writeFile(join(foreign, 'operator-note'), 'foreign data')
            await symlink(legacy, join(root, idFor(32)))
            const linked = await publishedFixture(root, { ...base, id: idFor(33) })
            await rm(join(linked, 'postgres.dump'))
            await symlink(join(legacy, 'postgres.dump'), join(linked, 'postgres.dump'))
            const hardlinked = await publishedFixture(root, { ...base, id: idFor(34) })
            await rm(join(hardlinked, 'postgres.dump'))
            await link(join(legacy, 'postgres.dump'), join(hardlinked, 'postgres.dump'))
            const partial = join(root, '.staging-' + idFor(35))
            await mkdir(partial, { mode: 0o700 })
            const before = (await readdir(root)).toSorted()
            await reconcileBackupArtifacts([], root)
            expect((await readdir(root)).toSorted()).toEqual(before)
            expect(await readFile(join(root, 'operator-note'), 'utf8')).toBe('foreign data')
        }))

    test('fails closed for a referenced unsafe terminal directory and bounds root enumeration', () =>
        filesystemFixture(async (root, base) => {
            const job = { ...base, state: 'failed' as const }
            await symlink('/tmp', join(root, job.id))
            await expect(reconcileBackupArtifacts([job], root)).rejects.toThrow(
                'invalid backup directory',
            )
            await rm(join(root, job.id))
            for (let index = 0; index < 129; index += 1) {
                await writeFile(join(root, 'foreign-' + index), 'foreign')
            }
            await expect(reconcileBackupArtifacts([], root)).rejects.toThrow(
                'too many backup entries',
            )
            expect(await readdir(root)).toHaveLength(129)
        }))

    test('more than 64 failed publications in one agent lifetime keep capacity for the next export', () =>
        filesystemFixture(async (root, base) => {
            const retained = Array.from({ length: 50 }, (_, index) => ({
                ...base,
                id: idFor(1000 + index),
                state: 'succeeded' as const,
                retained: true,
            }))
            for (const job of retained) await publishedFixture(root, job)
            const retainedPath = join(root, retained[0]!.id)
            const keyBefore = await readFile(join(retainedPath, 'app-encryption-key'))
            const jobs: ManagedBackupJob[] = [...retained]
            const retainedIds = retained.map((job) => job.id).toSorted()
            for (let index = 0; index < 70; index += 1) {
                const current = { ...base, id: idFor(100 + index), state: 'running' as const }
                // This is the same pre-execution boundary used by the live agent.
                await reconcileBackupArtifacts([...jobs, current], root)
                expect((await readdir(root)).toSorted()).toEqual(retainedIds)
                await publishedFixture(root, current)
                jobs.push({ ...current, state: 'failed', error: 'recovery_failed' })
                if (jobs.length > 99) jobs.splice(50, 1)
            }
            await reconcileBackupArtifacts(jobs, root)
            expect((await readdir(root)).toSorted()).toEqual(retainedIds)
            expect(await readFile(join(retainedPath, 'app-encryption-key'))).toEqual(keyBefore)
        }))
})
