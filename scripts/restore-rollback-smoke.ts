import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const postgresPasswordFile = '/run/rentnerproxy/postgres/value'
const database = 'rentnerproxy'
const databaseUser = 'rentnerproxy'
const restoreScript = 'scripts/production-restore.ts'

type Command = (argumentsList: string[], timeoutMs?: number) => Promise<string>
type CommandWithEnvironment = (
    argumentsList: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs?: number,
) => Promise<string>

type BackupMetadata = {
    postgres?: {
        bytes?: number
        database?: string
        dump?: string
        sha256?: string
        user?: string
    }
    [key: string]: unknown
}

export type VerifyRestoreRollbackInput = Readonly<{
    containerId: string
    command: Command
    commandWithEnvironment: CommandWithEnvironment
    environment: NodeJS.ProcessEnv
    waitForHealthy: () => Promise<void>
    composeFile: string
    project: string
    backupPath: string
    temporaryRoot: string
}>

function shellQuote(value: string): string {
    return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}

function sqlQuote(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'"
}

function sqlIdentifier(value: string): string {
    if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error('invalid rollback fixture identifier')
    return '"' + value + '"'
}

async function inContainer(
    command: Command,
    containerId: string,
    script: string,
    timeoutMs = 120_000,
): Promise<string> {
    return command(['docker', 'exec', containerId, 'bash', '-ceu', script], timeoutMs)
}

async function databaseCommand(
    command: Command,
    containerId: string,
    statement: string,
    timeoutMs = 120_000,
): Promise<string> {
    const script =
        'PGPASSWORD="$(cat ' +
        postgresPasswordFile +
        ')" gosu postgres psql --no-psqlrc --no-password --quiet --set=ON_ERROR_STOP=1 ' +
        '--tuples-only --no-align --host=127.0.0.1 --username=' +
        databaseUser +
        ' --dbname=' +
        database +
        ' --command=' +
        shellQuote(statement)
    return inContainer(command, containerId, script, timeoutMs)
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid ' + label)
    }
    return value as Record<string, unknown>
}

async function updateDumpMetadata(backupPath: string): Promise<void> {
    const metadataPath = join(backupPath, 'metadata.json')
    const metadata = requireObject(
        JSON.parse(await readFile(metadataPath, 'utf8')),
        'backup metadata',
    ) as BackupMetadata
    const postgres = requireObject(metadata.postgres, 'PostgreSQL backup metadata') as NonNullable<
        BackupMetadata['postgres']
    >
    if (
        postgres.dump !== 'postgres.dump' ||
        postgres.database !== database ||
        postgres.user !== databaseUser
    ) {
        throw new Error('backup metadata does not match the appliance database')
    }
    const dumpPath = join(backupPath, 'postgres.dump')
    const dump = await readFile(dumpPath)
    metadata.postgres = {
        ...postgres,
        bytes: dump.byteLength,
        sha256: createHash('sha256').update(dump).digest('hex'),
    }
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    })
}

export async function verifyRestoreRollback(input: VerifyRestoreRollbackInput): Promise<void> {
    const failedBackupPath = join(input.temporaryRoot, 'failed-restore-backup')
    const fixtureSuffix = randomUUID().replaceAll('-', '').toLowerCase()
    const fixtureTable = 'restore_rollback_' + fixtureSuffix
    const fixtureFunction = 'restore_rollback_check_' + fixtureSuffix
    const sentinelTable =
        'rentnerproxy.' + sqlIdentifier('restore_rollback_sentinel_' + fixtureSuffix)
    const sentinelValue = 'restore-rollback-sentinel-' + fixtureSuffix
    const tableName = 'public.' + sqlIdentifier(fixtureTable)
    const functionName = 'public.' + sqlIdentifier(fixtureFunction)
    const dumpDirectory = '/tmp/rentnerproxy-restore-rollback-' + fixtureSuffix
    const dumpPath = dumpDirectory + '/postgres.dump'
    let fixtureCreated = false
    let sentinelCreated = false

    await mkdir(input.temporaryRoot, { recursive: true })
    await mkdir(failedBackupPath)
    await cp(input.backupPath, failedBackupPath, { recursive: true })

    try {
        fixtureCreated = true
        await databaseCommand(
            input.command,
            input.containerId,
            [
                `create or replace function ${functionName}(integer) returns boolean language sql immutable as ${sqlQuote('select true')};`,
                `create table ${tableName} (value integer not null check (${functionName}(value)));`,
                `insert into ${tableName} (value) values (-1);`,
                `create or replace function ${functionName}(integer) returns boolean language sql immutable as ${sqlQuote('select $1 > 0')};`,
            ].join('\n'),
        )
        await inContainer(
            input.command,
            input.containerId,
            [
                'set -Eeuo pipefail',
                'install -d -m 0700 -o postgres -g postgres ' + shellQuote(dumpDirectory),
                'PGPASSWORD="$(cat ' +
                    postgresPasswordFile +
                    ')" gosu postgres pg_dump --host=127.0.0.1 --format=custom --no-owner --no-acl --username=' +
                    databaseUser +
                    ' --dbname=' +
                    database +
                    ' --file=' +
                    shellQuote(dumpPath),
                'chmod 0600 ' + shellQuote(dumpPath),
            ].join('\n'),
            360_000,
        )
        await input.command([
            'docker',
            'cp',
            input.containerId + ':' + dumpPath,
            join(failedBackupPath, 'postgres.dump'),
        ])

        sentinelCreated = true
        await databaseCommand(
            input.command,
            input.containerId,
            `create table ${sentinelTable} (marker text primary key); insert into ${sentinelTable} (marker) values (${sqlQuote(sentinelValue)});`,
        )

        await databaseCommand(
            input.command,
            input.containerId,
            `drop table ${tableName}; drop function ${functionName}(integer);`,
        )
        fixtureCreated = false
        await inContainer(
            input.command,
            input.containerId,
            'rm -rf -- ' + shellQuote(dumpDirectory),
        )
        await updateDumpMetadata(failedBackupPath)

        let restoreError: unknown
        try {
            await input.commandWithEnvironment(
                [
                    process.execPath,
                    restoreScript,
                    '--project',
                    input.project,
                    '--input',
                    failedBackupPath,
                    '--confirm-replace',
                ],
                { ...input.environment, RENTNERPROXY_COMPOSE_FILE: input.composeFile },
                900_000,
            )
        } catch (error) {
            restoreError = error
        }
        if (!restoreError) throw new Error('malformed restore fixture unexpectedly succeeded')
        const message = restoreError instanceof Error ? restoreError.message : String(restoreError)
        if (message !== 'Restore failed: restore PostgreSQL') {
            throw new Error('restore rollback smoke failed at an unexpected stage')
        }
        await input.waitForHealthy()
        const sentinel = await databaseCommand(
            input.command,
            input.containerId,
            `select marker from ${sentinelTable} where marker=${sqlQuote(sentinelValue)};`,
        )
        if (sentinel.trim() !== sentinelValue) {
            throw new Error('restore rollback smoke lost the pre-restore sentinel')
        }
        await databaseCommand(input.command, input.containerId, `drop table ${sentinelTable};`)
        sentinelCreated = false
    } finally {
        if (fixtureCreated) {
            await databaseCommand(
                input.command,
                input.containerId,
                `drop table if exists ${tableName}; drop function if exists ${functionName}(integer);`,
            ).catch(() => undefined)
        }
        if (sentinelCreated) {
            await databaseCommand(
                input.command,
                input.containerId,
                `drop table if exists ${sentinelTable};`,
            ).catch(() => undefined)
        }
        await inContainer(
            input.command,
            input.containerId,
            'rm -rf -- ' + shellQuote(dumpDirectory),
        ).catch(() => undefined)
        await rm(failedBackupPath, { force: true, recursive: true })
    }
}
