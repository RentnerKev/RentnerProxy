// oxlint-disable no-await-in-loop -- Restore validation and bounded readiness polling are intentionally ordered.

import { createDecipheriv, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'docker-compose.yml')
const applianceService = 'rentnerproxy'
const databaseHost = '127.0.0.1'
const stateArchiveName = 'controller-state.tar'
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.ts'
const healthcheckScript = '/opt/rentnerproxy/web/docker/web/healthcheck.ts'
import { stateArchiveExclusions } from './backup/controller-state-archive.ts'
import { waitForApplianceReadiness } from './backup/appliance-readiness.ts'
import { createMaintenanceCommands } from './backup/maintenance-commands.ts'
import { commandOption, composeArguments, readComposeProject } from './backup/compose.ts'
import { postgresShutdownScript } from './backup/postgres-shutdown.ts'
import {
    assertDeploymentCompatible,
    parseBackupMetadata,
    validateControllerEncryptionFile,
    validateStateArchiveFile,
} from './backup/format.ts'
import {
    parseApplicationEncryptionKeyFile,
    readFileRange,
    snapshotBackupArtifact,
} from './backup/artifact-file.ts'
import { deploymentSchema } from './backup/validation.ts'
import { smokeDockerArguments } from './smoke/resources.ts'

const commands = createMaintenanceCommands({
    cwd: repositoryRoot,
    operation: 'restore',
    transformArguments: smokeDockerArguments,
})

function optionValue(argumentsList: string[], name: string): string | undefined {
    return commandOption(argumentsList, name, 'restore')
}

function composeProject(argumentsList: string[]): string | undefined {
    return readComposeProject(argumentsList, process.env.COMPOSE_PROJECT_NAME, 'restore')
}

const composeCommand = composeArguments
const runCommand = commands.text

async function waitForAppliance(compose: string[]): Promise<void> {
    await waitForApplianceReadiness((timeoutMs) =>
        runCommand(
            [...compose, 'exec', '--no-TTY', applianceService, 'bun', healthcheckScript],
            'wait for appliance',
            timeoutMs,
        ),
    )
}

async function readBackupFile(path: string, maximumBytes: number): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.size > maximumBytes) throw new Error('unsupported backup file')
        return await readFileRange(file, 0, info.size)
    } catch {
        throw new Error('backup file is missing, invalid or too large')
    } finally {
        await file.close()
    }
}

function postgresRestoreCommand(validateOnly: boolean): string {
    return [
        'restore_phase=archive',
        'restore_directory=$(mktemp -d /tmp/rentnerproxy-restore.XXXXXX)',
        'chown postgres:postgres "$restore_directory"',
        'rendered_sql_path="$restore_directory/rendered.sql"',
        'restore_sql_path="$restore_directory/restore.sql"',
        'touch "$rendered_sql_path" "$restore_sql_path"',
        'chown postgres:postgres "$rendered_sql_path" "$restore_sql_path"',
        'chmod 0600 "$rendered_sql_path" "$restore_sql_path"',
        'restore_phase=render',
        'gosu postgres pg_restore --exit-on-error --no-owner --no-acl --clean --if-exists --file="$rendered_sql_path" < /backup/postgres.dump',
        'restore_phase=assemble',
        '{ printf "%s\\n" "DROP SCHEMA IF EXISTS rentnerproxy CASCADE;" "DROP SCHEMA IF EXISTS drizzle CASCADE;"; cat "$rendered_sql_path"; } > "$restore_sql_path"',
        ...(validateOnly
            ? []
            : [
                  'cat >> "$restore_sql_path" <<\'RESTORE_NOTIFICATION_SQL\'',
                  'WITH normalized AS MATERIALIZED (',
                  "    SELECT id, CASE jsonb_typeof(value) WHEN 'string' THEN (value #>> '{}')::jsonb ELSE value END AS value",
                  "    FROM rentnerproxy.system_settings WHERE key = 'notification_configuration_v1'",
                  ')',
                  "UPDATE rentnerproxy.system_settings AS settings SET value = jsonb_set(jsonb_set(jsonb_set(normalized.value, '{enabled}', 'false'::jsonb), '{pausedAfterRestore}', 'true'::jsonb), '{revision}', to_jsonb(least((normalized.value->>'revision')::bigint + 1, 4294967295))) FROM normalized WHERE settings.id = normalized.id;",
                  "DELETE FROM rentnerproxy.system_settings WHERE key = 'notification_delivery_state_v1';",
                  'RESTORE_NOTIFICATION_SQL',
              ]),
        'restore_phase=execute',
        'gosu postgres psql --host="$socket_directory" --single-transaction --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate --no-psqlrc --username=postgres --dbname=rentnerproxy --file="$restore_sql_path"',
    ].join('\n')
}

export function postgresCommand(validateOnly: boolean): string {
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'restore_phase=initialize',
        'trap \'status=$?; printf "RESTORE_PHASE=%s\\n" "$restore_phase" >&2; exit "$status"\' ERR',
        'restore_directory=""; rendered_sql_path=""; restore_sql_path=""',
        validateOnly
            ? 'data_directory=/tmp/backup-postgres; socket_directory=/tmp/backup-postgres-socket'
            : 'data_directory=/var/lib/rentnerproxy/postgres-data; socket_directory=/var/run/postgresql',
        'install -d -m 0700 -o postgres -g postgres "$socket_directory"',
        ...(validateOnly
            ? [
                  'install -d -m 0700 -o postgres -g postgres "$data_directory"',
                  'gosu postgres initdb --auth=trust --username=postgres -D "$data_directory" >&2',
              ]
            : ['test -s "$data_directory/PG_VERSION"']),
        'gosu postgres postgres -D "$data_directory" -c listen_addresses=' +
            (validateOnly ? '127.0.0.1' : '') +
            ' -c unix_socket_directories="$socket_directory" >&2 & postgres_pid=$!',
        postgresShutdownScript(),
        'cleanup() { rm -f -- "$rendered_sql_path" "$restore_sql_path"; rmdir -- "$restore_directory" 2>/dev/null || true; stop_postgres; }',
        'trap cleanup EXIT',
        'ready=false',
        'for attempt in $(seq 1 60); do if gosu postgres pg_isready --host="$socket_directory" --username=postgres >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done',
        '"$ready"',
        ...(validateOnly
            ? ['gosu postgres createdb --host="$socket_directory" --username=postgres rentnerproxy']
            : []),
        validateOnly
            ? postgresRestoreCommand(true)
            : postgresRestoreCommand(false).replace(
                  '--username=postgres --dbname=rentnerproxy',
                  '--username=rentnerproxy --dbname=rentnerproxy',
              ),
        ...(validateOnly ? ['bun /opt/rentnerproxy/web/docker/web/validate-backup.ts'] : []),
    ].join('\n')
}

async function restore(): Promise<void> {
    const argumentsList = process.argv.slice(2)
    const inputOption = optionValue(argumentsList, '--input')
    if (!inputOption || !argumentsList.includes('--confirm-replace'))
        throw new Error('restore requires --input and --confirm-replace')
    const inputPath = resolve(inputOption)
    const snapshot = await mkdtemp(join(tmpdir(), 'rentnerproxy-restore-'))
    await chmod(snapshot, 0o700)
    try {
        const metadataBytes = await readBackupFile(join(inputPath, 'metadata.json'), 65_536)
        let metadataValue: unknown
        try {
            metadataValue = JSON.parse(metadataBytes.toString('utf8'))
        } catch {
            throw new Error('invalid backup metadata')
        }
        const metadata = parseBackupMetadata(metadataValue)
        const backupId = createHash('sha256').update(metadataBytes).digest('hex')
        await writeFile(join(snapshot, 'metadata.json'), metadataBytes, { mode: 0o600, flag: 'wx' })
        await chmod(join(snapshot, 'metadata.json'), 0o600)
        const artifacts = [
            { name: 'postgres.dump', metadata: metadata.postgres },
            { name: 'app-encryption-key', metadata: metadata.applicationEncryptionKey },
            { name: stateArchiveName, metadata: metadata.controllerState },
            { name: 'crowdsec-state.tar', metadata: metadata.crowdSecState },
        ]
        for (const artifact of artifacts) {
            await snapshotBackupArtifact(
                join(inputPath, artifact.name),
                join(snapshot, artifact.name),
                artifact.metadata,
            )
        }
        const keyFile = await open(join(snapshot, 'app-encryption-key'), 'r')
        let appKey: Buffer
        try {
            appKey = await parseApplicationEncryptionKeyFile(keyFile)
        } finally {
            await keyFile.close()
        }
        const controllerFile = await open(join(snapshot, stateArchiveName), 'r')
        try {
            const controllerEntries = await validateStateArchiveFile(controllerFile, 'controller')
            await validateControllerEncryptionFile(
                controllerFile,
                controllerEntries,
                (ciphertext, iv, context) => {
                    try {
                        if (iv.length !== 12 || ciphertext.length < 17)
                            throw new Error('invalid encrypted secret')
                        const decipher = createDecipheriv('aes-256-gcm', appKey, iv)
                        decipher.setAAD(Buffer.from(context, 'utf8'))
                        decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
                        decipher.update(ciphertext.subarray(0, -16))
                        decipher.final()
                    } catch {
                        throw new Error('backup application key cannot decrypt controller state')
                    }
                },
            )
        } finally {
            await controllerFile.close()
        }
        const crowdSecFile = await open(join(snapshot, 'crowdsec-state.tar'), 'r')
        try {
            await validateStateArchiveFile(crowdSecFile, 'crowdsec')
        } finally {
            await crowdSecFile.close()
        }

        const project = composeProject(argumentsList)
        const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
        await stat(composeFile)
        const compose = composeCommand(project, composeFile)
        const config = JSON.parse(
            await runCommand([...compose, 'config', '--format=json'], 'inspect deployment'),
        ) as {
            services: { rentnerproxy: { image: string; environment: Record<string, string> } }
        }
        const service = config.services.rentnerproxy
        const deployment = deploymentSchema.parse({
            publicOrigin: service.environment.RENTNERPROXY_PUBLIC_ORIGIN,
            trustedProxyCidrs: service.environment.RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS ?? '',
        })
        assertDeploymentCompatible(
            metadata,
            deployment,
            argumentsList.includes('--allow-deployment-change'),
        )
        const imageId = await runCommand(
            ['docker', 'image', 'inspect', '--format={{.Id}}', service.image],
            'inspect restore image',
        )
        if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error('invalid restore target image')
        await runCommand(
            [
                'docker',
                'run',
                '--rm',
                '--network=none',
                '--entrypoint=bash',
                '--volume',
                snapshot + ':/backup:ro',
                imageId,
                '-c',
                postgresCommand(true),
            ],
            'restore PostgreSQL',
            360_000,
        )

        const keyVolume = snapshot + ':/restore-key:ro'
        const archiveVolume = snapshot + ':/backup:ro'
        const bootstrap = (operation: string) => [
            ...compose,
            'run',
            '--no-TTY',
            '--rm',
            '--no-deps',
            '--entrypoint=bun',
            '--env',
            'RENTNERPROXY_DATABASE_HOST=' + databaseHost,
            '--env',
            'RENTNERPROXY_RESTORE_BACKUP_ID=' + backupId,
            '--env',
            'RENTNERPROXY_RESTORE_RESUME=' + argumentsList.includes('--resume'),
            '--volume',
            keyVolume,
            applianceService,
            bootstrapScript,
            operation,
        ]
        const pending = await runCommand(
            bootstrap('inspect-production-restore'),
            'inspect pending restore',
        )
        if (pending && (!argumentsList.includes('--resume') || pending !== backupId))
            throw new Error('interrupted restore requires --resume with the same backup')
        if (!pending && argumentsList.includes('--resume'))
            throw new Error('no interrupted restore is pending')
        await runCommand(
            [...compose, 'stop', '--timeout', '30', applianceService],
            'quiesce restore target',
            180_000,
        )
        // Preparing a fresh database must never boot the old controller/web workers.
        // A resumed restore already has its initialized cluster and must retain its journal/key state.
        if (!pending)
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=/usr/local/bin/rentnerproxy-production',
                    applianceService,
                    '--initialize-restore-target',
                ],
                'initialize restore target',
                180_000,
            )
        await runCommand(bootstrap('begin-production-restore'), 'stage production restore')
        try {
            await runCommand(
                bootstrap('begin-app-key-restore'),
                'stage application encryption key restore',
            )
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--env',
                    'RENTNERPROXY_RESTORE_PHASE=database',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    postgresCommand(false),
                ],
                'restore PostgreSQL',
                360_000,
            )

            const exclusions = stateArchiveExclusions.map((entry) => '--exclude=' + entry).join(' ')
            const stateScript = [
                'set -Eeuo pipefail',
                'umask 077',
                'root=/var/lib/rentnerproxy',
                'test ! -L "$root/proxy"',
                'rm -rf -- "$root/.restore-proxy"',
                'install -d -m 0700 -o rentnerproxy -g rentnerproxy "$root/.restore-proxy"',
                'tar --extract --no-same-owner --no-same-permissions ' +
                    exclusions +
                    ' --file=/backup/controller-state.tar --directory="$root/.restore-proxy"',
                'printf %s "Restore requires explicit DDNS activation" > "$root/.restore-proxy/ddns-restore-paused"',
                'printf %s "Restore requires explicit Docker discovery activation" > "$root/.restore-proxy/docker-discovery-restore-paused"',
                'find "$root/.restore-proxy" -type d -exec chmod 0700 {} +',
                'find "$root/.restore-proxy" -type f -exec chmod 0600 {} +',
                'chown -R rentnerproxy:rentnerproxy "$root/.restore-proxy"',
                'rm -rf -- "$root/proxy"',
                'mv -T -- "$root/.restore-proxy" "$root/proxy"',
            ].join('\n')
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    stateScript,
                ],
                'restore controller state',
                180_000,
            )
            const crowdSecScript = [
                'set -Eeuo pipefail',
                'umask 077',
                'root=/var/lib/rentnerproxy',
                'test ! -L "$root/crowdsec"',
                'rm -rf -- "$root/.restore-crowdsec"',
                'mkdir -m 0700 "$root/.restore-crowdsec"',
                'tar --extract --no-same-owner --no-same-permissions --file=/backup/crowdsec-state.tar --directory="$root/.restore-crowdsec"',
                'find "$root/.restore-crowdsec" -type d -exec chmod 0700 {} +',
                'find "$root/.restore-crowdsec" -type f -exec chmod 0600 {} +',
                'chown -R crowdsec:crowdsec "$root/.restore-crowdsec"',
                'install -d -m 0700 -o crowdsec -g crowdsec "$root/.restore-crowdsec/data" "$root/.restore-crowdsec/credentials"',
                'install -d -m 0710 -o root -g rentnerproxy "$root/.restore-crowdsec/bouncer"',
                'if [ -f "$root/.restore-crowdsec/bouncer/caddy-bouncer-key" ]; then chown root:rentnerproxy "$root/.restore-crowdsec/bouncer/caddy-bouncer-key"; chmod 0440 "$root/.restore-crowdsec/bouncer/caddy-bouncer-key"; fi',
                'chmod 0711 "$root/.restore-crowdsec"',
                'rm -rf -- "$root/crowdsec"',
                'mv -T -- "$root/.restore-crowdsec" "$root/crowdsec"',
            ].join('\n')
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    crowdSecScript,
                ],
                'restore managed CrowdSec state',
                180_000,
            )
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=sync',
                    applianceService,
                    '--file-system',
                    '/var/lib/rentnerproxy',
                ],
                'flush restored state',
            )
            await runCommand(
                bootstrap('complete-app-key-restore'),
                'complete application encryption key restore',
            )
            await runCommand(
                bootstrap('complete-production-restore'),
                'complete production restore',
            )
        } catch (error) {
            const failure =
                error instanceof Error ? error.message : 'production restore operation failed'
            throw new Error(
                failure +
                    '. Restore interrupted; appliance remains stopped; rerun the same backup with --resume --confirm-replace',
                { cause: error },
            )
        }
        await runCommand(
            [...compose, 'up', '--detach', '--force-recreate', applianceService],
            'start restored appliance',
            600_000,
        )
        await waitForAppliance(compose)
        console.log('Production restore completed from: ' + inputPath)
    } finally {
        await rm(snapshot, { force: true, recursive: true })
    }
}

if (import.meta.main) {
    try {
        await restore()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown restore error'
        console.error(
            'Production restore failed: ' +
                message +
                '. No automatic destructive retry was attempted.',
        )
        process.exitCode = 1
    }
}
