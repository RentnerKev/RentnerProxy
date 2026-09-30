import { stateArchiveExclusions } from './controller-state-archive'
import {
    crowdSecArchiveExclusions,
    deploymentSchema,
    parseBackupMetadata,
    validateStateArchive,
    type BackupMetadata,
} from './production-backup-format'
import { createHash, randomUUID } from 'node:crypto'
import {
    chmod,
    mkdir,
    mkdtemp,
    open,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises'
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
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.mjs'

type CommandOptions = Readonly<{
    timeoutMs?: number
}>

function optionValue(argumentsList: string[], name: string): string | undefined {
    const index = argumentsList.indexOf(name)
    if (index === -1) return undefined
    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) throw new Error('invalid backup options')
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
    options: CommandOptions = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: argumentsList,
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000)
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
        throw new Error('production backup operation failed: ' + operation)
    } finally {
        clearTimeout(timer)
    }
}

async function runCommandBytes(
    argumentsList: string[],
    operation: string,
    options: CommandOptions = {},
): Promise<Uint8Array> {
    const child = Bun.spawn({
        cmd: argumentsList,
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 300_000)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).arrayBuffer()
            : Promise.resolve(new ArrayBuffer(0))
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) throw new Error('command failed')
        return new Uint8Array(output)
    } catch {
        throw new Error('production backup operation failed: ' + operation)
    } finally {
        clearTimeout(timer)
    }
}

async function sha256(path: string): Promise<string> {
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
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

        const appEncryptionKey = await runCommandBytes(
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
            'export application encryption key',
        )
        await writeFile(appEncryptionKeyPath, appEncryptionKey, { mode: 0o600 })
        await chmod(appEncryptionKeyPath, 0o600)

        const dumpCommand =
            'set -Eeuo pipefail; test -s /var/lib/rentnerproxy/postgres-data/PG_VERSION; install -d -m 0700 -o postgres -g postgres /var/run/postgresql; chmod 00700 /var/run/postgresql; gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!; cleanup() { kill -TERM "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" 2>/dev/null || true; }; trap cleanup EXIT; ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=' +
            databaseUser +
            ' --dbname=' +
            database +
            ' >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done; "$ready"; gosu postgres pg_dump --host=/var/run/postgresql --format=custom --no-owner --no-acl --username=' +
            databaseUser +
            ' --dbname=' +
            database
        const dump = await runCommandBytes(
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
            'create PostgreSQL dump',
            { timeoutMs: 360_000 },
        )
        await Bun.write(dumpPath, dump)
        await chmod(dumpPath, 0o600)

        const stateArchiveBytes = await runCommandBytes(
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
            'archive controller state',
            { timeoutMs: 180_000 },
        )
        validateStateArchive(stateArchiveBytes, 'controller')
        await writeFile(stateArchivePath, stateArchiveBytes, { mode: 0o600 })
        await chmod(stateArchivePath, 0o600)

        const crowdSecBytes = await runCommandBytes(
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
            'archive managed CrowdSec state',
            { timeoutMs: 180_000 },
        )
        validateStateArchive(crowdSecBytes, 'crowdsec')
        await writeFile(crowdSecArchivePath, crowdSecBytes, { mode: 0o600 })
        await chmod(crowdSecArchivePath, 0o600)
        const stateArchive = await stat(stateArchivePath)
        const appEncryptionKeyFile = await stat(appEncryptionKeyPath)
        const metadata: BackupMetadata = {
            applicationEncryptionKey: {
                bytes: appEncryptionKeyFile.size,
                file: 'app-encryption-key',
                sha256: await sha256(appEncryptionKeyPath),
            },
            controllerState: {
                archive: stateArchiveName,
                bytes: stateArchive.size,
                sha256: await sha256(stateArchivePath),
            },
            crowdSecState: {
                archive: 'crowdsec-state.tar',
                bytes: crowdSecBytes.byteLength,
                sha256: await sha256(crowdSecArchivePath),
            },
            deployment,
            source,
            createdAt: new Date().toISOString(),
            format: 'rentnerproxy-production-backup',
            postgres: {
                bytes: dump.byteLength,
                database,
                dump: 'postgres.dump',
                sha256: await sha256(dumpPath),
                user: databaseUser,
            },
            redis: 'excluded',
            version: 4,
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
                await runCommand([...compose, 'start', applianceService], 'restart appliance', {
                    timeoutMs: 180_000,
                })
            } catch {
                process.exitCode = 1
                process.stderr.write(
                    'Backup captured, but the RentnerProxy appliance could not be restarted automatically.\n',
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
