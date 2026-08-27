import type { SQL } from 'bun'
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql'

import type * as schema from '../index'

export interface DatabaseConnection {
    readonly client: SQL
    readonly db: BunSQLDatabase<typeof schema>
}

export interface DatabaseGlobal {
    rentnerproxyDatabaseConnection?: DatabaseConnection
}
