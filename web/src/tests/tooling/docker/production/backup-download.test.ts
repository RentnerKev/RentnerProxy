// oxlint-disable no-await-in-loop -- Verify ordered security failure and cancellation cases.
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, link, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
    backupTarHeader,
    createBackupDownload,
} from '../../../../../../docker/production/backups/download.ts'
import { verifyPublishedBackup } from '../../../../../../scripts/backup/publication.ts'
import type { ManagedBackupJob, ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'

const id = '00000000-0000-4000-8000-000000000001'
const source = { imageId: null, revision: null, version: 'test', buildSha256: 'a'.repeat(64) }
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0

function stateArchive() {
    const header = backupTarHeader('controller-state.tar', 0)
    header.fill(0, 0, 100)
    header.write('./')
    header[156] = 53
    header.fill(32, 148, 156)
    header.write(
        header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, '0') + '\0 ',
        148,
    )
    return Buffer.concat([header, Buffer.alloc(1024)])
}

async function fixture(
    run: (context: {
        root: string
        directory: string
        job: ManagedBackupJob
        download: ReturnType<typeof createBackupDownload>
    }) => Promise<void>,
) {
    const temporaryRoot = resolve(import.meta.dir, '../../../../../../tmp')
    await mkdir(temporaryRoot, { recursive: true })
    const root = await mkdtemp(join(temporaryRoot, 'download-fixture-'))
    const directory = join(root, id)
    try {
        await chmod(root, 0o700)
        await mkdir(directory, { mode: 0o700 })
        const key = Buffer.from('A'.repeat(43) + '=\n')
        const dump = Buffer.from('synthetic postgres dump')
        const archive = stateArchive()
        const metadata = {
            format: 'rentnerproxy-production-backup',
            version: 4,
            createdAt: '2026-10-31T00:00:00.000Z',
            redis: 'excluded',
            source,
            deployment: { publicOrigin: 'https://proxy.example.test', trustedProxyCidrs: '' },
            applicationEncryptionKey: {
                file: 'app-encryption-key',
                bytes: key.length,
                sha256: digest(key),
            },
            postgres: {
                database: 'rentnerproxy',
                user: 'rentnerproxy',
                dump: 'postgres.dump',
                bytes: dump.length,
                sha256: digest(dump),
            },
            controllerState: {
                archive: 'controller-state.tar',
                bytes: archive.length,
                sha256: digest(archive),
            },
            crowdSecState: {
                archive: 'crowdsec-state.tar',
                bytes: archive.length,
                sha256: digest(archive),
            },
        }
        for (const [name, bytes] of [
            ['metadata.json', Buffer.from(JSON.stringify(metadata))],
            ['app-encryption-key', key],
            ['postgres.dump', dump],
            ['controller-state.tar', archive],
            ['crowdsec-state.tar', archive],
        ] as const)
            await writeFile(join(directory, name), bytes, { mode: 0o600 })
        const verified = await verifyPublishedBackup(directory)
        const job: ManagedBackupJob = {
            id,
            requestId: id,
            actorId: id,
            origin: 'manual',
            scheduledFor: null,
            state: 'succeeded',
            retained: true,
            requestedAt: 0,
            startedAt: 0,
            finishedAt: 1,
            durationMs: 1,
            error: null,
            source,
            artifact: { id, bytes: verified.bytes, metadataSha256: verified.metadataSha256 },
        }
        const status: ManagedBackupStatus = {
            storeId: id,
            jobs: [job],
            auditEvents: [],
            configuration: {
                revision: 0,
                enabled: false,
                intervalHours: 24,
                retentionCount: 7,
                nextRunAt: null,
            },
        }
        await run({
            root,
            directory,
            job,
            download: createBackupDownload(async () => structuredClone(status), root, root),
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}

test('tar headers are standard regular USTAR with fixed safe names and private mode', () => {
    const header = backupTarHeader('metadata.json', 123)
    expect(header.length).toBe(512)
    expect(header.subarray(257, 263).toString()).toBe('ustar\0')
    expect(header.subarray(100, 108).toString()).toBe('0000600\0')
    const expected = Number.parseInt(header.subarray(148, 154).toString(), 8)
    header.fill(32, 148, 156)
    expect(header.reduce((sum, byte) => sum + byte, 0)).toBe(expected)
    expect(() => backupTarHeader('metadata.json', -1)).toThrow()
    expect(() => backupTarHeader('metadata.json', 8 * 1024 ** 3)).toThrow()
})

test.skipIf(!linuxRoot)(
    'snapshot survives retention deletion, streams five fixed members, removes temporary names',
    () =>
        fixture(async ({ download, root, directory }) => {
            const response = await download(new Request('http://localhost'), id)
            expect(response.status).toBe(200)
            expect(await readdir(root)).toEqual([id])
            await rm(directory, { recursive: true })
            const bytes = new Uint8Array(await response.arrayBuffer())
            const names: string[] = []
            for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
                const header = Buffer.from(bytes.subarray(offset, offset + 512))
                names.push(header.subarray(0, 100).toString().split('\0')[0]!)
                const size = Number.parseInt(header.subarray(124, 136).toString(), 8)
                offset += 512 + Math.ceil(size / 512) * 512
            }
            expect(names).toEqual([
                'metadata.json',
                'app-encryption-key',
                'postgres.dump',
                'controller-state.tar',
                'crowdsec-state.tar',
            ])
            expect(bytes.byteLength).toBe(Number(response.headers.get('content-length')))
        }),
)

test.skipIf(!linuxRoot)(
    'requires retained success and journal-owned id digest bytes and source',
    () =>
        fixture(async ({ download, job }) => {
            const original = structuredClone(job)
            for (const mutation of [
                () => {
                    job.retained = false
                },
                () => {
                    job.state = 'failed'
                },
                () => {
                    job.artifact!.id = '00000000-0000-4000-8000-000000000002'
                },
                () => {
                    job.artifact!.bytes++
                },
                () => {
                    job.artifact!.metadataSha256 = 'f'.repeat(64)
                },
                () => {
                    job.source.version = 'foreign'
                },
            ]) {
                Object.assign(job, structuredClone(original))
                mutation()
                const response = await download(new Request('http://localhost'), id)
                expect(response.status).toBe(job.retained ? 409 : 404)
                expect(await response.text()).not.toContain('private')
            }
        }),
)

test.skipIf(!linuxRoot)(
    'rejects additional entries, symlinks and hardlinks without exposing payload',
    () =>
        fixture(async ({ download, directory, root }) => {
            const extra = join(directory, 'extra')
            await writeFile(extra, 'unexpected', { mode: 0o600 })
            expect((await download(new Request('http://localhost'), id)).status).toBe(409)
            await rm(extra)
            const original = join(directory, 'postgres.dump')
            const alias = join(root, 'alias')
            await link(original, alias)
            expect((await download(new Request('http://localhost'), id)).status).toBe(409)
            await rm(alias)
            await rm(original)
            await symlink('/etc/passwd', original)
            expect((await download(new Request('http://localhost'), id)).status).toBe(409)
            await rm(original)
            expect(Bun.spawnSync(['mkfifo', original]).exitCode).toBe(0)
            expect((await download(new Request('http://localhost'), id)).status).toBe(409)
        }),
)

test.skipIf(!linuxRoot)(
    'one active download is bounded and cancellation releases its admission slot',
    () =>
        fixture(async ({ download }) => {
            const first = await download(new Request('http://localhost'), id)
            expect(first.status).toBe(200)
            expect((await download(new Request('http://localhost'), id)).status).toBe(409)
            await first.body!.cancel()
            const next = await download(new Request('http://localhost'), id)
            expect(next.status).toBe(200)
            await next.body!.cancel()
        }),
)
