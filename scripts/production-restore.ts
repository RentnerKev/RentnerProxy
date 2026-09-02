// oxlint-disable no-await-in-loop -- Restore validation and bounded readiness polling are intentionally ordered.

import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'docker-compose.yml')
const applianceService = 'rentnerproxy'
const database = 'rentnerproxy'
const databaseHost = '127.0.0.1'
const databaseUser = 'rentnerproxy'
const stateArchiveName = 'controller-state.tar'
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.mjs'
const healthcheckScript = '/opt/rentnerproxy/web/docker/web/healthcheck.mjs'

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

function validateStateArchiveListing(entriesOutput: string, verboseOutput: string): void {
    const entries = entriesOutput.split(/\r?\n/u).filter((entry) => entry !== '')
    const verboseEntries = verboseOutput.split(/\r?\n/u).filter((entry) => entry !== '')
    if (entries.length === 0 || entries.length !== verboseEntries.length) {
        throw new Error('invalid controller state archive')
    }

    for (const entry of entries) {
        const normalized = entry.replaceAll('\\', '/')
        const parts = normalized.split('/').filter((part) => part !== '' && part !== '.')
        if (
            normalized.startsWith('/') ||
            /^[A-Za-z]:/u.test(normalized) ||
            normalized.includes('\0') ||
            parts.includes('..')
        ) {
            throw new Error('unsafe controller state archive')
        }
    }

    if (verboseEntries.some((entry) => entry[0] !== '-' && entry[0] !== 'd')) {
        throw new Error('unsupported controller state archive entry')
    }
}

async function runCommand(
    argumentsList: string[],
    operation: string,
    timeoutMs = 120_000,
): Promise<string> {
    const child = Bun.spawn({
        cmd: argumentsList,
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
        cmd: argumentsList,
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
    try {
        if (child.stdin && typeof child.stdin !== 'number') {
            child.stdin.write(input)
            child.stdin.end()
        }
        const [exitCode] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) throw new Error('command failed')
    } catch {
        throw new Error('production restore operation failed: ' + operation)
    } finally {
        clearTimeout(timer)
    }
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

type ApplicationEncryptionKeyMetadata = Readonly<{
    bytes?: number
    file?: string
    sha256?: string
}>

function parseApplicationEncryptionKey(bytes: Uint8Array): string | null {
    if (bytes.byteLength === 0 || bytes.byteLength > 4_096 || bytes.includes(0)) return null
    const value = Buffer.from(bytes).toString('utf8').trim()
    return /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
        Buffer.from(value, 'base64').byteLength === 32 &&
        Buffer.from(value, 'base64').toString('base64') === value
        ? value
        : null
}

async function prepareRestoreApplicationKey(
    argumentsList: string[],
    inputPath: string,
    backupVersion: number,
    metadata: ApplicationEncryptionKeyMetadata | undefined,
): Promise<{ readonly directory: string; readonly temporaryDirectory?: string }> {
    if (backupVersion === 2) {
        const keyPath = join(inputPath, 'app-encryption-key')
        const bytes = await readFile(keyPath)
        if (
            metadata?.file !== 'app-encryption-key' ||
            typeof metadata.bytes !== 'number' ||
            !Number.isSafeInteger(metadata.bytes) ||
            metadata.bytes <= 0 ||
            typeof metadata.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(metadata.sha256) ||
            bytes.byteLength !== metadata.bytes ||
            createHash('sha256').update(bytes).digest('hex') !== metadata.sha256 ||
            parseApplicationEncryptionKey(bytes) === null
        ) {
            throw new Error('application encryption key checksum mismatch')
        }
        return { directory: inputPath }
    }

    if (backupVersion !== 1) throw new Error('unsupported backup metadata')
    const keyFile =
        optionValue(argumentsList, '--app-key-file') ??
        optionValue(argumentsList, '--legacy-app-key-file') ??
        process.env.RENTNERPROXY_APP_KEY_FILE?.trim()
    const bytes =
        keyFile === undefined || keyFile === ''
            ? Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'utf8')
            : await readFile(resolve(keyFile))
    const applicationEncryptionKey = parseApplicationEncryptionKey(bytes)
    if (!applicationEncryptionKey) {
        throw new Error(
            'version 1 backup restore requires the original key via --app-key-file or RENTNERPROXY_APP_KEY_FILE',
        )
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rentnerproxy-legacy-restore-key-'))
    try {
        const temporaryKeyPath = join(temporaryDirectory, 'app-encryption-key')
        await writeFile(temporaryKeyPath, applicationEncryptionKey, {
            encoding: 'utf8',
            mode: 0o600,
        })
        await chmod(temporaryKeyPath, 0o600)
        return { directory: temporaryDirectory, temporaryDirectory }
    } catch (error) {
        await rm(temporaryDirectory, { force: true, recursive: true })
        throw error
    }
}

async function restore(): Promise<void> {
    const argumentsList = process.argv.slice(2)
    const inputOption = optionValue(argumentsList, '--input')
    if (!inputOption || !argumentsList.includes('--confirm-replace')) {
        throw new Error('restore requires --input and --confirm-replace')
    }

    const inputPath = resolve(inputOption)
    const metadataPath = join(inputPath, 'metadata.json')
    const dumpPath = join(inputPath, 'postgres.dump')
    const stateArchivePath = join(inputPath, stateArchiveName)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
        applicationEncryptionKey?: ApplicationEncryptionKeyMetadata
        controllerState?: { archive?: string; bytes?: number; sha256?: string }
        format?: string
        postgres?: {
            bytes?: number
            database?: string
            dump?: string
            sha256?: string
            user?: string
        }
        version?: number
    }
    if (
        metadata.format !== 'rentnerproxy-production-backup' ||
        (metadata.version !== 1 && metadata.version !== 2) ||
        metadata.postgres?.dump !== 'postgres.dump' ||
        metadata.controllerState?.archive !== stateArchiveName
    ) {
        throw new Error('unsupported backup metadata')
    }

    const dumpMetadata = metadata.postgres
    if (
        !dumpMetadata ||
        typeof dumpMetadata.bytes !== 'number' ||
        !Number.isSafeInteger(dumpMetadata.bytes) ||
        dumpMetadata.bytes < 0 ||
        typeof dumpMetadata.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(dumpMetadata.sha256) ||
        dumpMetadata.database !== database ||
        dumpMetadata.user !== databaseUser
    ) {
        throw new Error('backup metadata does not match the appliance database')
    }
    const dumpBytes = await readFile(dumpPath)
    if (
        dumpBytes.byteLength !== dumpMetadata.bytes ||
        createHash('sha256').update(dumpBytes).digest('hex') !== dumpMetadata.sha256
    ) {
        throw new Error('PostgreSQL dump checksum mismatch')
    }

    const stateMetadata = metadata.controllerState
    const stateArchiveBytes = await readFile(stateArchivePath)
    if (
        !stateMetadata ||
        typeof stateMetadata.bytes !== 'number' ||
        !Number.isSafeInteger(stateMetadata.bytes) ||
        stateMetadata.bytes <= 0 ||
        typeof stateMetadata.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(stateMetadata.sha256) ||
        stateArchiveBytes.byteLength !== stateMetadata.bytes ||
        createHash('sha256').update(stateArchiveBytes).digest('hex') !== stateMetadata.sha256
    ) {
        throw new Error('controller state archive checksum mismatch')
    }

    const preparedRestoreKey = await prepareRestoreApplicationKey(
        argumentsList,
        inputPath,
        metadata.version,
        metadata.applicationEncryptionKey,
    )
    try {
        const project = composeProject(argumentsList)
        const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
        if (!isAbsolute(composeFile)) throw new Error('invalid Compose file')
        await stat(composeFile)
        const compose = composeCommand(project, composeFile)
        const archiveVolume = inputPath + ':/backup:ro'
        const restoreKeyVolume = preparedRestoreKey.directory + ':/restore-key:ro'

        const archiveEntries = await runCommand(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'tar',
                '--volume',
                archiveVolume,
                applianceService,
                '--list',
                '--file=/backup/' + stateArchiveName,
            ],
            'inspect controller state archive',
            180_000,
        )
        const verboseArchiveEntries = await runCommand(
            [
                ...compose,
                'run',
                '--no-TTY',
                '--rm',
                '--no-deps',
                '--entrypoint',
                'tar',
                '--volume',
                archiveVolume,
                applianceService,
                '--list',
                '--verbose',
                '--file=/backup/' + stateArchiveName,
            ],
            'validate controller state archive types',
            180_000,
        )
        validateStateArchiveListing(archiveEntries, verboseArchiveEntries)

        const targetWasRunning =
            (await runCommand(
                [...compose, 'ps', '--status', 'running', '--quiet', applianceService],
                'inspect appliance',
            )) !== ''
        if (!targetWasRunning) {
            await runCommand(
                [...compose, 'up', '--detach', applianceService],
                'initialize restore target',
                600_000,
            )
        }
        await waitForAppliance(compose)
        await runCommand(
            [...compose, 'stop', '--timeout', '30', applianceService],
            'quiesce restore target',
            180_000,
        )

        let stagedApplicationKey = false
        let databaseReplaced = false
        try {
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
                    restoreKeyVolume,
                    applianceService,
                    bootstrapScript,
                    'begin-app-key-restore',
                ],
                'stage application encryption key restore',
            )
            stagedApplicationKey = true

            const restoreDatabaseCommand =
                'set -Eeuo pipefail; test -s /var/lib/rentnerproxy/postgres-data/PG_VERSION; install -d -m 2775 -o postgres -g postgres /var/run/postgresql; gosu postgres postgres -D /var/lib/rentnerproxy/postgres-data -c listen_addresses= -c unix_socket_directories=/var/run/postgresql >&2 & postgres_pid=$!; cleanup() { kill -TERM "$postgres_pid" 2>/dev/null || true; wait "$postgres_pid" 2>/dev/null || true; }; trap cleanup EXIT; ready=false; for attempt in $(seq 1 60); do if gosu postgres pg_isready --host=/var/run/postgresql --username=' +
                databaseUser +
                ' --dbname=' +
                database +
                ' >/dev/null 2>&1; then ready=true; break; fi; kill -0 "$postgres_pid" 2>/dev/null || exit 1; sleep 1; done; "$ready"; gosu postgres pg_restore --host=/var/run/postgresql --exit-on-error --single-transaction --no-owner --no-acl --clean --if-exists --username=' +
                databaseUser +
                ' --dbname=' +
                database
            await runCommandWithInput(
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
                    restoreDatabaseCommand,
                ],
                new Uint8Array(dumpBytes),
                'restore PostgreSQL',
            )
            databaseReplaced = true

            const restoreStateCommand =
                'set -Eeuo pipefail; umask 077; for item in /var/lib/rentnerproxy/proxy/* /var/lib/rentnerproxy/proxy/.[!.]* /var/lib/rentnerproxy/proxy/..?*; do [ -e "$item" ] || continue; rm -rf -- "$item"; done; tar --extract --no-same-owner --file=/backup/controller-state.tar --directory=/var/lib/rentnerproxy/proxy; chmod 700 /var/lib/rentnerproxy/proxy'
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
                    'bash',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    restoreStateCommand,
                ],
                'restore controller state',
                180_000,
            )

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
                    applianceService,
                    bootstrapScript,
                    'complete-app-key-restore',
                ],
                'complete application encryption key restore',
            )
            stagedApplicationKey = false
        } catch (error) {
            if (stagedApplicationKey && !databaseReplaced) {
                try {
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
                            applianceService,
                            bootstrapScript,
                            'rollback-app-key-restore',
                        ],
                        'roll back application encryption key restore',
                    )
                    stagedApplicationKey = false
                    if (targetWasRunning) {
                        await runCommand(
                            [...compose, 'start', applianceService],
                            'restart unchanged appliance',
                            180_000,
                        )
                    }
                } catch {
                    throw new Error(
                        'production restore failed before data replacement and key rollback failed',
                    )
                }
            }
            throw error
        }

        await runCommand(
            [...compose, 'up', '--detach', '--force-recreate', applianceService],
            'start restored appliance',
            600_000,
        )
        await waitForAppliance(compose)
        console.log('Production restore completed from: ' + inputPath)
    } finally {
        if (preparedRestoreKey.temporaryDirectory) {
            await rm(preparedRestoreKey.temporaryDirectory, { force: true, recursive: true })
        }
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
