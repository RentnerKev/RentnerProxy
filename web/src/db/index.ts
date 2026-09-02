import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import { validateDatabaseEnvironment } from '../server/env.server'
import * as schema from './schema'

const { DATABASE_URL } = validateDatabaseEnvironment()
const client = new SQL(DATABASE_URL)
export const db = drizzle(client, { schema })
