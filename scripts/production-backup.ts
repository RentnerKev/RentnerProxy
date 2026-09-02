import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
const stateArchiveExclusions = [
    './candidate.conf',
    './engine.pid',
    './runtime-probe.sock',
    './log',
    './logs',
    '*.log',
    '*.log.*',
    '.*.tmp',
]

type CommandOptions = Readonly<{
    timeoutMs?: number
}>

type BackupMetadata = Readonly<{
    applicationEncryptionKey: Readonly<{
        bytes: number
        file: 'app-encryption-key'
        sha256: string
    }>
    controllerState: Readonly<{
        archive: 'controller-state.tar'
        bytes: number
        sha256: string
    }>
    createdAt: string
    format: 'rentnerproxy-production-backup'
    postgres: Readonly<{
        bytes: number
        database: 'rentnerproxy'
        dump: 'postgres.dump'
        sha256: string
        user: 'rentnerproxy'
    }>
    redis: 'excluded'
    version: 2
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

        await runCommand(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'bun',
                '--env',
                'RENTNERPROXY_DATABASE_HOST=' + databaseHost,
                '--volume',
                stagingPath + ':/backup',
                applianceService,
                bootstrapScript,
                'export-app-key',
            ],
            'export application encryption key',
        )
        await chmod(appEncryptionKeyPath, 0o600)

        const dumpCommand =
            'set -Eeuo pipefail; test -s /var/lib/rentnerproxy/postgres-data/PG_VERSION; install -d -m 2775 -o postgres -g postgres /var/run/postgresql; gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!; cleanup() { kill -TERM "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" 2>/dev/null || true; }; trap cleanup EXIT; ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=' +
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

        await runCommand(
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
                '--volume',
                stagingPath + ':/backup',
                applianceService,
                '--create',
                '--file=/backup/' + stateArchiveName,
                '--directory=' + statePath,
                ...stateArchiveExclusions.map((entry) => '--exclude=' + entry),
                '.',
            ],
            'archive controller state',
            { timeoutMs: 180_000 },
        )
        await chmod(stateArchivePath, 0o600)

        const stateArchive = await stat(stateArchivePath)
        const appEncryptionKey = await stat(appEncryptionKeyPath)
        const metadata: BackupMetadata = {
            applicationEncryptionKey: {
                bytes: appEncryptionKey.size,
                file: 'app-encryption-key',
                sha256: await sha256(appEncryptionKeyPath),
            },
            controllerState: {
                archive: stateArchiveName,
                bytes: stateArchive.size,
                sha256: await sha256(stateArchivePath),
            },
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
            version: 2,
        }
        const metadataPath = join(stagingPath, 'metadata.json')
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(metadataPath, 0o600)
        await chmod(stagingPath, 0o700)
        await rename(stagingPath, finalPath)
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
                process.stderr.write(
                    'The RentnerProxy appliance could not be restarted automatically.\n',
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
