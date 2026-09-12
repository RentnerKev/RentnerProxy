import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MIGRATION_ADVISORY_LOCK_ID } from '../config/auth.config'
import { runMigrate } from '../db/migrate'
import { getDatabaseUrl } from '../server/env.server'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const configuredDatabaseUrl = getDatabaseUrl()
const disposableDatabaseUrl =
    process.env.RENTNERPROXY_MIGRATION_DATABASE_URL ??
    (process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' &&
    configuredDatabaseUrl !== null &&
    new URL(configuredDatabaseUrl).pathname === '/rentnerproxy_upstream_test'
        ? configuredDatabaseUrl
        : null)
const integrationTest = disposableDatabaseUrl === null ? test.skip : test

function processEnvironment(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
        ),
    )
}

async function runMigrationProcess(databaseUrl: string) {
    const child = Bun.spawn([process.execPath, 'run', 'web/src/db/migrate.ts'], {
        cwd: repositoryRoot,
        env: { ...processEnvironment(), DATABASE_URL: databaseUrl },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const output = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    const timeout = setTimeout(() => child.kill(), 15_000)

    try {
        return await output
    } finally {
        clearTimeout(timeout)
    }
}

async function waitForMigrationLockWait(
    probe: SQL,
    isMigrationDone: () => boolean,
): Promise<boolean> {
    const deadline = Date.now() + 10_000

    while (Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- polling must observe the lock sequentially.
        const waiting = await probe`
            select count(*)::int as count
            from pg_locks
            where locktype = 'advisory'
              and granted = false
              and objid = ${MIGRATION_ADVISORY_LOCK_ID}
        `
        if ((waiting[0]?.count ?? 0) > 0) return true
        if (isMigrationDone()) return false
        // oxlint-disable-next-line no-await-in-loop -- bounded polling interval.
        await Bun.sleep(50)
    }

    return false
}

async function createFailingMigrationFixture() {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'rentnerproxy-migration-'))
    const migrationsFolder = join(fixtureRoot, 'drizzle')
    await cp(join(repositoryRoot, 'web', 'drizzle'), migrationsFolder, { recursive: true })

    const journalPath = join(migrationsFolder, 'meta', '_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        version: string
        dialect: string
        entries: Array<{
            idx: number
            version: string
            when: number
            tag: string
            breakpoints: boolean
        }>
    }
    const lastEntry = journal.entries.at(-1)
    if (!lastEntry) throw new Error('migration fixture has no existing entries')

    const tag = `9999_test_failure_${Date.now()}`
    const when = lastEntry.when + 1
    journal.entries.push({
        idx: journal.entries.length,
        version: journal.version,
        when,
        tag,
        breakpoints: true,
    })
    await writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n')

    const migrationPath = join(migrationsFolder, `${tag}.sql`)
    const markerTable = `migration_fixture_${Date.now()}`
    await writeFile(
        migrationPath,
        `CREATE TABLE rentnerproxy.${markerTable} (id integer PRIMARY KEY);\nSELECT missing_migration_fixture_function();\n`,
    )

    return { fixtureRoot, migrationsFolder, markerTable, migrationPath, when }
}

describe('database migration bootstrap', () => {
    test(
        'does not echo a connection URL or driver SQL on failure',
        async () => {
            const secret = `migration-secret-${Date.now()}`
            const databaseUrl = `postgresql://migration_user:${secret}@127.0.0.1:1/rentnerproxy`
            const [stdout, stderr, exitCode] = await runMigrationProcess(databaseUrl)
            const output = stdout + stderr

            expect(exitCode).toBe(1)
            expect(output).toContain('Migration failed during database connection.')
            expect(output).not.toContain(secret)
            expect(output).not.toContain(databaseUrl)
            expect(output).not.toContain('pg_advisory_lock')
        },
        { timeout: 20_000 },
    )

    integrationTest(
        'blocks startup while another reserved session owns the migration lock',
        async () => {
            const databaseUrl = disposableDatabaseUrl!
            const lockClient = new SQL(databaseUrl)
            const lockConnection = await lockClient.reserve()
            const probe = new SQL(databaseUrl)
            let lockHeld = false
            let migration: Promise<[string, string, number]> | undefined

            try {
                await lockConnection`select pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID})`
                lockHeld = true
                let migrationDone = false
                migration = runMigrationProcess(databaseUrl).finally(() => {
                    migrationDone = true
                })

                expect(await waitForMigrationLockWait(probe, () => migrationDone)).toBe(true)
                await Bun.sleep(100)
                expect(migrationDone).toBe(false)

                await lockConnection`select pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID})`
                lockHeld = false
                const [stdout, stderr, exitCode] = await migration
                expect(exitCode, stderr + stdout).toBe(0)
            } finally {
                try {
                    if (lockHeld) {
                        await lockConnection`select pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID})`
                    }
                } finally {
                    lockConnection.release()
                    if (migration !== undefined) {
                        await migration.catch(() => undefined)
                    }
                    await Promise.all([lockClient.close(), probe.close()])
                }
            }
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'keeps Drizzle transactions on the reserved lock connection',
        async () => {
            const client = new SQL(disposableDatabaseUrl!)
            const reserved = await client.reserve()

            try {
                const reservedPid = await reserved`select pg_backend_pid() as pid`
                const db = drizzle(reserved)
                const transactionPid = await db.transaction((transaction) =>
                    transaction.execute(sql`select pg_backend_pid() as pid`),
                )

                expect(transactionPid[0]?.pid).toBe(reservedPid[0]?.pid)
            } finally {
                reserved.release()
                await client.close()
            }
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'retries registry synchronization after a transactional failure',
        async () => {
            const databaseUrl = disposableDatabaseUrl!
            const suffix = Date.now()
            const functionName = `migration_registry_failure_${suffix}`
            const triggerName = `migration_registry_failure_trigger_${suffix}`
            const probe = new SQL(databaseUrl)

            try {
                await runMigrate({ databaseUrl })
                await probe.unsafe(`
                create function rentnerproxy.${sqlIdentifier(functionName)}()
                returns trigger
                language plpgsql
                as $$ begin
                    raise exception 'migration registry fixture failure';
                end; $$
            `)
                await probe.unsafe(`
                create trigger ${sqlIdentifier(triggerName)}
                before insert or update on rentnerproxy.permissions
                for each row execute function rentnerproxy.${sqlIdentifier(functionName)}()
            `)

                await expect(runMigrate({ databaseUrl })).rejects.toBeDefined()

                await probe.unsafe(
                    `drop trigger if exists ${sqlIdentifier(triggerName)} on rentnerproxy.permissions`,
                )
                await probe.unsafe(
                    `drop function if exists rentnerproxy.${sqlIdentifier(functionName)}()`,
                )
                await runMigrate({ databaseUrl })
            } finally {
                try {
                    await probe.unsafe(
                        `drop trigger if exists ${sqlIdentifier(triggerName)} on rentnerproxy.permissions`,
                    )
                    await probe.unsafe(
                        `drop function if exists rentnerproxy.${sqlIdentifier(functionName)}()`,
                    )
                } finally {
                    await probe.close()
                }
            }
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'rolls back a failed fixture migration and retries successfully',
        async () => {
            const databaseUrl = disposableDatabaseUrl!
            const fixture = await createFailingMigrationFixture()
            const probe = new SQL(databaseUrl)

            try {
                await expect(
                    runMigrate({ databaseUrl, migrationsFolder: fixture.migrationsFolder }),
                ).rejects.toBeDefined()

                const afterFailure = await probe`
                select
                    to_regclass(${`rentnerproxy.${fixture.markerTable}`}) as marker,
                    exists (
                        select 1
                        from drizzle.__drizzle_migrations
                        where created_at = ${fixture.when}
                    ) as journaled
            `
                expect(afterFailure[0]).toEqual({ marker: null, journaled: false })

                await writeFile(
                    fixture.migrationPath,
                    `CREATE TABLE rentnerproxy.${fixture.markerTable} (id integer PRIMARY KEY);\n`,
                )
                await Promise.all([
                    runMigrate({ databaseUrl, migrationsFolder: fixture.migrationsFolder }),
                    runMigrate({ databaseUrl, migrationsFolder: fixture.migrationsFolder }),
                ])

                const afterRetry = await probe`
                select to_regclass(${`rentnerproxy.${fixture.markerTable}`}) as marker
            `
                expect(afterRetry[0]?.marker).toBe(`rentnerproxy.${fixture.markerTable}`)

                const journalRows = await probe`
                select count(*)::int as count
                from drizzle.__drizzle_migrations
                where created_at = ${fixture.when}
            `
                expect(journalRows[0]?.count).toBe(1)

                await probe.unsafe(`drop table rentnerproxy.${sqlIdentifier(fixture.markerTable)}`)
                await probe`delete from drizzle.__drizzle_migrations where created_at = ${fixture.when}`
            } finally {
                try {
                    await probe.unsafe(
                        `drop table if exists rentnerproxy.${sqlIdentifier(fixture.markerTable)}`,
                    )
                    await probe`delete from drizzle.__drizzle_migrations where created_at = ${fixture.when}`
                } finally {
                    await probe.close()
                }
                await rm(fixture.fixtureRoot, { recursive: true, force: true })
            }
        },
        { timeout: 30_000 },
    )
})

function sqlIdentifier(value: string): string {
    if (!/^migration_(?:fixture|registry_failure(?:_trigger)?)_[0-9]+$/u.test(value)) {
        throw new Error('unexpected migration fixture identifier')
    }
    return `"${value}"`
}
