import { describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runMigrate } from '@/db/migrate.ts'
import {
    assertCompatibleBackupHistory,
    isMigrationJournal,
} from '../../../../docker/web/validate-backup.ts'
import type { BackupMigrationRow } from '../../../../docker/web/Types/validate-backup.types.ts'

const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const configuredDatabaseUrl =
    process.env.RENTNERPROXY_MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
const isolatedDatabaseUrl =
    process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' &&
    configuredDatabaseUrl !== undefined &&
    new URL(configuredDatabaseUrl).pathname === '/rentnerproxy_upstream_test'
        ? configuredDatabaseUrl
        : null
const integrationTest = isolatedDatabaseUrl === null ? test.skip : test

async function migrationJournal() {
    const journal: unknown = JSON.parse(
        await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
    )
    if (!isMigrationJournal(journal)) throw new Error('invalid migration fixture journal')
    return journal
}

async function assertHistory(client: SQL, length: number) {
    const rows = await client<BackupMigrationRow[]>`
        select hash, created_at from drizzle.__drizzle_migrations order by id
    `
    const expected = readMigrationFiles({ migrationsFolder }).slice(0, length)
    expect(rows.map((row) => ({ hash: row.hash, when: String(row.created_at) }))).toEqual(
        expected.map((migration) => ({
            hash: migration.hash,
            when: String(migration.folderMillis),
        })),
    )
    await assertCompatibleBackupHistory(rows, await migrationJournal(), (tag) =>
        readFile(join(migrationsFolder, `${tag}.sql`)),
    )
    return rows
}

async function withIsolatedDatabase(check: (client: SQL, databaseUrl: string) => Promise<void>) {
    if (isolatedDatabaseUrl === null) throw new Error('isolated database integration is disabled')
    const databaseName = `rentnerproxy_legacy_archive_${randomBytes(12).toString('hex')}`
    const quotedName = () => {
        if (!/^rentnerproxy_legacy_archive_[a-f0-9]{24}$/u.test(databaseName)) {
            throw new Error('unexpected legacy archive fixture database name')
        }
        return `"${databaseName}"`
    }
    const admin = new SQL(isolatedDatabaseUrl)
    let created = false
    let client: SQL | undefined
    try {
        await admin.unsafe(`CREATE DATABASE ${quotedName()}`)
        created = true
        const databaseUrl = new URL(isolatedDatabaseUrl)
        databaseUrl.pathname = `/${databaseName}`
        client = new SQL(databaseUrl.toString())
        await check(client, databaseUrl.toString())
    } finally {
        try {
            await client?.close()
        } finally {
            try {
                if (created) await admin.unsafe(`DROP DATABASE ${quotedName()}`)
            } finally {
                await admin.close()
            }
        }
    }
}

async function migratePublishedPrefix(client: SQL, lastIndex: number) {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'rentnerproxy-legacy-archive-'))
    const fixtureFolder = join(fixtureRoot, 'drizzle')
    try {
        await cp(migrationsFolder, fixtureFolder, { recursive: true })
        const journal = await migrationJournal()
        await writeFile(
            join(fixtureFolder, 'meta/_journal.json'),
            JSON.stringify({ ...journal, entries: journal.entries.slice(0, lastIndex + 1) }),
        )
        await client`CREATE SCHEMA IF NOT EXISTS rentnerproxy`
        // Historical prefixes lack tables required by today's authorization registry.
        await migrate(drizzle(client), { migrationsFolder: fixtureFolder })
        await assertHistory(client, lastIndex + 1)
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true })
    }
}

async function assertArchiveSchema(client: SQL) {
    const columns = await client`
        select column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'rentnerproxy' and table_name = 'proxy_host_legacy_settings'
        order by ordinal_position
    `
    expect(columns).toEqual([
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'uuidv7()' },
        {
            column_name: 'proxy_host_id',
            data_type: 'uuid',
            is_nullable: 'NO',
            column_default: null,
        },
        {
            column_name: 'advanced_config',
            data_type: 'text',
            is_nullable: 'YES',
            column_default: null,
        },
        {
            column_name: 'unsupported_settings',
            data_type: 'jsonb',
            is_nullable: 'YES',
            column_default: null,
        },
        {
            column_name: 'archived_at',
            data_type: 'timestamp with time zone',
            is_nullable: 'NO',
            column_default: 'now()',
        },
    ])
    const constraints = await client`
        select contype, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conrelid = 'rentnerproxy.proxy_host_legacy_settings'::regclass
          and contype <> 'n'
        order by contype
    `
    expect(constraints).toEqual([{ contype: 'p', definition: 'PRIMARY KEY (id)' }])
}

describe('legacy archive migration', () => {
    test('accepts published backup prefixes and rejects the unpublished destructive tail', async () => {
        const journal = await migrationJournal()
        const published = readMigrationFiles({ migrationsFolder })
            .slice(0, 27)
            .map((migration) => ({
                hash: migration.hash,
                created_at: migration.folderMillis,
            }))
        const readMigration = (tag: string) => readFile(join(migrationsFolder, `${tag}.sql`))
        await Promise.all(
            published.map((_, index) =>
                assertCompatibleBackupHistory(
                    published.slice(0, index + 1),
                    journal,
                    readMigration,
                ),
            ),
        )
        await expect(
            assertCompatibleBackupHistory(
                [
                    ...published,
                    {
                        hash: '5f8f6513071b0f2fe6ea0304cbec7a1792ef21c61d759ce5bcfe41734b4c78af',
                        created_at: 1793112541791,
                    },
                ],
                journal,
                readMigration,
            ),
        ).rejects.toThrow('backup migration history is incompatible with the target image')
    })

    integrationTest(
        'creates the archive on a fresh database and preserves history on rerun',
        async () => {
            await withIsolatedDatabase(async (client, databaseUrl) => {
                await runMigrate({ databaseUrl, migrationsFolder })
                await assertArchiveSchema(client)
                const history = await assertHistory(
                    client,
                    (await migrationJournal()).entries.length,
                )
                await runMigrate({ databaseUrl, migrationsFolder })
                expect(await assertHistory(client, history.length)).toEqual(history)
                expect(
                    await client`select count(*)::int as count from rentnerproxy.proxy_host_legacy_settings`,
                ).toEqual([{ count: 0 }])
            })
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'refuses startup with erased applied history and preserves archived settings',
        async () => {
            await withIsolatedDatabase(async (client, databaseUrl) => {
                await runMigrate({ databaseUrl, migrationsFolder })
                const archiveId = randomUUID()
                await client`
                    insert into rentnerproxy.proxy_host_legacy_settings
                        (id, proxy_host_id, advanced_config)
                    values (${archiveId}, ${randomUUID()}, 'retained through migration failure')
                `
                const before = await client`select * from rentnerproxy.proxy_host_legacy_settings`
                await client`delete from drizzle.__drizzle_migrations`

                await expect(runMigrate({ databaseUrl, migrationsFolder })).rejects.toBeDefined()

                expect(await client`select * from rentnerproxy.proxy_host_legacy_settings`).toEqual(
                    before,
                )
                expect(
                    await client`select count(*)::int as count from drizzle.__drizzle_migrations`,
                ).toEqual([{ count: 0 }])
                await assertArchiveSchema(client)
            })
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'preserves 0026 archive rows, dangling host IDs and dependent foreign keys',
        async () => {
            await withIsolatedDatabase(async (client, databaseUrl) => {
                await migratePublishedPrefix(client, 26)
                const archiveId = randomUUID()
                const deletedHostId = randomUUID()
                await client`
                insert into rentnerproxy.proxy_host_legacy_settings
                    (id, proxy_host_id, advanced_config, unsupported_settings, archived_at)
                values (${archiveId}, ${deletedHostId}, 'legacy fixture',
                    '{"sendTimeoutSeconds":17}'::jsonb, '2026-01-02T03:04:05Z')
            `
                await client`
                create table rentnerproxy.archive_child_fixture (
                    archive_id uuid primary key references rentnerproxy.proxy_host_legacy_settings(id)
                )
            `
                await client`insert into rentnerproxy.archive_child_fixture values (${archiveId})`
                const before =
                    await client`select * from rentnerproxy.proxy_host_legacy_settings order by id`
                const dependencyBefore = await client`
                select oid, pg_get_constraintdef(oid) as definition from pg_constraint
                where conrelid = 'rentnerproxy.archive_child_fixture'::regclass and contype = 'f'
            `
                expect(dependencyBefore).toHaveLength(1)
                await runMigrate({ databaseUrl, migrationsFolder })
                expect(
                    await client`select * from rentnerproxy.proxy_host_legacy_settings order by id`,
                ).toEqual(before)
                expect(
                    await client`select archive_id from rentnerproxy.archive_child_fixture`,
                ).toEqual([{ archive_id: archiveId }])
                expect(
                    await client`
                select oid, pg_get_constraintdef(oid) as definition from pg_constraint
                where conrelid = 'rentnerproxy.archive_child_fixture'::regclass and contype = 'f'
            `,
                ).toEqual(dependencyBefore)
                await assertArchiveSchema(client)
                await assertHistory(client, (await migrationJournal()).entries.length)
            })
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'archives pre-0012 configuration and retains it through the full upgrade',
        async () => {
            await withIsolatedDatabase(async (client, databaseUrl) => {
                await migratePublishedPrefix(client, 11)
                const hostId = randomUUID()
                const key = `proxy_runtime_host_v1:${hostId}`
                await client`
                insert into rentnerproxy.proxy_hosts
                    (id, forward_scheme, forward_host, forward_port, advanced_config)
                values (${hostId}, 'http', 'legacy.invalid', 8080, 'legacy advanced fixture')
            `
                await client`
                insert into rentnerproxy.system_settings (key, value)
                values (${key}, '{"httpSettings":{"sendTimeoutSeconds":17,"keepaliveTimeoutSeconds":23,"retained":true}}'::jsonb)
            `
                await runMigrate({ databaseUrl, migrationsFolder })
                expect(
                    await client`
                select proxy_host_id, advanced_config, unsupported_settings
                from rentnerproxy.proxy_host_legacy_settings
            `,
                ).toEqual([
                    {
                        proxy_host_id: hostId,
                        advanced_config: 'legacy advanced fixture',
                        unsupported_settings: {
                            sendTimeoutSeconds: 17,
                            keepaliveTimeoutSeconds: 23,
                        },
                    },
                ])
                expect(
                    await client`select value from rentnerproxy.system_settings where key = ${key}`,
                ).toEqual([{ value: { httpSettings: { retained: true } } }])
                await assertHistory(client, (await migrationJournal()).entries.length)
            })
        },
        { timeout: 30_000 },
    )

    integrationTest(
        'recreates a missing archive with genuine 0026 migration history',
        async () => {
            await withIsolatedDatabase(async (client, databaseUrl) => {
                await migratePublishedPrefix(client, 26)
                await client`drop table rentnerproxy.proxy_host_legacy_settings`
                await runMigrate({ databaseUrl, migrationsFolder })
                await assertArchiveSchema(client)
                await assertHistory(client, (await migrationJournal()).entries.length)
            })
        },
        { timeout: 30_000 },
    )
})
