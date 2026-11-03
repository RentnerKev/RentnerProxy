import { afterEach, describe, expect, mock, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createCipheriv, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { coverageFixtureSource } from '@/tests/Helpers/coverageFixture.ts'

const prefix = join(tmpdir(), 'rentnerproxy-validate-backup-coverage-')
const directories: string[] = []
const rows = new Map<string, unknown[]>()
let closed = 0
mock.module('rentnerproxy-coverage-sql-fixture', () => ({
    SQL: function () {
        return Object.assign(
            async (query: TemplateStringsArray) => {
                const entry = [...rows.entries()].find(([table]) => query.join('').includes(table))
                if (!entry) throw new Error('Unexpected fixture SQL query.')
                return entry[1]
            },
            {
                close: async () => {
                    closed += 1
                },
            },
        )
    },
}))
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(async (directory) => {
            if (!resolve(directory).startsWith(resolve(prefix)))
                throw new Error('Unsafe fixture cleanup.')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

const id = '0198d98a-0000-7000-8000-000000000881'
const key = Buffer.alloc(32, 6)
function encrypted(context: string) {
    const iv = Buffer.alloc(12, 7)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(context))
    const ciphertext = Buffer.concat([
        cipher.update('synthetic fixture secret'),
        cipher.final(),
        cipher.getAuthTag(),
    ])
    return { iv, ciphertext }
}

async function fixture(database = true) {
    rows.clear()
    closed = 0
    const directory = await mkdtemp(prefix)
    directories.push(directory)
    const backup = join(directory, 'backup')
    const archive = join(directory, 'archive')
    const migrations = join(directory, 'migrations')
    await Promise.all([
        mkdir(backup),
        mkdir(join(archive, 'data'), { recursive: true }),
        mkdir(join(archive, 'credentials'), { recursive: true }),
        mkdir(join(archive, 'bouncer'), { recursive: true }),
        mkdir(join(migrations, 'meta'), { recursive: true }),
    ])
    const migration = Buffer.from('synthetic migration fixture')
    await Promise.all([
        writeFile(join(migrations, 'fixture.sql'), migration),
        writeFile(
            join(migrations, 'meta/_journal.json'),
            JSON.stringify({ entries: [{ tag: 'fixture', when: 1 }] }),
        ),
        writeFile(join(backup, 'metadata.json'), JSON.stringify({ version: 4 })),
        writeFile(join(backup, 'app-encryption-key'), key.toString('base64')),
        writeFile(
            join(archive, 'credentials/local_api_credentials.yaml'),
            'url: http://127.0.0.1:18080\nlogin: synthetic\npassword: synthetic-fixture\n',
        ),
        writeFile(join(archive, 'bouncer/caddy-bouncer-key'), 'a'.repeat(64)),
    ])
    if (database) {
        const sqlite = new Database(join(archive, 'data/crowdsec.db'))
        try {
            sqlite.run('CREATE TABLE fixture (id INTEGER PRIMARY KEY)')
        } finally {
            sqlite.close()
        }
    }
    const pack = async () => {
        const child = Bun.spawn(
            ['tar', '-cf', join(backup, 'crowdsec-state.tar'), '-C', archive, '.'],
            { stdout: 'ignore', stderr: 'pipe' },
        )
        const [status, stderr] = await Promise.all([
            child.exited,
            new Response(child.stderr).text(),
        ])
        expect(status, stderr).toBe(0)
    }
    await pack()
    const totp = encrypted('rentnerproxy:totp:' + id)
    const certificate = encrypted('certificate-binding-job:' + id)
    const notification = encrypted('rentnerproxy:notifications:v1:' + id)
    const crowdsec = encrypted('crowdsec_configuration_v1:external_api_key')
    rows.set('drizzle.__drizzle_migrations', [
        { hash: createHash('sha256').update(migration).digest('hex'), created_at: 1 },
    ])
    rows.set('rentnerproxy.user_totp_factors', [
        { user_id: id, secret_ciphertext: totp.ciphertext, secret_iv: totp.iv },
    ])
    rows.set('rentnerproxy.certificate_binding_jobs', [
        { id, request_ciphertext: certificate.ciphertext, request_iv: certificate.iv },
    ])
    rows.set("key = 'notification_configuration_v1'", [
        {
            value: {
                version: 1,
                revision: 1,
                enabled: false,
                pausedAfterRestore: true,
                channels: [
                    {
                        id,
                        destination: {
                            ciphertext: notification.ciphertext.toString('base64url'),
                            iv: notification.iv.toString('base64url'),
                        },
                    },
                ],
            },
        },
    ])
    rows.set("key = 'crowdsec_configuration_v1'", [
        {
            value: JSON.stringify({
                mode: database ? 'managed' : 'external',
                external: {
                    apiKey: {
                        ciphertext: crowdsec.ciphertext.toString('base64url'),
                        iv: crowdsec.iv.toString('base64url'),
                    },
                },
            }),
        },
    ])
    const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
    const original = await coverageFixtureSource('docker/web/validate-backup.ts')
    const source = original
        .replace(/from\s*(['"])bun\1/gu, "from 'rentnerproxy-coverage-sql-fixture'")
        .replaceAll('/opt/rentnerproxy/web/web/drizzle', migrations.replaceAll('\\', '/'))
        .replaceAll(
            '../../web/src/lib/ApplicationVersion/backupCompatibility.ts',
            pathToFileURL(join(root, 'web/src/lib/ApplicationVersion/backupCompatibility.ts')).href,
        )
    const modulePath = join(directory, 'validate.ts')
    await writeFile(modulePath, source)
    const module = (await import(
        pathToFileURL(modulePath).href
    )) as typeof import('../../../../../../docker/web/validate-backup.ts')
    return {
        directory,
        backup,
        archive,
        migrations,
        pack,
        validate: () =>
            module.validateDatabase(
                backup,
                1,
                join(directory, 'extracted'),
                join(directory, 'no-live-postgres-socket'),
            ),
    }
}

describe('backup database validation with isolated storage and injected SQL rows', () => {
    test('authenticates stored secrets and verifies a real extracted SQLite database before closing SQL', async () => {
        const context = await fixture()
        await context.validate()
        expect(closed).toBe(1)
        expect(
            await readFile(join(context.directory, 'extracted/bouncer/caddy-bouncer-key'), 'utf8'),
        ).toBe('a'.repeat(64))
    })

    test('accepts an external-only backup without a managed CrowdSec database', async () => {
        const context = await fixture(false)
        await context.validate()
        expect(closed).toBe(1)
    })

    test.each([
        'journal',
        'migration',
        'totp',
        'certificate',
        'notification',
        'crowdsec',
        'archive',
        'credentials',
        'bouncer',
    ])('fails closed for invalid %s evidence and still closes SQL', async (kind) => {
        const context = await fixture()
        if (kind === 'journal')
            await writeFile(join(context.migrations, 'meta/_journal.json'), '{}')
        if (kind === 'migration')
            rows.set('drizzle.__drizzle_migrations', [{ hash: 'wrong', created_at: 1 }])
        if (kind === 'totp')
            rows.set('rentnerproxy.user_totp_factors', [
                { user_id: id, secret_ciphertext: Buffer.alloc(17), secret_iv: Buffer.alloc(12) },
            ])
        if (kind === 'certificate')
            rows.set('rentnerproxy.certificate_binding_jobs', [
                { id, request_ciphertext: Buffer.alloc(17), request_iv: Buffer.alloc(12) },
            ])
        if (kind === 'notification')
            rows.set("key = 'notification_configuration_v1'", [{ value: '{}' }])
        if (kind === 'crowdsec')
            rows.set("key = 'crowdsec_configuration_v1'", [
                { value: { mode: 'external', external: { apiKey: { ciphertext: 1 } } } },
            ])
        if (kind === 'archive')
            await writeFile(join(context.backup, 'crowdsec-state.tar'), 'invalid archive')
        if (kind === 'credentials') {
            await writeFile(
                join(context.archive, 'credentials/local_api_credentials.yaml'),
                'url: https://outside.example.test\nlogin: synthetic\npassword: synthetic\n',
            )
            await context.pack()
        }
        if (kind === 'bouncer') {
            await writeFile(join(context.archive, 'bouncer/caddy-bouncer-key'), 'invalid')
            await context.pack()
        }
        await expect(context.validate()).rejects.toThrow()
        expect(closed).toBe(1)
    })

    test('requires the managed database even when all encrypted configuration secrets authenticate', async () => {
        const context = await fixture(false)
        rows.set("key = 'crowdsec_configuration_v1'", [{ value: { mode: 'managed' } }])
        await expect(context.validate()).rejects.toThrow('managed CrowdSec database is missing')
        expect(closed).toBe(1)
    })
})
