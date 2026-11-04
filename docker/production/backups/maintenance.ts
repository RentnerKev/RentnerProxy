// oxlint-disable no-await-in-loop -- Offline maintenance phases are ordered and fail closed.
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CURRENT_COMPATIBILITY_PROFILE } from '../../../web/src/config/compatibility.config.ts'
import { managedBackupSourceSchema } from '../../../web/src/lib/Backups/validation.ts'
import { readDeploymentEnvironmentVariable } from '../../../web/src/lib/Environment/deployment-environment.ts'
import { deploymentSchema } from '../../../scripts/backup/validation.ts'
import {
    assertDeploymentCompatible,
    crowdSecArchiveExclusions,
} from '../../../scripts/backup/format.ts'
import { stateArchiveExclusions } from '../../../scripts/backup/controller-state-archive.ts'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import { publishProductionBackup } from '../../../scripts/backup/publication.ts'
import { snapshotProductionRestore } from '../../../scripts/backup/restore-snapshot.ts'
import {
    postgresCommand,
    postgresDumpCommand,
    controllerRestoreCommand,
    crowdSecRestoreCommand,
} from '../../../scripts/backup/volume-commands.ts'
import {
    beginProductionRestore,
    completeProductionRestore,
    beginAppEncryptionKeyRestore,
    completeAppEncryptionKeyRestore,
} from '../../web/bootstrap-secrets.ts'
import { validationCommand } from './restore.ts'
import type { BackupMetadata } from '../../../scripts/backup/Types/format.types.ts'

const bootstrap = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.ts'
const signalController = new AbortController()
const childEnvironment = {
    PATH: '/usr/lib/postgresql/18/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp',
    LC_ALL: 'C.UTF-8',
    RENTNERPROXY_DATABASE_HOST: '127.0.0.1',
}

async function command(args: string[], output?: string) {
    const file = output ? await open(output, 'wx', 0o600) : undefined
    try {
        const result = await runMaintenanceProcess(args, {
            cwd: '/',
            env: { ...process.env, ...childEnvironment },
            timeoutMs: 360_000,
            maximumOutputBytes: 1_048_576,
            signal: signalController.signal,
            ...(file ? { outputFile: { file, maximumBytes: 8 * 1024 ** 3 } } : {}),
        })
        if (!result.stopped) throw new Error('Maintenance process cleanup incomplete')
        if (result.failed) throw new Error('Offline maintenance step failed', { cause: result })
        await file?.sync()
        return result
    } finally {
        await file?.close()
    }
}

function deployment() {
    return deploymentSchema.parse({
        publicOrigin: readDeploymentEnvironmentVariable('PUBLIC_ORIGIN', process.env),
        trustedProxyCidrs:
            readDeploymentEnvironmentVariable('PROXY_TRUSTED_PROXY_CIDRS', process.env) ?? '',
    })
}

export async function offlineBackup() {
    const staging = '/backup/.staging'
    await mkdir(staging, { mode: 0o700 })
    await command(['bun', '--no-env-file', bootstrap, 'export-app-key'])
    await rename('/backup/app-encryption-key', join(staging, 'app-encryption-key'))
    const key = await readFile(join(staging, 'app-encryption-key'))
    const dump = (
        await command(['bash', '-c', postgresDumpCommand()], join(staging, 'postgres.dump'))
    ).artifact!
    await command(['pg_restore', '--list', join(staging, 'postgres.dump')])
    const controller = (
        await command(
            [
                'tar',
                '--create',
                '--file=-',
                '--directory=/var/lib/rentnerproxy/proxy',
                ...stateArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            join(staging, 'controller-state.tar'),
        )
    ).artifact!
    const crowdsec = (
        await command(
            [
                'tar',
                '--create',
                '--file=-',
                '--directory=/var/lib/rentnerproxy/crowdsec',
                ...crowdSecArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            join(staging, 'crowdsec-state.tar'),
        )
    ).artifact!
    const source = managedBackupSourceSchema.parse(
        JSON.parse(await readFile('/usr/share/rentnerproxy/backup-source.json', 'utf8')),
    )
    const metadata: BackupMetadata = {
        applicationEncryptionKey: {
            bytes: key.length,
            sha256: createHash('sha256').update(key).digest('hex'),
            file: 'app-encryption-key',
        },
        controllerState: { ...controller, archive: 'controller-state.tar' },
        crowdSecState: { ...crowdsec, archive: 'crowdsec-state.tar' },
        postgres: {
            ...dump,
            dump: 'postgres.dump',
            database: 'rentnerproxy',
            user: 'rentnerproxy',
        },
        deployment: deployment(),
        source,
        createdAt: new Date().toISOString(),
        format: 'rentnerproxy-production-backup',
        redis: 'excluded',
        version: CURRENT_COMPATIBILITY_PROFILE.backup.writtenVersion,
    }
    await publishProductionBackup(staging, '/backup/complete', metadata)
}

export async function offlineRestore(options: readonly string[]) {
    if (
        !options.includes('--confirm-replace') ||
        options.some(
            (value) =>
                !['--confirm-replace', '--resume', '--allow-deployment-change'].includes(value),
        ) ||
        new Set(options).size !== options.length
    )
        throw new Error('Restore requires explicit, nonduplicate recovery options')
    const snapshot = await mkdtemp('/tmp/rentnerproxy-offline-')
    const validation = await mkdtemp('/tmp/rentnerproxy-offline-validation-')
    await chmod(snapshot, 0o700)
    try {
        const { metadata, backupId } = await snapshotProductionRestore('/backup', snapshot)
        assertDeploymentCompatible(
            metadata,
            deployment(),
            options.includes('--allow-deployment-change'),
        )
        await command(['chown', 'postgres:postgres', validation])
        await command(['bash', '-c', validationCommand(snapshot, validation)])
        process.env.RENTNERPROXY_RESTORE_BACKUP_ID = backupId
        process.env.RENTNERPROXY_RESTORE_RESUME = String(options.includes('--resume'))
        const pending = Buffer.from(
            (await command(['bun', '--no-env-file', bootstrap, 'inspect-production-restore']))
                .stdout,
        )
            .toString('utf8')
            .trim()
        if (pending && (!options.includes('--resume') || pending !== backupId))
            throw new Error('Resume requires the same pending backup')
        if (!pending && options.includes('--resume'))
            throw new Error('No interrupted restore is pending')
        if (!pending)
            await command(['/usr/local/bin/rentnerproxy-production', '--initialize-restore-target'])
        await beginProductionRestore()
        await beginAppEncryptionKeyRestore(join(snapshot, 'app-encryption-key'))
        await command(['bash', '-c', postgresCommand(false, snapshot)])
        for (const script of [controllerRestoreCommand(), crowdSecRestoreCommand()])
            await command(['bash', '-c', script.replaceAll('/backup/', snapshot + '/')])
        await command(['sync', '--file-system', '/var/lib/rentnerproxy'])
        await completeAppEncryptionKeyRestore()
        await completeProductionRestore()
    } finally {
        await rm(snapshot, { recursive: true, force: true })
        await rm(validation, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    const abort = () => signalController.abort()
    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)
    // Appliance bootstrap must never honor database overrides from host configuration.
    for (const name of [
        'DATABASE_URL',
        'APP_ENCRYPTION_KEY',
        'POSTGRES_PASSWORD',
        'PGHOST',
        'PGPORT',
        'PGUSER',
        'PGPASSWORD',
        'PGDATABASE',
    ])
        delete process.env[name]
    process.env.RENTNERPROXY_DATABASE_HOST = '127.0.0.1'
    try {
        if (process.getuid?.() !== 0) throw new Error('Offline maintenance requires root')
        const [operation, ...options] = process.argv.slice(2)
        if (operation === 'backup' && !options.length) await offlineBackup()
        else if (operation === 'restore') await offlineRestore(options)
        else throw new Error('Invalid offline maintenance operation')
    } catch {
        console.error(
            'Offline maintenance failed. Restore targets remain stopped; inspect the journal and resume the same backup when required.',
        )
        process.exitCode = 1
    } finally {
        process.removeListener('SIGINT', abort)
        process.removeListener('SIGTERM', abort)
    }
}
