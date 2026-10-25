import type { CommandOptions } from './backup/Types/production-backup.types.ts'
import { CURRENT_COMPATIBILITY_PROFILE } from '../web/src/config/compatibility.config.ts'
import { createMaintenanceCommands } from './backup/maintenance-commands.ts'
import { commandOption, composeArguments, readComposeProject } from './backup/compose.ts'
import { postgresShutdownScript } from './backup/postgres-shutdown.ts'
import { waitForApplianceReadiness } from './backup/appliance-readiness.ts'
import { stateArchiveExclusions } from './backup/controller-state-archive.ts'
import {
    crowdSecArchiveExclusions,
    parseBackupMetadata,
    validateStateArchiveFile,
} from './backup/format.ts'
import { deploymentSchema } from './backup/validation.ts'
import type { BackupMetadata } from './backup/Types/format.types.ts'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'docker-compose.yml')
const applianceService = 'rentnerproxy'
const database = 'rentnerproxy'
const databaseHost = '127.0.0.1'
const databaseUser = 'rentnerproxy'
const statePath = '/var/lib/rentnerproxy/proxy'
const stateArchiveName = 'controller-state.tar'
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.ts'
const healthcheckScript = '/opt/rentnerproxy/web/docker/web/healthcheck.ts'

const commands = createMaintenanceCommands({ cwd: repositoryRoot, operation: 'backup' })

function optionValue(argumentsList: string[], name: string): string | undefined {
    return commandOption(argumentsList, name, 'backup')
}

function composeProject(argumentsList: string[]): string | undefined {
    return readComposeProject(argumentsList, process.env.COMPOSE_PROJECT_NAME, 'backup')
}

const composeCommand = composeArguments

function runCommand(
    argumentsList: string[],
    operation: string,
    options: CommandOptions = {},
): Promise<string> {
    return commands.text(argumentsList, operation, options.timeoutMs)
}

function runCommandFile(
    argumentsList: string[],
    path: string,
    operation: string,
    options: CommandOptions = {},
): Promise<{ bytes: number; sha256: string }> {
    return commands.file(argumentsList, path, operation, options.timeoutMs)
}

async function validateArchive(path: string, kind: 'controller' | 'crowdsec'): Promise<void> {
    const file = await open(path, 'r')
    try {
        await validateStateArchiveFile(file, kind)
    } finally {
        await file.close()
    }
}

async function backup(): Promise<void> {
    const argumentsList = process.argv.slice(2)
    const outputOption = optionValue(argumentsList, '--output')
    const project = composeProject(argumentsList)
    const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
    const outputRoot = resolve(
        outputOption ?? process.env.RENTNERPROXY_BACKUP_DIR ?? join(repositoryRoot, 'backups'),
    )
    const compose = composeCommand(project, composeFile)

    if (!isAbsolute(composeFile)) throw new Error('invalid Compose file')
    await stat(composeFile)
    await mkdir(outputRoot, { recursive: true })

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
    const image = JSON.parse(
        await runCommand(
            ['docker', 'image', 'inspect', '--format={{json .}}', service.image],
            'inspect source image',
        ),
    ) as {
        Id: string
        Config: { Labels?: Record<string, string> }
    }
    const source = {
        imageId: image.Id,
        revision: image.Config.Labels?.['org.opencontainers.image.revision'] ?? null,
        version: image.Config.Labels?.['org.opencontainers.image.version'] ?? null,
    }
    const sourceContainer = await runCommand(
        [...compose, 'ps', '--all', '--quiet', applianceService],
        'inspect source appliance',
    )
    if (!sourceContainer || sourceContainer.includes('\n'))
        throw new Error('backup requires one initialized appliance')
    const runningImage = await runCommand(
        ['docker', 'inspect', '--format={{.Image}}', sourceContainer],
        'inspect appliance image',
    )
    if (runningImage !== image.Id)
        throw new Error(
            'Compose image differs from the initialized appliance; use its exact source image before backup',
        )

    const finalName =
        'rentnerproxy-' +
        new Date()
            .toISOString()
            .replace(/[^0-9]/gu, '')
            .slice(0, 14) +
        '-' +
        randomUUID().slice(0, 8)
    const finalPath = join(outputRoot, finalName)
    const stagingPath = await mkdtemp(join(outputRoot, '.staging-'))
    const appEncryptionKeyPath = join(stagingPath, 'app-encryption-key')
    const dumpPath = join(stagingPath, 'postgres.dump')
    const stateArchivePath = join(stagingPath, stateArchiveName)
    const crowdSecArchivePath = join(stagingPath, 'crowdsec-state.tar')
    await chmod(stagingPath, 0o700)
    let restartAppliance = false
    let backupPublished = false

    try {
        restartAppliance =
            (await runCommand(
                [...compose, 'ps', '--status', 'running', '--quiet', applianceService],
                'inspect appliance',
            )) !== ''
        if (restartAppliance) {
            await runCommand(
                [...compose, 'stop', '--timeout', '30', applianceService],
                'quiesce appliance',
            )
        }

        const appEncryptionKey = await runCommandFile(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'sh',
                '--env',
                'RENTNERPROXY_DATABASE_HOST=' + databaseHost,
                applianceService,
                '-c',
                'set -eu; mkdir -m 0700 /backup; bun ' +
                    bootstrapScript +
                    ' export-app-key >&2; cat /backup/app-encryption-key',
            ],
            appEncryptionKeyPath,
            'export application encryption key',
        )

        const dumpCommand =
            'set -Eeuo pipefail; ' +
            postgresShutdownScript() +
            '; test -s /var/lib/rentnerproxy/postgres-data/PG_VERSION; install -d -m 0700 -o postgres -g postgres /var/run/postgresql; chmod 00700 /var/run/postgresql; gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!; cleanup() { stop_postgres; }; trap cleanup EXIT; ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=' +
            databaseUser +
            ' --dbname=' +
            database +
            ' >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done; "$ready"; gosu postgres pg_dump --host=/var/run/postgresql --format=custom --no-owner --no-acl --username=' +
            databaseUser +
            ' --dbname=' +
            database
        const dump = await runCommandFile(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'bash',
                applianceService,
                '-c',
                dumpCommand,
            ],
            dumpPath,
            'create PostgreSQL dump',
            { timeoutMs: 360_000 },
        )

        const stateArchive = await runCommandFile(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--user',
                '10001:10001',
                '--entrypoint',
                'tar',
                applianceService,
                '--create',
                '--file=-',
                '--directory=' + statePath,
                ...stateArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            stateArchivePath,
            'archive controller state',
            { timeoutMs: 180_000 },
        )
        await validateArchive(stateArchivePath, 'controller')

        const crowdSec = await runCommandFile(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'tar',
                applianceService,
                '--create',
                '--file=-',
                '--directory=/var/lib/rentnerproxy/crowdsec',
                ...crowdSecArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            crowdSecArchivePath,
            'archive managed CrowdSec state',
            { timeoutMs: 180_000 },
        )
        await validateArchive(crowdSecArchivePath, 'crowdsec')
        const metadata: BackupMetadata = {
            applicationEncryptionKey: {
                bytes: appEncryptionKey.bytes,
                file: 'app-encryption-key',
                sha256: appEncryptionKey.sha256,
            },
            controllerState: {
                archive: stateArchiveName,
                bytes: stateArchive.bytes,
                sha256: stateArchive.sha256,
            },
            crowdSecState: {
                archive: 'crowdsec-state.tar',
                bytes: crowdSec.bytes,
                sha256: crowdSec.sha256,
            },
            deployment,
            source,
            createdAt: new Date().toISOString(),
            format: 'rentnerproxy-production-backup',
            postgres: {
                bytes: dump.bytes,
                database,
                dump: 'postgres.dump',
                sha256: dump.sha256,
                user: databaseUser,
            },
            redis: 'excluded',
            version: CURRENT_COMPATIBILITY_PROFILE.backup.writtenVersion,
        }
        parseBackupMetadata(metadata)
        const metadataPath = join(stagingPath, 'metadata.json')
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(metadataPath, 0o600)
        await chmod(stagingPath, 0o700)
        await Promise.all(
            [
                appEncryptionKeyPath,
                dumpPath,
                stateArchivePath,
                crowdSecArchivePath,
                metadataPath,
            ].map(async (path) => {
                const handle = await open(path, 'r+')
                try {
                    await handle.sync()
                } finally {
                    await handle.close()
                }
            }),
        )
        if (process.platform !== 'win32') {
            const directory = await open(stagingPath, 'r')
            try {
                await directory.sync()
            } finally {
                await directory.close()
            }
        }
        await rename(stagingPath, finalPath)
        backupPublished = true
        if (process.platform !== 'win32') {
            const directory = await open(outputRoot, 'r')
            try {
                await directory.sync()
            } finally {
                await directory.close()
            }
        }
    } catch (error) {
        await rm(stagingPath, { force: true, recursive: true })
        throw error
    } finally {
        if (restartAppliance) {
            try {
                commands.assertRestartSafe()
                await runCommand([...compose, 'start', applianceService], 'restart appliance', {
                    timeoutMs: 180_000,
                })
                await waitForApplianceReadiness((timeoutMs) =>
                    runCommand(
                        [
                            ...compose,
                            'exec',
                            '--no-TTY',
                            applianceService,
                            'bun',
                            healthcheckScript,
                        ],
                        'wait for appliance',
                        { timeoutMs },
                    ),
                )
            } catch {
                process.exitCode = 1
                process.stderr.write(
                    'RentnerProxy appliance could not be restarted or did not become ready automatically. ' +
                        (backupPublished
                            ? 'Completed backup retained: ' + finalPath
                            : 'Backup did not complete.') +
                        '\n',
                )
            }
        }
    }

    console.log('Production backup created: ' + finalPath)
}

if (import.meta.main) {
    try {
        await backup()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown backup error'
        console.error('Production backup failed: ' + message)
        process.exitCode = 1
    }
}
