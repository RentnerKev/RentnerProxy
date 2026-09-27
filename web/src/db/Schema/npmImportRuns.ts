import { sql } from 'drizzle-orm'
import { check, index, jsonb, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'
import { users } from './users'

export const npmImportRuns = rentnerProxySchema.table(
    'npm_import_runs',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
        sourceFingerprint: varchar('source_fingerprint', { length: 64 }).notNull(),
        sourceSchema: varchar('source_schema', { length: 32 }).notNull(),
        result: jsonb('result').notNull(),
        runtimeStatus: varchar('runtime_status', { length: 16 }).notNull().default('pending'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('npm_import_runs_created_at_idx').on(table.createdAt),
        index('npm_import_runs_fingerprint_idx').on(table.sourceFingerprint),
        check(
            'npm_import_runs_fingerprint_check',
            sql`${table.sourceFingerprint} ~ '^[a-f0-9]{64}$'`,
        ),
        check(
            'npm_import_runs_runtime_status_check',
            sql`${table.runtimeStatus} in ('applied', 'pending', 'not_applicable')`,
        ),
    ],
)
