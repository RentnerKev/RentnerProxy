import '@tanstack/react-start/server-only'

import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'

import { getDatabaseUrl } from '../server/env.server'
import * as schema from './index'
import type { DatabaseConnection, DatabaseGlobal } from './Types/client.types'

const databaseGlobal = globalThis as typeof globalThis & DatabaseGlobal
let productionConnection: DatabaseConnection | undefined

function getCachedConnection(): DatabaseConnection | undefined {
    return process.env.NODE_ENV === 'production'
        ? productionConnection
        : databaseGlobal.rentnerproxyDatabaseConnection
}

function cacheConnection(connection: DatabaseConnection): void {
    if (process.env.NODE_ENV === 'production') {
        productionConnection = connection
        return
    }

    databaseGlobal.rentnerproxyDatabaseConnection = connection
}
export function getDatabaseConnection(): DatabaseConnection | null {
    const databaseUrl = getDatabaseUrl()

    if (!databaseUrl) {
        return null
    }

    const cachedConnection = getCachedConnection()

    if (cachedConnection) {
        return cachedConnection
    }

    const client = new SQL({
        adapter: 'postgres',
        url: databaseUrl,
        max: 5,
        idleTimeout: 30,
        maxLifetime: 1_800,
        connectionTimeout: 2,
        connection: { application_name: 'rentnerproxy' },
    })
    const connection = {
        client,
        db: drizzle({ client, schema }),
    }

    cacheConnection(connection)
    return connection
}

export async function closeDatabaseConnection(): Promise<void> {
    const connection = getCachedConnection()

    if (!connection) {
        return
    }

    productionConnection = undefined
    delete databaseGlobal.rentnerproxyDatabaseConnection
    await connection.client.close({ timeout: 5 })
}
