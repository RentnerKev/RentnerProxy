// oxlint-disable no-await-in-loop -- State validation and bounded readiness polling are intentionally ordered.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'compose.production.yml')
const stateArchiveName = 'controller-state.tar'
function optionValue(argumentsList: string[], name: string): string | undefined {
    const index = argumentsList.indexOf(name)
    if (index === -1) return undefined
    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) throw new Error('invalid restore options')
    return value
}

function databaseName(): string {
    const value = process.env.POSTGRES_DB?.trim() || 'rentnerproxy'
    if (!/^[A-Za-z0-9_-]{1,63}$/u.test(value)) throw new Error('invalid PostgreSQL database name')
    return value
}

function databaseUser(): string {
    const value = process.env.POSTGRES_USER?.trim() || 'rentnerproxy'
    if (!/^[A-Za-z0-9_-]{1,63}$/u.test(value)) throw new Error('invalid PostgreSQL user name')
    return value
}

function composeCommand(project: string, composeFile: string): string[] {
    return ['docker', 'compose', '--project-name', project, '--file', composeFile]
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
    timeoutMs = 300_000,
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

async function waitForPostgres(compose: string[], database: string, user: string): Promise<void> {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
        try {
            await runCommand(
                [
                    ...compose,
                    'exec',
                    '--no-TTY',
                    'postgres',
                    'pg_isready',
                    '--username=' + user,
                    '--dbname=' + database,
                ],
                'wait for PostgreSQL',
                5_000,
            )
            return
        } catch {
            await Bun.sleep(500)
        }
    }
    throw new Error('PostgreSQL did not become ready')
}

async function restore(): Promise<void> {
    const argumentsList = process.argv.slice(2)
    const inputOption = optionValue(argumentsList, '--input')
    const project =
        optionValue(argumentsList, '--project') ??
        process.env.COMPOSE_PROJECT_NAME ??
        'rentnerproxy-production'
    if (!inputOption || !argumentsList.includes('--confirm-replace')) {
        throw new Error('restore requires --input and --confirm-replace')
    }

    const inputPath = resolve(inputOption)
    const database = databaseName()
    const user = databaseUser()
    const metadataPath = join(inputPath, 'metadata.json')
    const dumpPath = join(inputPath, 'postgres.dump')
    const stateArchivePath = join(inputPath, stateArchiveName)
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
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
        metadata.version !== 1 ||
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
        dumpMetadata.user !== user
    ) {
        throw new Error('backup metadata does not match the target database')
    }
    const expectedDumpBytes = dumpMetadata.bytes
    const expectedDumpSha256 = dumpMetadata.sha256
    const dumpBytes = await readFile(dumpPath)
    if (
        dumpBytes.byteLength !== expectedDumpBytes ||
        createHash('sha256').update(dumpBytes).digest('hex') !== expectedDumpSha256
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

    const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
    const compose = composeCommand(project, composeFile)
    const archiveVolume = inputPath + ':/backup:ro'
    await runCommand(
        [...compose, 'build', 'proxy-runtime'],
        'prepare controller state restore image',
        600_000,
    )
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
            'proxy-runtime',
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
            'proxy-runtime',
            '--list',
            '--verbose',
            '--file=/backup/' + stateArchiveName,
        ],
        'validate controller state archive types',
        180_000,
    )
    validateStateArchiveListing(archiveEntries, verboseArchiveEntries)
    await runCommand(
        [...compose, 'stop', '--timeout', '20', 'web', 'proxy-runtime', 'redis'],
        'stop application services',
    )
    await runCommand([...compose, 'up', '-d', 'postgres'], 'start PostgreSQL')
    await waitForPostgres(compose, database, user)

    const dump = new Uint8Array(dumpBytes)
    await runCommandWithInput(
        [
            ...compose,
            'exec',
            '--no-TTY',
            'postgres',
            'pg_restore',
            '--exit-on-error',
            '--no-owner',
            '--no-acl',
            '--clean',
            '--if-exists',
            '--username=' + user,
            '--dbname=' + database,
        ],
        dump,
        'restore PostgreSQL',
    )

    const restoreStateCommand =
        'set -eu; umask 077; for item in /var/lib/rentnerproxy/proxy/* /var/lib/rentnerproxy/proxy/.[!.]* /var/lib/rentnerproxy/proxy/..?*; do [ -e "$item" ] || continue; rm -rf -- "$item"; done; tar --extract --no-same-owner --file=/backup/controller-state.tar --directory=/var/lib/rentnerproxy/proxy; chmod 700 /var/lib/rentnerproxy/proxy'
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
            'sh',
            '--volume',
            archiveVolume,
            'proxy-runtime',
            '-c',
            restoreStateCommand,
        ],
        'restore controller state',
        180_000,
    )

    await runCommand(
        [...compose, 'up', '-d', '--force-recreate', 'redis', 'proxy-runtime'],
        'start ephemeral Redis and proxy runtime',
    )
    const deadline = Date.now() + 60_000
    let runtimeReady = false
    while (Date.now() < deadline) {
        try {
            await runCommand(
                [
                    ...compose,
                    'exec',
                    '--no-TTY',
                    'proxy-runtime',
                    'rentnerproxy-controller',
                    '--healthcheck',
                    'ready',
                ],
                'wait for proxy runtime',
                5_000,
            )
            runtimeReady = true
            break
        } catch {
            await Bun.sleep(500)
        }
    }
    if (!runtimeReady) throw new Error('proxy runtime did not become ready')
    await runCommand([...compose, 'up', '-d', '--force-recreate', 'web'], 'start Web')
    console.log('Production restore completed from: ' + inputPath)
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
