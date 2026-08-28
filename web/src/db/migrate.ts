import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { validateDatabaseEnvironment } from '../server/env.server'

async function runMigrate() {
    const { DATABASE_URL } = validateDatabaseEnvironment()
    const client = new SQL(DATABASE_URL)

    await client`CREATE SCHEMA IF NOT EXISTS "rentnerproxy";`

    const db = drizzle(client)

    console.log('Running migrations...')
    await migrate(db, { migrationsFolder: './web/drizzle' })
    console.log('Migrations completed!')

    await client.close()
}

runMigrate().catch(function (err) {
    console.error('Migration failed!', err)
    process.exit(1)
})
