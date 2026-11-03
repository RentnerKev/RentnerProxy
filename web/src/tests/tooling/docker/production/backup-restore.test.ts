// oxlint-disable no-await-in-loop -- The isolated appliance phases must complete in order.
import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { chown, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createManagedBackupEngine } from '../../../../../../scripts/backup/managed-jobs.ts'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'
import { verifyPublishedBackup } from '../../../../../../scripts/backup/publication.ts'
import { exportManagedBackup } from '../../../../../../docker/production/backups/export.ts'
import { removeRetainedBackup } from '../../../../../../docker/production/backups/agent.ts'
import {
    restoreManagedBackup,
    maintenanceRoot,
    writeMaintenanceProgress,
    awaitWebQuiescence,
} from '../../../../../../docker/production/backups/restore.ts'
import {
    artifactsRoot,
    backupRoot,
    controlRoot,
    stateFile,
    writePrivateJson,
} from '../../../../../../docker/production/backups/storage.ts'
import { runMigrate } from '../../../../db/migrate.ts'

const isolated =
    process.platform === 'linux' && process.env.RENTNERPROXY_ISOLATED_RESTORE_TEST === '1'

async function command(args: string[], input?: string) {
    const result = await runMaintenanceProcess(args, {
        cwd: '/workspace',
        timeoutMs: 60_000,
        maximumOutputBytes: 1_048_576,
        ...(input === undefined ? {} : { input: Buffer.from(input) }),
    })
    if (result.failed || !result.stopped)
        throw new Error('isolated fixture command failed: ' + args[0] + ' ' + result.stderr)
    return Buffer.from(result.stdout).toString('utf8').trim()
}
const psql = [
    'gosu',
    'postgres',
    'psql',
    '--host=/var/run/postgresql',
    '--no-psqlrc',
    '--no-password',
    '--username=postgres',
    '--dbname=rentnerproxy',
    '--set=ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
]

async function artifactHashes() {
    const hashes: Record<string, string> = {}
    for (const id of await readdir(artifactsRoot)) {
        for (const name of await readdir(join(artifactsRoot, id))) {
            hashes[id + '/' + name] = createHash('sha256')
                .update(await readFile(join(artifactsRoot, id, name)))
                .digest('hex')
        }
    }
    return hashes
}

test.skipIf(!isolated)(
    'real root restore preserves newer inventory/artifacts and current sessions, then selected delete stays bounded',
    async () => {
        // This integration is admitted only inside an explicitly marked disposable
        // container with empty data. Never use an operator appliance or volume.
        expect(process.getuid?.()).toBe(0)
        expect((await lstat('/rentnerproxy-isolated-test')).isFile()).toBe(true)
        expect(
            await lstat('/var/lib/rentnerproxy/postgres-data/PG_VERSION').catch(() => null),
        ).toBeNull()
        expect(await lstat(stateFile).catch(() => null)).toBeNull()
        await command(['/usr/local/bin/rentnerproxy-production', '--initialize-restore-target'])
        const postgres = Bun.spawn(
            [
                'gosu',
                'postgres',
                'postgres',
                '-D',
                '/var/lib/rentnerproxy/postgres-data',
                '-c',
                'listen_addresses=127.0.0.1',
                '-c',
                'unix_socket_directories=/var/run/postgresql',
            ],
            { stdout: 'ignore', stderr: 'ignore' },
        )
        try {
            for (let attempt = 0; attempt < 100; attempt++) {
                const ready = Bun.spawnSync(
                    [
                        'gosu',
                        'postgres',
                        'pg_isready',
                        '--host=/var/run/postgresql',
                        '--username=postgres',
                    ],
                    { stdout: 'ignore', stderr: 'ignore' },
                )
                if (ready.exitCode === 0) break
                await Bun.sleep(50)
            }
            await runMigrate({
                databaseUrl: (
                    await readFile('/run/rentnerproxy/database-url/value', 'utf8')
                ).trim(),
                migrationsFolder: '/workspace/web/drizzle',
            })
            await mkdir(artifactsRoot, { recursive: true, mode: 0o700 })
            await mkdir(controlRoot, { recursive: true, mode: 0o700 })
            const actorId = '00000000-0000-4000-8000-000000000001'
            const oldSession = '00000000-0000-4000-8000-000000000002'
            const liveSession = '00000000-0000-4000-8000-000000000003'
            await command(
                psql,
                `INSERT INTO rentnerproxy.users(id,display_name,email,status) VALUES ('${actorId}','Restore fixture','fixture@example.invalid','active'); INSERT INTO rentnerproxy.sessions(id,user_id,token_hash,expires_at,oidc_proof) VALUES ('${oldSession}','${actorId}','${'a'.repeat(64)}',now()+interval '1 day',NULL); INSERT INTO rentnerproxy.system_settings(key,value) VALUES ('restore_fixture','1');`,
            )
            await writeFile('/var/lib/rentnerproxy/proxy/restore-fixture.json', 'old state', {
                mode: 0o600,
            })
            const engine = await createManagedBackupEngine({
                read: async () => null,
                write: async (state) => {
                    await writePrivateJson(stateFile, state)
                    await writeMaintenanceProgress(state.maintenance ?? null)
                },
                now: Date.now,
                id: randomUUID,
                source: () => ({
                    imageId: null,
                    revision: null,
                    version: 'integration-fixture',
                    buildSha256: 'f'.repeat(64),
                }),
                execute: async (job) => {
                    await exportManagedBackup(job.id)
                    const result = await verifyPublishedBackup(join(artifactsRoot, job.id))
                    return {
                        id: job.id,
                        metadataSha256: result.metadataSha256,
                        bytes: result.bytes,
                    }
                },
                verify: async (job) => {
                    const result = await verifyPublishedBackup(join(artifactsRoot, job.id))
                    return (
                        result.metadataSha256 === job.artifact?.metadataSha256 &&
                        result.bytes === job.artifact.bytes
                    )
                },
                remove: (job) => removeRetainedBackup(job),
                restore: async (_job, operation) => {
                    await writeFile(
                        join(maintenanceRoot, 'web-quiesced.json'),
                        JSON.stringify({ id: operation.id, quiescedAt: Date.now() }),
                        { mode: 0o600 },
                    )
                    await expect(awaitWebQuiescence(operation.id)).rejects.toThrow(
                        'invalid web maintenance acknowledgement',
                    )
                    await chown(join(maintenanceRoot, 'web-quiesced.json'), 10002, 10002)
                    try {
                        await restoreManagedBackup(operation.id)
                    } catch (error) {
                        console.error('Isolated fixture restore failure:', error)
                        throw error
                    }
                },
            })
            const publicProgress = await lstat(join(maintenanceRoot, 'progress.json'))
            expect([
                publicProgress.uid,
                publicProgress.gid,
                publicProgress.mode & 0o777,
                publicProgress.nlink,
            ]).toEqual([0, 10002, 0o440, 1])
            const first = await engine.start({ requestId: randomUUID(), actorId })
            await engine.tick()
            expect((await engine.status()).jobs[0]?.state).toBe('succeeded')
            await command(
                psql,
                `DELETE FROM rentnerproxy.sessions; INSERT INTO rentnerproxy.sessions(id,user_id,token_hash,expires_at,oidc_proof) VALUES ('${liveSession}','${actorId}','${'b'.repeat(64)}',now()+interval '1 day',NULL); UPDATE rentnerproxy.system_settings SET value='2' WHERE key='restore_fixture';`,
            )
            await writeFile('/var/lib/rentnerproxy/proxy/restore-fixture.json', 'new state', {
                mode: 0o600,
            })
            const second = await engine.start({ requestId: randomUUID(), actorId })
            await engine.tick()
            const before = await engine.status()
            expect(before.jobs.map((job) => job.state)).toEqual(['succeeded', 'succeeded'])
            const hashes = await artifactHashes()
            const request = {
                requestId: randomUUID(),
                actorId,
                actorName: 'Restore fixture',
                metadataSha256: before.jobs[0]!.artifact!.metadataSha256,
            }
            await engine.requestMaintenance(first.id, request, 'restore')
            await engine.tick()
            expect((await engine.status()).maintenance?.state).toBe('succeeded')
            expect((await engine.status()).jobs).toEqual(before.jobs)
            expect(await artifactHashes()).toEqual(hashes)
            expect(
                await command(
                    psql,
                    "SELECT value::text FROM rentnerproxy.system_settings WHERE key='restore_fixture';",
                ),
            ).toBe('1')
            expect(await readFile('/var/lib/rentnerproxy/proxy/restore-fixture.json', 'utf8')).toBe(
                'old state',
            )
            expect(await command(psql, 'SELECT id FROM rentnerproxy.sessions ORDER BY id;')).toBe(
                liveSession,
            )
            expect(
                await command(
                    psql,
                    "SELECT value->>'restorePending' FROM rentnerproxy.system_settings WHERE key='managed_backup_audit_cursor_v1';",
                ),
            ).toBe('true')
            expect(
                await lstat(
                    join(backupRoot, '.restore-' + (await engine.status()).maintenance!.id),
                ).catch(() => null),
            ).toBeNull()
            await engine.requestMaintenance(
                first.id,
                { requestId: randomUUID(), actorId, metadataSha256: request.metadataSha256 },
                'delete',
            )
            await engine.tick()
            expect((await engine.status()).maintenance?.state).toBe('succeeded')
            expect((await engine.status()).jobs.map((job) => job.id)).toEqual([second.id])
            expect(await readdir(artifactsRoot)).toEqual([second.id])
            const remaining = await artifactHashes()
            expect(remaining).toEqual(
                Object.fromEntries(
                    Object.entries(hashes).filter(([path]) => path.startsWith(second.id + '/')),
                ),
            )
        } finally {
            postgres.kill('SIGTERM')
            await Promise.race([
                postgres.exited,
                Bun.sleep(5000).then(() => postgres.kill('SIGKILL')),
            ])
            await postgres.exited
            await rm(join(maintenanceRoot, 'web-quiesced.json'), { force: true })
        }
    },
    120_000,
)
