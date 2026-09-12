import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { ACTIVE_OWNER_ADVISORY_LOCK_ID, MIGRATION_ADVISORY_LOCK_ID } from '../config/auth.config'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { validateDatabaseEnvironment } from '../server/env.server'
import * as schema from './schema'

export interface MigrationOptions {
    readonly databaseUrl?: string
    readonly migrationsFolder?: string
}

type MigrationFailurePhase = 'database connection' | 'schema migration' | 'authorization registry'
const migrationFailurePhases = new WeakMap<object, MigrationFailurePhase>()

function recordMigrationFailurePhase(error: unknown, phase: MigrationFailurePhase): void {
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
        migrationFailurePhases.set(error, phase)
    }
}

function getMigrationFailurePhase(error: unknown): MigrationFailurePhase | undefined {
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
        return migrationFailurePhases.get(error)
    }
    return undefined
}

export async function runMigrate(options: MigrationOptions = {}) {
    const DATABASE_URL = options.databaseUrl ?? validateDatabaseEnvironment().DATABASE_URL
    const migrationsFolder = options.migrationsFolder ?? './web/drizzle'
    const client = new SQL(DATABASE_URL)
    let reserved: Awaited<ReturnType<typeof client.reserve>> | undefined
    let migrationLockHeld = false
    let operationError: unknown
    let cleanupError: unknown
    let failurePhase: MigrationFailurePhase = 'database connection'

    try {
        try {
            reserved = await client.reserve()
            await reserved`select pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_ID})`
            migrationLockHeld = true

            await reserved`CREATE SCHEMA IF NOT EXISTS "rentnerproxy";`

            const db = drizzle(reserved, { schema })

            failurePhase = 'schema migration'
            console.log('Running migrations...')
            await migrate(db, { migrationsFolder })
            console.log('Migrations completed!')

            failurePhase = 'authorization registry'
            await db.transaction(async (transaction) => {
                await transaction.execute(
                    sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`,
                )
                await ensureAuthorizationRegistryInTransaction(transaction)
            })
            console.log('Authorization registry synchronized!')
        } catch (error) {
            recordMigrationFailurePhase(error, failurePhase)
            operationError = error
        }
    } finally {
        if (reserved !== undefined) {
            try {
                if (migrationLockHeld) {
                    const unlockResult = await reserved`
                        select pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_ID}) as unlocked
                    `
                    if (unlockResult[0]?.unlocked !== true) {
                        cleanupError ??= new Error('migration advisory lock was not released')
                    }
                }
            } catch (error) {
                cleanupError ??= error
            } finally {
                try {
                    reserved.release()
                } catch (error) {
                    cleanupError ??= error
                }
            }
        }

        try {
            await client.close()
        } catch (error) {
            cleanupError ??= error
        }
    }

    if (operationError !== undefined) throw operationError
    if (cleanupError !== undefined) throw cleanupError
}

if (import.meta.main) {
    runMigrate().catch(function (error) {
        const phase = getMigrationFailurePhase(error) ?? 'database connection'
        const advice =
            phase === 'database connection'
                ? 'Check DATABASE_URL and database availability, then retry.'
                : phase === 'schema migration'
                  ? 'Inspect the migration state or restore a known-good backup before retrying.'
                  : 'Correct the authorization registry state and retry; restore a known-good backup only if required.'
        console.error(`Migration failed during ${phase}. ${advice}`)
        process.exitCode = 1
    })
}
