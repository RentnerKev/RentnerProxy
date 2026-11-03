import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
    chmod,
    chown,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyCoverageFixtureModules } from '@/tests/Helpers/coverageFixture.ts'
import type { ManagedBackupJob } from '@/lib/Backups/Types/backups.types.ts'

const ownedRootTest = test.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0)
const prefix = join(tmpdir(), 'rentnerproxy-offhost-defaults-')
const fixtures: string[] = []
const actorId = '00000000-0000-4000-8000-000000000001'
const key = Buffer.alloc(32, 11).toString('base64')
const recoveryKey = Buffer.alloc(32, 22).toString('base64')
afterEach(async () => {
    await Promise.all(
        fixtures.splice(0).map(async (directory) => {
            if (!resolve(directory).startsWith(resolve(prefix)))
                throw new Error('Unsafe fixture cleanup.')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

async function fixture() {
    const directory = await mkdtemp(prefix)
    fixtures.push(directory)
    const code = join(directory, 'code')
    await copyCoverageFixtureModules(
        code,
        ['docker/production/backups/off-host.ts', 'docker/production/backups/storage.ts'],
        {
            '/var/lib/rentnerproxy': join(directory, 'state'),
            '/run/rentnerproxy': join(directory, 'runtime'),
        },
    )
    const storage = (await import(
        pathToFileURL(join(code, 'docker/production/backups/storage.ts')).href
    )) as typeof import('../../../../../../docker/production/backups/storage.ts')
    const module = (await import(
        pathToFileURL(join(code, 'docker/production/backups/off-host.ts')).href
    )) as typeof import('../../../../../../docker/production/backups/off-host.ts')
    await storage.privateDirectory(storage.backupRoot)
    const keyPath = join(directory, 'runtime/app-key/value')
    await mkdir(join(directory, 'runtime/app-key'), { recursive: true })
    await writeFile(keyPath, key, { mode: 0o400 })
    await chown(keyPath, 10002, 10002)
    const configuration = {
        requestId: actorId,
        actorId,
        expectedRevision: 0,
        enabled: true,
        endpoint: 'https://192.0.2.1',
        region: 'fixture-1',
        bucket: 'fixture-backups',
        prefix: 'owned',
        accessKeyId: 'fixture-access',
        secretAccessKey: 'synthetic-credential',
        recoveryKey,
        recoveryKeySaved: true,
    }
    return { directory, storage, module, keyPath, configuration }
}

describe('off-host default filesystem and encryption dependencies', () => {
    ownedRootTest(
        'seals credentials with the private wrapping key, persists ownership audit, and resumes from disk',
        async () => {
            const context = await fixture()
            const service = await context.module.createOffHostBackupService()
            const status = await service.configure(context.configuration)
            expect(status).toMatchObject({ enabled: true, configured: true, revision: 1 })
            expect(status.targetId).toMatch(/^[a-f0-9-]{36}$/u)
            const raw = await readFile(join(context.storage.backupRoot, 'off-host.json'), 'utf8')
            expect(raw.includes(context.configuration.secretAccessKey)).toBe(false)
            expect(raw.includes(recoveryKey)).toBe(false)
            expect(
                (await lstat(join(context.storage.backupRoot, 'off-host.json'))).mode & 0o777,
            ).toBe(0o600)
            const pending = await service.pendingConfigurationAudit()
            expect(pending).toMatchObject({ actorId, requestId: actorId })
            await service.acknowledgeConfigurationAudit(pending!)
            const resumed = await context.module.createOffHostBackupService()
            expect(resumed.status()).toEqual(service.status())
            expect(await resumed.pendingConfigurationAudit()).toBeNull()
            await resumed.pause()
            expect(resumed.status()).toMatchObject({ enabled: false, revision: 2 })
        },
    )

    ownedRootTest(
        'rejects an unsafe wrapping-key file before publishing any sealed configuration',
        async () => {
            const context = await fixture()
            const service = await context.module.createOffHostBackupService()
            await chmod(context.keyPath, 0o444)
            await expect(service.configure(context.configuration)).rejects.toThrow(
                'off-host secret storage unavailable',
            )
            expect(service.status()).toMatchObject({ revision: 0, configured: false })
            expect(
                await lstat(join(context.storage.backupRoot, 'off-host.json')).catch(() => null),
            ).toBeNull()
        },
    )

    ownedRootTest(
        'aborts an upload before network I/O and removes only its owned temporary names',
        async () => {
            const context = await fixture()
            const service = await context.module.createOffHostBackupService()
            await service.configure(context.configuration)
            const pending = await service.pendingConfigurationAudit()
            await service.acknowledgeConfigurationAudit(pending!)
            const job: ManagedBackupJob = {
                id: actorId,
                requestId: actorId,
                actorId,
                origin: 'manual',
                scheduledFor: null,
                state: 'succeeded',
                requestedAt: 0,
                startedAt: 0,
                finishedAt: 1,
                durationMs: 1,
                error: null,
                retained: true,
                source: {
                    imageId: null,
                    revision: null,
                    version: 'fixture',
                    buildSha256: 'a'.repeat(64),
                },
                artifact: { id: actorId, metadataSha256: 'a'.repeat(64), bytes: 100 },
            }
            const stop = new AbortController()
            stop.abort(new Error('fixture upload cancelled'))
            await expect(service.upload(job, 2, stop.signal)).rejects.toThrow(
                'fixture upload cancelled',
            )
            expect(service.status().retainedCopies).toBe(0)
            expect(await readdir(context.storage.backupRoot)).toEqual(['off-host.json'])
        },
    )

    ownedRootTest(
        'hashes the complete encrypted file and respects cancellation without publishing a partial digest',
        async () => {
            const context = await fixture()
            const path = join(context.directory, 'encrypted-fixture')
            const bytes = Buffer.alloc(100_000, 37)
            await writeFile(path, bytes, { mode: 0o600 })
            expect(await context.module.hashOffHostFile(path)).toEqual({
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            })
            const stop = new AbortController()
            stop.abort(new Error('fixture hash cancelled'))
            await expect(context.module.hashOffHostFile(path, stop.signal)).rejects.toThrow(
                'fixture hash cancelled',
            )
            await writeFile(path, '')
            await expect(context.module.hashOffHostFile(path)).rejects.toThrow(
                'invalid encrypted backup',
            )
        },
    )
})
