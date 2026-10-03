// oxlint-disable no-await-in-loop -- Every stored secret and migration is checked before replacement.
import { SQL } from 'bun'
import { Database } from 'bun:sqlite'
import { createDecipheriv, createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

function decryptBackupSecret(key, ciphertext, iv, context) {
    if (key.length !== 32 || iv.length !== 12 || ciphertext.length < 17) {
        throw new Error('invalid encrypted backup secret')
    }
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAAD(Buffer.from(context, 'utf8'))
        decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16))
        decipher.update(ciphertext.subarray(0, -16))
        decipher.final()
    } catch {
        throw new Error('backup application key cannot decrypt persisted secrets')
    }
}

async function validateDatabase() {
    const key = Buffer.from((await readFile('/backup/app-encryption-key', 'utf8')).trim(), 'base64')
    const sql = new SQL({
        hostname: '127.0.0.1',
        port: 5432,
        password: '',
        tls: false,
        connectionTimeout: 10,
        database: 'rentnerproxy',
        username: 'postgres',
        max: 1,
    })
    try {
        const migrationsPath = '/opt/rentnerproxy/web/web/drizzle'
        const journal = JSON.parse(
            await readFile(join(migrationsPath, 'meta/_journal.json'), 'utf8'),
        )
        const rows =
            await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`
        if (rows.length < 20 || rows.length > journal.entries.length) {
            throw new Error('unsupported backup database version')
        }
        for (const [index, row] of rows.entries()) {
            const migration = journal.entries[index]
            const expected = createHash('sha256')
                .update(await readFile(join(migrationsPath, migration.tag + '.sql')))
                .digest('hex')
            if (row.hash !== expected || String(row.created_at) !== String(migration.when)) {
                throw new Error('backup migration history is incompatible with the target image')
            }
        }
        const metadata = JSON.parse(await readFile('/backup/metadata.json', 'utf8'))
        if (metadata.version === 3 && rows.length !== 20) {
            throw new Error('v3 restore supports published alpha.4, alpha.5 and alpha.6 only')
        }
        if (metadata.version === 4 && rows.length !== journal.entries.length) {
            throw new Error('v4 restore requires the current target database version')
        }
        const factors =
            await sql`select user_id, secret_ciphertext, secret_iv from rentnerproxy.user_totp_factors`
        for (const row of factors) {
            decryptBackupSecret(
                key,
                Buffer.from(row.secret_ciphertext),
                Buffer.from(row.secret_iv),
                'rentnerproxy:totp:' + row.user_id,
            )
        }
        const jobs =
            await sql`select id, request_ciphertext, request_iv from rentnerproxy.certificate_binding_jobs where request_ciphertext is not null`
        for (const row of jobs) {
            decryptBackupSecret(
                key,
                Buffer.from(row.request_ciphertext),
                Buffer.from(row.request_iv),
                'certificate-binding-job:' + row.id,
            )
        }
        let requiresCrowdSecDatabase = false
        if (metadata.version === 4) {
            const settings =
                await sql`select value from rentnerproxy.system_settings where key = 'crowdsec_configuration_v1'`
            for (const row of settings) {
                const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
                requiresCrowdSecDatabase = value.mode === 'managed'
                if (value.external?.apiKey) {
                    decryptBackupSecret(
                        key,
                        Buffer.from(value.external.apiKey.ciphertext, 'base64url'),
                        Buffer.from(value.external.apiKey.iv, 'base64url'),
                        'crowdsec_configuration_v1:external_api_key',
                    )
                }
            }
        }
        if (metadata.version === 4) {
            await mkdir('/tmp/backup-crowdsec', { mode: 0o700 })
            const child = Bun.spawn(
                [
                    'tar',
                    '--extract',
                    '--no-same-owner',
                    '--no-same-permissions',
                    '--file=/backup/crowdsec-state.tar',
                    '--directory=/tmp/backup-crowdsec',
                ],
                { stdout: 'ignore', stderr: 'ignore' },
            )
            if ((await child.exited) !== 0) throw new Error('invalid CrowdSec archive')
            const dbPath = '/tmp/backup-crowdsec/data/crowdsec.db'
            const dbExists = await stat(dbPath).catch(() => null)
            if (!dbExists && requiresCrowdSecDatabase)
                throw new Error('managed CrowdSec database is missing')
            if (dbExists) {
                const crowdSec = new Database(dbPath, { readonly: true })
                try {
                    const result = crowdSec.query('PRAGMA quick_check').all()
                    if (result.length !== 1 || result[0].quick_check !== 'ok')
                        throw new Error('invalid CrowdSec database')
                } finally {
                    crowdSec.close()
                }
                const credentials = Bun.YAML.parse(
                    await readFile(
                        '/tmp/backup-crowdsec/credentials/local_api_credentials.yaml',
                        'utf8',
                    ),
                )
                if (
                    !['http://127.0.0.1:18080', 'http://127.0.0.1:18080/'].includes(
                        credentials.url,
                    ) ||
                    typeof credentials.login !== 'string' ||
                    !credentials.login ||
                    typeof credentials.password !== 'string' ||
                    !credentials.password
                )
                    throw new Error('invalid CrowdSec local credentials')
                const bouncerKey = (
                    await readFile('/tmp/backup-crowdsec/bouncer/caddy-bouncer-key', 'utf8')
                ).trim()
                if (!/^[a-f0-9]{64}$/u.test(bouncerKey))
                    throw new Error('invalid CrowdSec bouncer key')
            }
        }
        console.log('Backup database version and encrypted secrets verified.')
    } finally {
        await sql.close()
    }
}

if (import.meta.main) {
    try {
        await validateDatabase()
    } catch (error) {
        const failures = {
            'unsupported backup database version': 'database_version',
            'backup migration history is incompatible with the target image': 'migration_history',
            'v3 restore supports published alpha.4, alpha.5 and alpha.6 only': 'database_version',
            'v4 restore requires the current target database version': 'database_version',
            'invalid encrypted backup secret': 'application_key',
            'backup application key cannot decrypt persisted secrets': 'application_key',
            'invalid CrowdSec archive': 'crowdsec_archive',
            'managed CrowdSec database is missing': 'crowdsec_database',
            'invalid CrowdSec database': 'crowdsec_database',
            'invalid CrowdSec local credentials': 'crowdsec_credentials',
            'invalid CrowdSec bouncer key': 'crowdsec_credentials',
        }
        const reason =
            error instanceof Error
                ? (failures[error.message] ?? 'runtime_validation')
                : 'runtime_validation'
        console.error('BACKUP_VALIDATION=' + reason)
        console.error('Backup database version or application encryption key is incompatible.')
        process.exitCode = 1
    }
}
