import { chmod, lstat, mkdir, open, readdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CURRENT_COMPATIBILITY_PROFILE } from '../../../web/src/config/compatibility.config.ts'
import { readDeploymentEnvironmentVariable } from '../../../web/src/lib/Environment/deployment-environment.ts'
import { managedBackupStateSchema } from '../../../web/src/lib/Backups/validation.ts'
import { deploymentSchema } from '../../../scripts/backup/validation.ts'
import { stateArchiveExclusions } from '../../../scripts/backup/controller-state-archive.ts'
import { crowdSecArchiveExclusions } from '../../../scripts/backup/format.ts'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import {
    publishProductionBackup,
    syncBackupDirectory,
    verifyPublishedBackup,
} from '../../../scripts/backup/publication.ts'
import {
    artifactsRoot,
    controlRoot,
    readPrivateJson,
    stateFile,
    writePrivateJson,
} from './storage.ts'
import type { BackupMetadata } from '../../../scripts/backup/Types/format.types.ts'

class IncompleteBackupCleanup extends Error {}

async function capture(
    args: string[],
    path: string,
    maximumBytes = 512 * 1024 ** 2,
    signal?: AbortSignal,
) {
    const file = await open(path, 'wx', 0o600)
    try {
        const result = await runMaintenanceProcess(args, {
            cwd: '/',
            timeoutMs: 180_000,
            signal,
            env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LC_ALL: 'C' },
            outputFile: { file, maximumBytes },
        })
        if (!result.stopped) throw new IncompleteBackupCleanup('backup command cleanup incomplete')
        if (result.failed || !result.artifact) throw new Error('backup capture failed')
        await file.sync()
        return result.artifact
    } finally {
        await file.close()
    }
}

export async function exportManagedBackup(id: string, signal?: AbortSignal): Promise<void> {
    z.uuid().parse(id)
    if (process.getuid?.() !== 0) throw new Error('backup requires owned supervisor')
    const state = managedBackupStateSchema.parse(await readPrivateJson(stateFile))
    const job = state.jobs.find((entry) => entry.id === id && entry.state === 'running')
    if (!job) throw new Error('backup job unavailable')
    const finalPath = join(artifactsRoot, id)
    const stagingPath = join(artifactsRoot, '.staging-' + id)
    if ((await readdir(artifactsRoot)).length >= 64)
        throw new Error('backup artifact capacity unavailable')
    const space = await statfs(artifactsRoot)
    if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new Error('backup capacity unavailable')
    await mkdir(stagingPath, { mode: 0o700 })
    try {
        const key = await capture(
            ['/bin/cat', '/run/rentnerproxy/app-key/value'],
            join(stagingPath, 'app-encryption-key'),
            128,
            signal,
        )
        const dump = await capture(
            [
                'gosu',
                'postgres',
                'pg_dump',
                '--host=/var/run/postgresql',
                '--format=custom',
                '--no-owner',
                '--no-acl',
                '--username=rentnerproxy',
                '--dbname=rentnerproxy',
            ],
            join(stagingPath, 'postgres.dump'),
            undefined,
            signal,
        )
        const listing = await runMaintenanceProcess(
            ['pg_restore', '--list', join(stagingPath, 'postgres.dump')],
            { cwd: '/', timeoutMs: 30_000, signal, maximumOutputBytes: 1024 * 1024 },
        )
        if (!listing.stopped) throw new IncompleteBackupCleanup('backup command cleanup incomplete')
        if (listing.failed) throw new Error('invalid backup dump')
        const controller = await capture(
            [
                'tar',
                '--create',
                '--file=-',
                '--directory=/var/lib/rentnerproxy/proxy',
                ...stateArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            join(stagingPath, 'controller-state.tar'),
            undefined,
            signal,
        )
        const crowdsec = await capture(
            [
                'tar',
                '--create',
                '--file=-',
                '--directory=/var/lib/rentnerproxy/crowdsec',
                ...crowdSecArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            join(stagingPath, 'crowdsec-state.tar'),
            undefined,
            signal,
        )
        const metadata: BackupMetadata = {
            applicationEncryptionKey: { ...key, file: 'app-encryption-key' },
            controllerState: { ...controller, archive: 'controller-state.tar' },
            crowdSecState: { ...crowdsec, archive: 'crowdsec-state.tar' },
            deployment: deploymentSchema.parse({
                publicOrigin: readDeploymentEnvironmentVariable('PUBLIC_ORIGIN', process.env),
                trustedProxyCidrs:
                    readDeploymentEnvironmentVariable('PROXY_TRUSTED_PROXY_CIDRS', process.env) ??
                    '',
            }),
            source: job.source,
            createdAt: new Date().toISOString(),
            format: 'rentnerproxy-production-backup',
            postgres: {
                ...dump,
                database: 'rentnerproxy',
                dump: 'postgres.dump',
                user: 'rentnerproxy',
            },
            redis: 'excluded',
            version: CURRENT_COMPATIBILITY_PROFILE.backup.writtenVersion,
        }
        await chmod(stagingPath, 0o700)
        try {
            await lstat(finalPath)
            throw new Error('backup artifact already exists')
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                throw error
        }
        await publishProductionBackup(stagingPath, finalPath, metadata)
        await syncBackupDirectory(artifactsRoot)
        await verifyPublishedBackup(finalPath)
    } finally {
        await rm(stagingPath, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    process.once('SIGTERM', abort)
    process.once('SIGINT', abort)
    try {
        const args = process.argv.slice(2)
        if (process.getuid?.() !== 0) throw new Error('backup requires owned supervisor')
        if (args.length === 1 && args[0] === '--request-id') {
            const request = z
                .strictObject({ id: z.uuid() })
                .parse(await readPrivateJson(controlRoot + '/active.json', 1024))
            console.log(request.id)
        } else if (args.length === 3 && args[0] === '--result') {
            const id = z.uuid().parse(args[1])
            const result = z.enum(['success', 'execution_failed', 'recovery_failed']).parse(args[2])
            await writePrivateJson(controlRoot + '/result.json', {
                id,
                success: result === 'success',
                ...(result === 'success' ? {} : { error: result }),
            })
        } else if (args.length === 2 && args[0] === '--run') {
            await exportManagedBackup(z.uuid().parse(args[1]), controller.signal)
        } else throw new Error('invalid operation')
    } catch (error) {
        console.error('[backups] Artifact creation failed')
        process.exitCode = error instanceof IncompleteBackupCleanup ? 2 : 1
    } finally {
        process.removeListener('SIGTERM', abort)
        process.removeListener('SIGINT', abort)
    }
}
