import { fileURLToPath } from 'node:url'

import { migrate } from 'drizzle-orm/bun-sql/migrator'

import { logger } from '../../../scripts/logger'
import { closeDatabaseConnection, getDatabaseConnection } from './client.server'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export async function runDatabaseMigrations(): Promise<number> {
    let connection: ReturnType<typeof getDatabaseConnection>

    try {
        connection = getDatabaseConnection()
    } catch {
        logger.fail('Database configuration is invalid')
        return 1
    }

    if (!connection) {
        logger.fail('DATABASE_URL is missing or invalid')
        return 1
    }

    logger.info('Applying database migrations with Bun SQL')
    let failed = false

    try {
        await migrate(connection.db, {
            migrationsFolder,
            migrationsSchema: 'drizzle',
            migrationsTable: '__drizzle_migrations',
        })
    } catch {
        logger.fail('Database migration failed')
        failed = true
    }

    try {
        await closeDatabaseConnection()
    } catch {
        logger.fail('Database connection could not be closed cleanly')
        failed = true
    }

    if (failed) {
        return 1
    }

    logger.done('Database migrations applied')
    return 0
}

if (import.meta.main) {
    process.exitCode = await runDatabaseMigrations()
}
