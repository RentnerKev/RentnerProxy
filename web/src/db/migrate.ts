import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { ACTIVE_OWNER_ADVISORY_LOCK_ID } from '../config/auth.config'
import { ensureAuthorizationRegistryInTransaction } from '../server/Auth/Access/registry.service'
import { validateDatabaseEnvironment } from '../server/env.server'
import * as schema from './schema'

async function runMigrate() {
    const { DATABASE_URL } = validateDatabaseEnvironment()
    const client = new SQL(DATABASE_URL)

    await client`CREATE SCHEMA IF NOT EXISTS "rentnerproxy";`

    const db = drizzle(client, { schema })

    console.log('Running migrations...')
    await migrate(db, { migrationsFolder: './web/drizzle' })
    console.log('Migrations completed!')

    await db.transaction(async (transaction) => {
        await transaction.execute(
            sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`,
        )
        await ensureAuthorizationRegistryInTransaction(transaction)
    })
    console.log('Authorization registry synchronized!')

    await client.close()
}

runMigrate().catch(function (err) {
    console.error('Migration failed!', err)
    process.exit(1)
})
