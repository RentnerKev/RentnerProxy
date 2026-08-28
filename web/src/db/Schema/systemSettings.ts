import { sql } from 'drizzle-orm'
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'

export const systemSettings = rentnerProxySchema.table('system_settings', {
    id: uuid('id')
        .primaryKey()
        .default(sql`uuidv7()`),
    key: text('key').notNull().unique(),
    value: jsonb('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
