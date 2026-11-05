// oxlint-disable no-await-in-loop -- Recovery phases and bounded artifact validation are ordered.
import { createDecipheriv } from 'node:crypto'
import { constants } from 'node:fs'
import {
    chmod,
    chown,
    lstat,
    mkdir,
    mkdtemp,
    open,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
    snapshotBackupArtifact,
    parseApplicationEncryptionKeyFile,
} from '../../../scripts/backup/artifact-file.ts'
import {
    assertDeploymentCompatible,
    validateControllerEncryptionFile,
    validateStateArchiveFile,
} from '../../../scripts/backup/format.ts'
import { verifyPublishedBackup, syncBackupDirectory } from '../../../scripts/backup/publication.ts'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import { postgresRestoreCommand } from '../../../scripts/production-restore.ts'
import { postgresShutdownScript } from '../../../scripts/backup/postgres-shutdown.ts'
import {
    captureRestoreSessionsSql,
    mergeRestoreSessionsSql,
} from '../../../scripts/backup/restore-session-continuity.ts'
import { stateArchiveExclusions } from '../../../scripts/backup/controller-state-archive.ts'
import { managedBackupStateSchema } from '../../../web/src/lib/Backups/validation.ts'
import { readDeploymentEnvironmentVariable } from '../../../web/src/lib/Environment/deployment-environment.ts'
import {
    beginProductionRestore,
    completeProductionRestore,
    beginAppEncryptionKeyRestore,
    completeAppEncryptionKeyRestore,
} from '../../web/bootstrap-secrets.ts'
import { validateDatabase } from '../../web/validate-backup.ts'
import {
    artifactsRoot,
    backupRoot,
    controlRoot,
    readPrivateJson,
    stateFile,
    writePrivateJson,
} from './storage.ts'
import type { ManagedBackupMaintenance } from '../../../web/src/lib/Backups/Types/backups.types.ts'

export const maintenanceRoot = '/run/rentnerproxy/maintenance'
const phaseFile = join(controlRoot, 'restore-progress.json')

export async function writeMaintenanceProgress(operation: ManagedBackupMaintenance | null) {
    await mkdir(maintenanceRoot, { recursive: true, mode: 0o770 })
    const directory = await lstat(maintenanceRoot)
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0)
        throw new Error('invalid maintenance directory')
    await chown(maintenanceRoot, 0, 10002)
    await chmod(maintenanceRoot, 0o770)
    const path = join(maintenanceRoot, 'progress.json')
    await writePrivateJson(path, { maintenance: operation }, { gid: 10002, mode: 0o440 })
}

export async function awaitWebQuiescence(id: string, signal?: AbortSignal) {
    const until = performance.now() + 90_000
    while (performance.now() < until) {
        signal?.throwIfAborted()
        let file
        try {
            file = await open(
                join(maintenanceRoot, 'web-quiesced.json'),
                constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            )
            const info = await file.stat()
            if (!info.isFile() || info.uid !== 10002 || info.nlink !== 1 || info.size > 1024)
                throw new Error('invalid web maintenance acknowledgement')
            const value = z
                .strictObject({ id: z.uuid(), quiescedAt: z.number().int().nonnegative() })
                .parse(JSON.parse(await file.readFile('utf8')))
            if (value.id === id) return
        } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                throw error
        } finally {
            await file?.close()
        }
        await Bun.sleep(100)
    }
    throw new Error('web maintenance acknowledgement timed out')
}

async function command(
    args: string[],
    signal?: AbortSignal,
    input?: Uint8Array,
    maximumOutputBytes = 1_048_576,
) {
    const result = await runMaintenanceProcess(args, {
        cwd: '/',
        timeoutMs: 360_000,
        signal,
        ...(input === undefined ? {} : { input }),
        maximumOutputBytes,
    })
    if (!result.stopped) throw new Error('restore command cleanup incomplete')
    if (result.failed) throw new Error('restore command failed: ' + args[0], { cause: result })
    return Buffer.from(result.stdout).toString('utf8')
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
    '--set=VERBOSITY=sqlstate',
]

export function validationCommand(snapshot: string, temporary: string) {
    for (const path of [snapshot, temporary])
        if (!/^\/[A-Za-z0-9_./-]+$/u.test(path)) throw new Error('unsafe validation path')
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'export PGPORT=55439',
        'data_directory=' + temporary + '/postgres',
        'socket_directory=' + temporary + '/socket',
        'install -d -m 0700 -o postgres -g postgres "$data_directory" "$socket_directory"',
        'gosu postgres initdb --auth=trust --username=postgres -D "$data_directory" >&2',
        'gosu postgres postgres -D "$data_directory" -p "$PGPORT" -c listen_addresses= -c unix_socket_directories="$socket_directory" >&2 & postgres_pid=$!',
        postgresShutdownScript(),
        'restore_directory=""; rendered_sql_path=""; restore_sql_path=""',
        'cleanup() { stop_postgres; rm -f -- "$rendered_sql_path" "$restore_sql_path"; rmdir -- "$restore_directory" 2>/dev/null || true; }',
        'trap cleanup EXIT',
        'ready=false',
        'for attempt in $(seq 1 60); do if gosu postgres pg_isready --host="$socket_directory" --port="$PGPORT" --username=postgres >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 0.2; done',
        '"$ready"',
        'gosu postgres createdb --host="$socket_directory" --port="$PGPORT" --username=postgres rentnerproxy',
        postgresRestoreCommand(true, snapshot),
        'bun --no-env-file /opt/rentnerproxy/web/backup-export.js --validate-restore ' +
            snapshot +
            ' ' +
            temporary +
            '/crowdsec',
    ].join('\n')
}

export async function validateRestoreDatabase(snapshot: string, crowdsec: string) {
    await validateDatabase(snapshot, 55439, crowdsec, join(dirname(crowdsec), 'socket'))
}

async function replaceState(snapshot: string, name: 'proxy' | 'crowdsec', signal?: AbortSignal) {
    const root = '/var/lib/rentnerproxy'
    const target = join(root, name)
    const next = join(root, '.restore-' + name)
    const old = join(root, '.previous-' + name)
    for (const path of [target, next, old]) {
        const info = await lstat(path).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
            throw error
        })
        if (info && (!info.isDirectory() || info.isSymbolicLink()))
            throw new Error('unsafe restore state directory')
    }
    await rm(next, { recursive: true, force: true })
    await mkdir(next, { mode: 0o700 })
    const archive = name === 'proxy' ? 'controller-state.tar' : 'crowdsec-state.tar'
    await command(
        [
            'tar',
            '--extract',
            '--no-same-owner',
            '--no-same-permissions',
            ...(name === 'proxy'
                ? stateArchiveExclusions.map((entry) => '--exclude=' + entry)
                : []),
            '--file=' + join(snapshot, archive),
            '--directory=' + next,
        ],
        signal,
    )
    if (name === 'proxy') {
        for (const pause of ['ddns-restore-paused', 'docker-discovery-restore-paused'])
            await writeFile(join(next, pause), 'Restore requires explicit activation', {
                mode: 0o600,
            })
    }
    await command(['find', next, '-type', 'd', '-exec', 'chmod', '0700', '{}', '+'], signal)
    await command(['find', next, '-type', 'f', '-exec', 'chmod', '0600', '{}', '+'], signal)
    await command(
        ['chown', '-R', name === 'proxy' ? 'rentnerproxy:rentnerproxy' : 'crowdsec:crowdsec', next],
        signal,
    )
    if (name === 'crowdsec') {
        for (const child of ['data', 'credentials', 'bouncer'])
            await mkdir(join(next, child), { recursive: true, mode: 0o700 })
        for (const child of ['data', 'credentials']) await chown(join(next, child), 10003, 10003)
        await chown(join(next, 'bouncer'), 0, 10001)
        await chmod(join(next, 'bouncer'), 0o710)
        const key = join(next, 'bouncer/caddy-bouncer-key')
        if (await lstat(key).catch(() => null)) {
            await chown(key, 0, 10001)
            await chmod(key, 0o440)
        }
        await chmod(next, 0o711)
    }
    await rm(old, { recursive: true, force: true })
    await rename(target, old)
    await rename(next, target)
    await syncBackupDirectory(root)
    await rm(old, { recursive: true })
}

export async function restoreManagedBackup(id: string, signal?: AbortSignal) {
    z.uuid().parse(id)
    if (process.getuid?.() !== 0) throw new Error('restore requires root supervisor')
    // Appliance secret materialization always uses its loopback database role.
    process.env.RENTNERPROXY_DATABASE_HOST = '127.0.0.1'
    const state = managedBackupStateSchema.parse(await readPrivateJson(stateFile))
    const operation = state.maintenance
    const job = state.jobs.find((entry) => entry.id === operation?.artifactId)
    if (
        !operation ||
        operation.id !== id ||
        operation.operation !== 'restore' ||
        operation.state !== 'running' ||
        !job ||
        !job.retained ||
        job.artifact?.id !== job.id ||
        job.artifact.metadataSha256 !== operation.metadataSha256
    )
        throw new Error('restore identity mismatch')
    const phase = async (value: ManagedBackupMaintenance['phase'], progressPercent: number) => {
        await writePrivateJson(phaseFile, { id, phase: value, progressPercent })
    }
    await phase('validating', 5)
    const directory = join(artifactsRoot, job.id)
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new Error('unsafe restore artifact')
    const verified = await verifyPublishedBackup(directory, signal)
    if (
        verified.metadataSha256 !== operation.metadataSha256 ||
        verified.bytes !== job.artifact.bytes ||
        JSON.stringify(verified.metadata.source) !== JSON.stringify(job.source)
    )
        throw new Error('restore artifact identity mismatch')
    assertDeploymentCompatible(
        verified.metadata,
        {
            publicOrigin: readDeploymentEnvironmentVariable('PUBLIC_ORIGIN', process.env) ?? '',
            trustedProxyCidrs:
                readDeploymentEnvironmentVariable('PROXY_TRUSTED_PROXY_CIDRS', process.env) ?? '',
        },
        false,
    )
    await phase('validating', 8)
    const snapshot = join(backupRoot, '.restore-' + id)
    await mkdir(snapshot, { mode: 0o700 })
    const temporary = await mkdtemp('/tmp/rentnerproxy-validate-')
    await command(['chown', 'postgres:postgres', temporary], signal)
    let committed = false
    try {
        await writeFile(
            join(snapshot, 'metadata.json'),
            await readFile(join(directory, 'metadata.json')),
            { mode: 0o600, flag: 'wx' },
        )
        for (const [name, metadata] of [
            ['app-encryption-key', verified.metadata.applicationEncryptionKey],
            ['postgres.dump', verified.metadata.postgres],
            ['controller-state.tar', verified.metadata.controllerState],
            ['crowdsec-state.tar', verified.metadata.crowdSecState],
        ] as const)
            await snapshotBackupArtifact(join(directory, name), join(snapshot, name), metadata)
        await phase('validating', 12)
        const keyFile = await open(join(snapshot, 'app-encryption-key'), 'r')
        let key: Buffer
        try {
            key = await parseApplicationEncryptionKeyFile(keyFile)
        } finally {
            await keyFile.close()
        }
        const controller = await open(join(snapshot, 'controller-state.tar'), 'r')
        try {
            await validateControllerEncryptionFile(
                controller,
                await validateStateArchiveFile(controller, 'controller', signal),
                (ciphertext, nonce, context) => {
                    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
                    decipher.setAAD(Buffer.from(context))
                    decipher.setAuthTag(ciphertext.subarray(-16))
                    decipher.update(ciphertext.subarray(0, -16))
                    decipher.final()
                },
            )
        } finally {
            await controller.close()
        }
        await phase('validating', 15)
        await command(['bash', '-c', validationCommand(snapshot, temporary)], signal)
        await phase('validating', 18)
        await phase('quiescing', 20)
        await awaitWebQuiescence(id, signal)
        await phase('quiescing', 25)
        const sessions = await command(
            [...psql, '--tuples-only', '--no-align'],
            signal,
            Buffer.from(captureRestoreSessionsSql),
            16 * 1024 * 1024,
        )
        const merge = mergeRestoreSessionsSql(sessions)
        await writeFile(join(snapshot, 'sessions.json'), sessions, { mode: 0o600, flag: 'wx' })
        await beginProductionRestore(operation.metadataSha256!)
        committed = true
        await beginAppEncryptionKeyRestore(join(snapshot, 'app-encryption-key'))
        await phase('database', 30)
        await command(
            [
                'bash',
                '-c',
                [
                    'set -Eeuo pipefail',
                    'umask 077',
                    'socket_directory=/var/run/postgresql',
                    'restore_directory=""; rendered_sql_path=""; restore_sql_path=""',
                    'cleanup() { rm -f -- "$rendered_sql_path" "$restore_sql_path"; rmdir -- "$restore_directory" 2>/dev/null || true; }',
                    'trap cleanup EXIT',
                    postgresRestoreCommand(false, snapshot).replace(
                        '--username=postgres --dbname=rentnerproxy',
                        '--username=rentnerproxy --dbname=rentnerproxy',
                    ),
                ].join('\n'),
            ],
            signal,
        )
        await command(psql, signal, Buffer.from(merge), 1024)
        await phase('controller', 60)
        await replaceState(snapshot, 'proxy', signal)
        await phase('crowdsec', 75)
        await replaceState(snapshot, 'crowdsec', signal)
        await phase('secrets', 85)
        await completeAppEncryptionKeyRestore()
        await completeProductionRestore(operation.metadataSha256!)
        await command(['sync', '-f', '/var/lib/rentnerproxy'], signal)
        await phase('restarting', 90)
        committed = false
    } finally {
        await rm(temporary, { recursive: true, force: true })
        // Preserve the exact source and session snapshot when recovery is needed.
        if (!committed) await rm(snapshot, { recursive: true, force: true })
    }
}
