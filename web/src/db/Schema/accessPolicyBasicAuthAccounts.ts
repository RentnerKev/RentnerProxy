import { sql } from 'drizzle-orm'
import { index, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'
import { accessPolicies } from './accessPolicies'

export const accessPolicyBasicAuthAccounts = rentnerProxySchema.table(
    'access_policy_basic_auth_accounts',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        policyId: uuid('policy_id')
            .notNull()
            .references(() => accessPolicies.id, { onDelete: 'cascade' }),
        username: varchar('username', { length: 64 }).notNull(),
        passwordHash: varchar('password_hash', { length: 255 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('access_policy_basic_auth_accounts_policy_id_idx').on(table.policyId),
        uniqueIndex('access_policy_basic_auth_accounts_policy_username_unique').on(
            table.policyId,
            table.username,
        ),
    ],
)
