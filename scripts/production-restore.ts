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
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.mjs'
const healthcheckScript = '/opt/rentnerproxy/web/docker/web/healthcheck.mjs'
import { stateArchiveExclusions } from './controller-state-archive'
import {
    assertDeploymentCompatible,
    deploymentSchema,
    parseBackupMetadata,
    validateControllerEncryption,
    validateStateArchive,
    verifyBackupArtifact,
} from './production-backup-format'
import { smokeDockerArguments } from './smoke-resources'

function optionValue(argumentsList: string[], name: string): string | undefined {
    const index = argumentsList.indexOf(name)
    if (index === -1) return undefined
    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) throw new Error('invalid restore options')
    return value
}

function composeProject(argumentsList: string[]): string | undefined {
    const value =
        optionValue(argumentsList, '--project') ?? process.env.COMPOSE_PROJECT_NAME?.trim()
    if (value === undefined || value === '') return undefined
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(value)) throw new Error('invalid Compose project name')
    return value
}

function composeCommand(project: string | undefined, composeFile: string): string[] {
    const command = ['docker', 'compose']
    if (project) command.push('--project-name', project)
    command.push('--file', composeFile)
    return command
}

async function runCommand(
    argumentsList: string[],
    operation: string,
    timeoutMs = 120_000,
): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')
    try {
        const [exitCode, output] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) throw new Error('command failed')
        return output.trim()
    } catch {
        throw new Error('production restore operation failed: ' + operation)
    } finally {
        clearTimeout(timer)
    }
}

async function runCommandWithInput(
    argumentsList: string[],
    input: Uint8Array,
    operation: string,
    timeoutMs = 360_000,
): Promise<void> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')
    let stderrText = ''
    let failed = false
    try {
        if (child.stdin && typeof child.stdin !== 'number') {
            child.stdin.write(input)
            child.stdin.end()
        }
        const [exitCode, , capturedStderr] = await Promise.all([child.exited, stdout, stderr])
        stderrText = capturedStderr
        failed = exitCode !== 0
    } catch {
        failed = true
    } finally {
        clearTimeout(timer)
    }
    if (failed) throw new Error(formatInputCommandFailure(operation, stderrText))
}

function formatInputCommandFailure(operation: string, stderr: string): string {
    const prefix = 'production restore operation failed: ' + operation
    if (operation !== 'restore PostgreSQL') return prefix

    const phase = /RESTORE_PHASE=(initialize|archive|render|assemble|execute)/u.exec(stderr)?.[1]
    const sqlState = /ERROR:\s*(?:[0-9A-Z]{5}:\s*)?([0-9A-Z]{5})\b/u.exec(stderr)?.[1]
    const validation =
        /BACKUP_VALIDATION=(database_version|migration_history|application_key|crowdsec_archive|crowdsec_database|crowdsec_credentials|runtime_validation)/u.exec(
            stderr,
        )?.[1]
    const details = [
        validation ? 'Backup validation: ' + validation : null,
        phase ? 'Restore database phase: ' + phase : null,
        sqlState ? 'SQLSTATE: ' + sqlState : null,
    ].filter((detail): detail is string => detail !== null)

    return prefix + '.' + (details.length > 0 ? ' ' + details.join('; ') + '.' : '')
}

async function waitForAppliance(compose: string[]): Promise<void> {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
        try {
            await runCommand(
                [...compose, 'exec', '--no-TTY', applianceService, 'bun', healthcheckScript],
                'wait for appliance',
                5_000,
            )
            return
        } catch {
            await Bun.sleep(500)
        }
    }
    throw new Error('RentnerProxy appliance did not become ready')
}

async function readBackupFile(path: string, maximumBytes = 8 * 1024 ** 3): Promise<Buffer> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.size > maximumBytes) throw new Error('unsupported backup file')
        return await file.readFile()
    } catch {
        throw new Error('backup file is missing, invalid or too large')
    } finally {
        await file.close()
    }
}

function parseApplicationEncryptionKey(bytes: Uint8Array): Buffer {
    const value = Buffer.from(bytes).toString('utf8').trim()
    if (
        !/^[A-Za-z0-9+/]{43}=$/u.test(value) ||
        Buffer.from(value, 'base64').length !== 32 ||
        Buffer.from(value, 'base64').toString('base64') !== value
    ) {
        throw new Error('invalid backup application encryption key')
    }
    return Buffer.from(value, 'base64')
}

const postgresRestoreCommand = [
    'restore_phase=archive',
    'restore_directory=$(mktemp -d /tmp/rentnerproxy-restore.XXXXXX)',
    'chown postgres:postgres "$restore_directory"',
    'dump_path="$restore_directory/postgres.dump"',
    'rendered_sql_path="$restore_directory/rendered.sql"',
    'restore_sql_path="$restore_directory/restore.sql"',
    'touch "$dump_path" "$rendered_sql_path" "$restore_sql_path"',
    'cat > "$dump_path"',
    'chown postgres:postgres "$dump_path" "$rendered_sql_path" "$restore_sql_path"',
    'chmod 0600 "$dump_path" "$rendered_sql_path" "$restore_sql_path"',
    'restore_phase=render',
    'gosu postgres pg_restore --exit-on-error --no-owner --no-acl --clean --if-exists --file="$rendered_sql_path" "$dump_path"',
    'restore_phase=assemble',
    '{ printf "%s\\n" "DROP SCHEMA IF EXISTS rentnerproxy CASCADE;" "DROP SCHEMA IF EXISTS drizzle CASCADE;"; cat "$rendered_sql_path"; } > "$restore_sql_path"',
    'restore_phase=execute',
    'gosu postgres psql --host="$socket_directory" --single-transaction --set=ON_ERROR_STOP=1 --set=VERBOSITY=sqlstate --no-psqlrc --username=postgres --dbname=rentnerproxy --file="$restore_sql_path"',
].join('\n')

function postgresCommand(validateOnly: boolean): string {
    return [
        'set -Eeuo pipefail',
        'umask 077',
        'restore_phase=initialize',
        'trap \'status=$?; printf "RESTORE_PHASE=%s\\n" "$restore_phase" >&2; exit "$status"\' ERR',
        'restore_directory=""; dump_path=""; rendered_sql_path=""; restore_sql_path=""',
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
        'cleanup() { rm -f -- "$dump_path" "$rendered_sql_path" "$restore_sql_path"; rmdir -- "$restore_directory" 2>/dev/null || true; kill -TERM "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" 2>/dev/null || true; }',
        'trap cleanup EXIT',
        'ready=false',
        'for attempt in $(seq 1 60); do if gosu postgres pg_isready --host="$socket_directory" --username=postgres >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done',
        '"$ready"',
        ...(validateOnly
            ? ['gosu postgres createdb --host="$socket_directory" --username=postgres rentnerproxy']
            : []),
        validateOnly
            ? postgresRestoreCommand
            : postgresRestoreCommand.replace(
                  '--username=postgres --dbname=rentnerproxy',
                  '--username=rentnerproxy --dbname=rentnerproxy',
              ),
        ...(validateOnly ? ['bun /opt/rentnerproxy/web/docker/web/validate-backup.mjs'] : []),
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
        await writeFile(join(snapshot, 'metadata.json'), metadataBytes, { mode: 0o600 })
        const artifacts = [
            { name: 'postgres.dump', metadata: metadata.postgres },
            { name: 'app-encryption-key', metadata: metadata.applicationEncryptionKey },
            { name: stateArchiveName, metadata: metadata.controllerState },
            ...(metadata.version === 4
                ? [{ name: 'crowdsec-state.tar', metadata: metadata.crowdSecState }]
                : []),
        ]
        const bytes = new Map<string, Buffer>()
        for (const artifact of artifacts) {
            const value = await readBackupFile(
                join(inputPath, artifact.name),
                artifact.metadata.bytes,
            )
            verifyBackupArtifact(value, artifact.metadata, artifact.name)
            bytes.set(artifact.name, value)
            await writeFile(join(snapshot, artifact.name), value, { mode: 0o600 })
        }
        const appKey = parseApplicationEncryptionKey(bytes.get('app-encryption-key')!)
        const controllerEntries = validateStateArchive(bytes.get(stateArchiveName)!, 'controller')
        validateControllerEncryption(controllerEntries, (ciphertext, iv, context) => {
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
        })
        if (metadata.version === 4)
            validateStateArchive(bytes.get('crowdsec-state.tar')!, 'crowdsec')

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
        await runCommandWithInput(
            [
                'docker',
                'run',
                '--rm',
                '--interactive',
                '--network=none',
                '--entrypoint=bash',
                '--volume',
                snapshot + ':/backup:ro',
                imageId,
                '-c',
                postgresCommand(true),
            ],
            bytes.get('postgres.dump')!,
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
        if (!pending) {
            const running = await runCommand(
                [...compose, 'ps', '--status', 'running', '--quiet', applianceService],
                'inspect appliance',
            )
            if (!running)
                await runCommand(
                    [...compose, 'up', '--detach', applianceService],
                    'initialize restore target',
                    600_000,
                )
            await waitForAppliance(compose)
        }
        await runCommand(
            [...compose, 'stop', '--timeout', '30', applianceService],
            'quiesce restore target',
            180_000,
        )
        await runCommand(bootstrap('begin-production-restore'), 'stage production restore')
        try {
            await runCommand(
                bootstrap('begin-app-key-restore'),
                'stage application encryption key restore',
            )
            await runCommandWithInput(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--env',
                    'RENTNERPROXY_RESTORE_PHASE=database',
                    applianceService,
                    '-c',
                    postgresCommand(false),
                ],
                bytes.get('postgres.dump')!,
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
            if (metadata.version === 4) {
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
            }
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
