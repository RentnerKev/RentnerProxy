import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import type { AccessPolicyIpRules } from '../../shared/Helpers/ipAccessRules'
import { rentnerProxySchema } from './base'

export const accessPolicyMode = rentnerProxySchema.enum('access_policy_mode', [
    'public',
    'authenticated',
    'ip-restricted',
    'combined',
])

export const accessPolicyCombination = rentnerProxySchema.enum('access_policy_combination', [
    'all',
    'any',
])

export const accessPolicies = rentnerProxySchema.table(
    'access_policies',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        name: varchar('name', { length: 120 }).notNull(),
        description: text('description').notNull().default(''),
        mode: accessPolicyMode('mode').notNull(),
        combination: accessPolicyCombination('combination'),
        ipRules: jsonb('ip_rules')
            .$type<AccessPolicyIpRules | null>()
            .default(sql`null`),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('access_policies_mode_idx').on(table.mode),
        check(
            'access_policies_combination_check',
            sql`(${table.mode} = 'combined' and ${table.combination} is not null) or (${table.mode} <> 'combined' and ${table.combination} is null)`,
        ),
    ],
)
