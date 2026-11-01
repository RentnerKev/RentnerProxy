import { SQL } from 'bun'
import { BACKUPS_LOCAL_DEMO_KEY } from '../../web/src/config/backups.config.ts'
import {
    createDemoBackupStatus,
    isLocalBackupDemoEnvironment,
} from '../../web/src/lib/Backups/demoStatus.ts'
import { managedBackupStatusSchema } from '../../web/src/lib/Backups/validation.ts'

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL
    if (
        !databaseUrl ||
        !isLocalBackupDemoEnvironment({
            ...process.env,
            NODE_ENV: process.env.NODE_ENV ?? 'development',
        })
    ) {
        console.error('Backup demo data can only be seeded into a loopback development database.')
        process.exitCode = 1
        return
    }
    const status = managedBackupStatusSchema.parse(createDemoBackupStatus())
    const database = new SQL(databaseUrl)
    let operation = 'write'
    try {
        await database.unsafe(
            'insert into rentnerproxy.system_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()',
            [BACKUPS_LOCAL_DEMO_KEY, JSON.stringify(status)],
        )
        operation = 'verify'
        const [saved] = await database.unsafe<{ value: unknown }[]>(
            'select value from rentnerproxy.system_settings where key = $1',
            [BACKUPS_LOCAL_DEMO_KEY],
        )
        const verified = managedBackupStatusSchema.parse(
            typeof saved?.value === 'string' ? JSON.parse(saved.value) : saved?.value,
        )
        if (verified.jobs.length !== status.jobs.length)
            throw new Error('Demo data verification failed.')
        console.log(
            `Saved and verified ${verified.jobs.length} synthetic backup jobs in local PostgreSQL.`,
        )
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        console.error(
            `Unable to ${operation} backup demo data in local PostgreSQL.`,
            error instanceof Error ? error.name : typeof error,
            error instanceof Error && error.message === 'Demo data verification failed.'
                ? 'readback_count_mismatch'
                : '',
            typeof code === 'string' && /^[A-Z0-9_]{2,64}$/u.test(code) ? code : 'unknown error',
        )
        process.exitCode = 1
    } finally {
        await database.close()
    }
}

if (import.meta.main) await main()
