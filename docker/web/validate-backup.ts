// oxlint-disable no-await-in-loop -- Every stored secret and migration is checked before replacement.
import { SQL } from 'bun'
import { Database } from 'bun:sqlite'
import { createDecipheriv, createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
    isSupportedBackupVersion,
    supportedBackupFormatLabel,
} from '../../web/src/lib/ApplicationVersion/backupCompatibility.ts'
import type {
    BackupCertificateJobRow,
    BackupCrowdSecSettingRow,
    BackupMigrationJournal,
    BackupMigrationRow,
    BackupTotpSecretRow,
} from './Types/validate-backup.types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isMigrationJournal(value: unknown): value is BackupMigrationJournal {
    return (
        isRecord(value) &&
        Array.isArray(value.entries) &&
        value.entries.every(
            (entry: unknown) =>
                isRecord(entry) && typeof entry.tag === 'string' && typeof entry.when === 'number',
        )
    )
}

export async function assertCompatibleBackupHistory(
    rows: readonly BackupMigrationRow[],
    journal: BackupMigrationJournal,
    readMigration: (tag: string) => Promise<Uint8Array>,
): Promise<void> {
    if (rows.length === 0 || rows.length > journal.entries.length) {
        throw new Error('unsupported backup database version')
    }
    for (const [index, row] of rows.entries()) {
        const migration = journal.entries[index]
        if (!migration) {
            throw new Error('backup migration history is incompatible with the target image')
        }
        const expected = createHash('sha256')
            .update(await readMigration(migration.tag))
            .digest('hex')
        if (row.hash !== expected || String(row.created_at) !== String(migration.when)) {
            throw new Error('backup migration history is incompatible with the target image')
        }
    }
}

export function decryptBackupSecret(
    key: Buffer,
    ciphertext: Buffer,
    iv: Buffer,
    context: string,
): void {
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

const unsupportedBackupVersion = `unsupported backup metadata version (supported: ${supportedBackupFormatLabel()})`

export function assertSupportedBackupVersion(metadata: unknown): void {
    if (!isRecord(metadata) || !isSupportedBackupVersion(metadata.version)) {
        throw new Error(unsupportedBackupVersion)
    }
}

export function validateNotificationBackupSecrets(key: Buffer, input: unknown): void {
    try {
        if (typeof input === 'string' && input.length > 2 * 1_024 * 1_024) throw new Error()
        const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
        if (
            !isRecord(value) ||
            JSON.stringify(value).length > 2 * 1_024 * 1_024 ||
            value.version !== 1 ||
            typeof value.revision !== 'number' ||
            !Number.isSafeInteger(value.revision) ||
            value.revision < 0 ||
            value.revision > 4_294_967_295 ||
            typeof value.enabled !== 'boolean' ||
            typeof value.pausedAfterRestore !== 'boolean' ||
            !Array.isArray(value.channels) ||
            value.channels.length > 256
        )
            throw new Error()
        const ids = new Set<string>()
        for (const channel of value.channels) {
            if (
                !isRecord(channel) ||
                typeof channel.id !== 'string' ||
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(
                    channel.id,
                ) ||
                ids.has(channel.id) ||
                !isRecord(channel.destination)
            )
                throw new Error()
            ids.add(channel.id)
            const { ciphertext, iv } = channel.destination
            if (
                typeof ciphertext !== 'string' ||
                ciphertext.length > 65_536 ||
                !/^[A-Za-z0-9_-]+$/u.test(ciphertext) ||
                typeof iv !== 'string' ||
                iv.length !== 16 ||
                !/^[A-Za-z0-9_-]+$/u.test(iv)
            )
                throw new Error()
            const encrypted = Buffer.from(ciphertext, 'base64url')
            const nonce = Buffer.from(iv, 'base64url')
            if (
                encrypted.toString('base64url') !== ciphertext ||
                nonce.toString('base64url') !== iv
            )
                throw new Error()
            decryptBackupSecret(
                key,
                encrypted,
                nonce,
                'rentnerproxy:notifications:v1:' + channel.id,
            )
        }
    } catch {
        throw new Error('invalid encrypted notification backup configuration')
    }
}

async function validateDatabase(): Promise<void> {
    const metadata: unknown = JSON.parse(await readFile('/backup/metadata.json', 'utf8'))
    assertSupportedBackupVersion(metadata)
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
        const journal: unknown = JSON.parse(
            await readFile(join(migrationsPath, 'meta/_journal.json'), 'utf8'),
        )
        if (!isMigrationJournal(journal)) {
            throw new Error('backup migration history is incompatible with the target image')
        }
        const rows = await sql<
            BackupMigrationRow[]
        >`select hash, created_at from drizzle.__drizzle_migrations order by id`
        await assertCompatibleBackupHistory(rows, journal, (tag) =>
            readFile(join(migrationsPath, tag + '.sql')),
        )
        const factors = await sql<
            BackupTotpSecretRow[]
        >`select user_id, secret_ciphertext, secret_iv from rentnerproxy.user_totp_factors`
        for (const row of factors) {
            decryptBackupSecret(
                key,
                Buffer.from(row.secret_ciphertext),
                Buffer.from(row.secret_iv),
                'rentnerproxy:totp:' + row.user_id,
            )
        }
        const jobs = await sql<
            BackupCertificateJobRow[]
        >`select id, request_ciphertext, request_iv from rentnerproxy.certificate_binding_jobs where request_ciphertext is not null`
        for (const row of jobs) {
            decryptBackupSecret(
                key,
                Buffer.from(row.request_ciphertext),
                Buffer.from(row.request_iv),
                'certificate-binding-job:' + row.id,
            )
        }
        let requiresCrowdSecDatabase = false
        const notificationSettings = await sql<
            { value: unknown }[]
        >`select value from rentnerproxy.system_settings where key = 'notification_configuration_v1'`
        for (const row of notificationSettings) validateNotificationBackupSecrets(key, row.value)
        const settings = await sql<
            BackupCrowdSecSettingRow[]
        >`select value from rentnerproxy.system_settings where key = 'crowdsec_configuration_v1'`
        for (const row of settings) {
            const value: unknown = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
            if (!isRecord(value)) throw new Error('invalid encrypted backup secret')
            requiresCrowdSecDatabase = value.mode === 'managed'
            const apiKey = isRecord(value.external) ? value.external.apiKey : undefined
            if (apiKey) {
                if (
                    !isRecord(apiKey) ||
                    typeof apiKey.ciphertext !== 'string' ||
                    typeof apiKey.iv !== 'string'
                ) {
                    throw new Error('invalid encrypted backup secret')
                }
                decryptBackupSecret(
                    key,
                    Buffer.from(apiKey.ciphertext, 'base64url'),
                    Buffer.from(apiKey.iv, 'base64url'),
                    'crowdsec_configuration_v1:external_api_key',
                )
            }
        }
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
                const result = crowdSec
                    .query<{ quick_check: unknown }, []>('PRAGMA quick_check')
                    .all()
                if (result.length !== 1 || result[0]?.quick_check !== 'ok')
                    throw new Error('invalid CrowdSec database')
            } finally {
                crowdSec.close()
            }
            const credentials: unknown = Bun.YAML.parse(
                await readFile(
                    '/tmp/backup-crowdsec/credentials/local_api_credentials.yaml',
                    'utf8',
                ),
            )
            if (
                !isRecord(credentials) ||
                typeof credentials.url !== 'string' ||
                !['http://127.0.0.1:18080', 'http://127.0.0.1:18080/'].includes(credentials.url) ||
                typeof credentials.login !== 'string' ||
                !credentials.login ||
                typeof credentials.password !== 'string' ||
                !credentials.password
            )
                throw new Error('invalid CrowdSec local credentials')
            const bouncerKey = (
                await readFile('/tmp/backup-crowdsec/bouncer/caddy-bouncer-key', 'utf8')
            ).trim()
            if (!/^[a-f0-9]{64}$/u.test(bouncerKey)) throw new Error('invalid CrowdSec bouncer key')
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
        const failures: Readonly<Record<string, string>> = {
            'unsupported backup database version': 'database_version',
            'backup migration history is incompatible with the target image': 'migration_history',
            [unsupportedBackupVersion]: 'database_version',
            'invalid encrypted backup secret': 'application_key',
            'invalid encrypted notification backup configuration': 'application_key',
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
