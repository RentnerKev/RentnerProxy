// oxlint-disable no-await-in-loop -- State traversal and service quiescing are intentionally ordered.

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'compose.production.yml')
const statePath = '/var/lib/rentnerproxy/proxy'
const stateArchiveName = 'controller-state.tar'
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
    controllerState: Readonly<{
        archive: 'controller-state.tar'
        bytes: number
        sha256: string
    }>
    createdAt: string
    format: 'rentnerproxy-production-backup'
    postgres: Readonly<{
        bytes: number
        database: string
        dump: 'postgres.dump'
        sha256: string
        user: string
    }>
    redis: 'excluded'
    version: 1
}>

function optionValue(argumentsList: string[], name: string): string | undefined {
    const index = argumentsList.indexOf(name)
    if (index === -1) return undefined
    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) {
        throw new Error('invalid backup options')
    }
    return value
}

function databaseName(): string {
    const value = process.env.POSTGRES_DB?.trim() || 'rentnerproxy'
    if (!/^[A-Za-z0-9_-]{1,63}$/u.test(value)) {
        throw new Error('invalid PostgreSQL database name')
    }
    return value
}

function databaseUser(): string {
    const value = process.env.POSTGRES_USER?.trim() || 'rentnerproxy'
    if (!/^[A-Za-z0-9_-]{1,63}$/u.test(value)) {
        throw new Error('invalid PostgreSQL user name')
    }
    return value
}

function composeCommand(project: string, composeFile: string): string[] {
    return ['docker', 'compose', '--project-name', project, '--file', composeFile]
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
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 120_000)
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
    const project =
        optionValue(argumentsList, '--project') ??
        process.env.COMPOSE_PROJECT_NAME ??
        'rentnerproxy-production'
    const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
    const outputRoot = resolve(
        outputOption ?? process.env.RENTNERPROXY_BACKUP_DIR ?? join(repositoryRoot, 'backups'),
    )
    const database = databaseName()
    const user = databaseUser()
    const compose = composeCommand(project, composeFile)

    if (!isAbsolute(composeFile)) throw new Error('invalid compose file')
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
    const stateArchivePath = join(stagingPath, stateArchiveName)
    const servicesToRestart: string[] = []

    try {
        for (const service of ['web', 'proxy-runtime']) {
            const running = await runCommand(
                [...compose, 'ps', '--status', 'running', '--quiet', service],
                'inspect ' + service,
            )
            if (running) servicesToRestart.push(service)
        }
        if (servicesToRestart.length > 0) {
            await runCommand(
                [...compose, 'stop', '--timeout', '20', ...servicesToRestart],
                'quiesce application services',
            )
        }

        const dump = await runCommandBytes(
            [
                ...compose,
                'exec',
                '--no-TTY',
                'postgres',
                'pg_dump',
                '--format=custom',
                '--no-owner',
                '--no-acl',
                '--username=' + user,
                '--dbname=' + database,
            ],
            'create PostgreSQL dump',
            { timeoutMs: 300_000 },
        )
        const dumpPath = join(stagingPath, 'postgres.dump')
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
                'proxy-runtime',
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
        const metadata: BackupMetadata = {
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
                user,
            },
            redis: 'excluded',
            version: 1,
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
        if (servicesToRestart.length > 0) {
            try {
                await runCommand(
                    [...compose, 'start', ...servicesToRestart],
                    'restart application services',
                )
            } catch {
                process.stderr.write('Production backup completed with services stopped.\n')
            }
        }
    }

    console.log('Production backup created: ' + finalPath)
}

if (import.meta.main) {
    try {
        await backup()
    } catch {
        console.error('Production backup failed.')
        process.exitCode = 1
    }
}
