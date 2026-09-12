import { sql } from 'drizzle-orm'
import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { rentnerProxySchema } from './base'

export const proxyHostLegacySettings = rentnerProxySchema.table('proxy_host_legacy_settings', {
    id: uuid('id')
        .primaryKey()
        .default(sql`uuidv7()`),
    proxyHostId: uuid('proxy_host_id').notNull(),
    advancedConfig: text('advanced_config'),
    unsupportedSettings: jsonb('unsupported_settings'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' })
        .notNull()
        .defaultNow(),
})
