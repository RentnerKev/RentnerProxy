import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import { validateDatabaseEnvironment } from '../server/env.server'
import * as schema from './schema'

const { DATABASE_URL } = validateDatabaseEnvironment()
const developmentGlobal = globalThis as typeof globalThis & {
    rentnerproxyDatabaseClient?: { url: string; client: SQL }
}
const cached =
    process.env.NODE_ENV === 'production' ? undefined : developmentGlobal.rentnerproxyDatabaseClient
if (cached && cached.url !== DATABASE_URL) void cached.client.close().catch(() => undefined)
const client = cached?.url === DATABASE_URL ? cached.client : new SQL(DATABASE_URL)
if (process.env.NODE_ENV !== 'production') {
    developmentGlobal.rentnerproxyDatabaseClient = { url: DATABASE_URL, client }
}
export const db = drizzle(client, { schema })
