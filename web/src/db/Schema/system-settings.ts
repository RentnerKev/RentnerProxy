import { sql } from 'drizzle-orm'
import type { PgSchema } from 'drizzle-orm/pg-core'
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export function defineSystemSettings(schema: PgSchema) {
    return schema.table('system_settings', {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        key: text('key').notNull().unique(),
        value: jsonb('value').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    })
}
