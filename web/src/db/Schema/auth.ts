import { sql } from 'drizzle-orm'
import { index, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'
import { users } from './users'

export const sessions = rentnerProxySchema.table(
    'sessions',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: varchar('token_hash', { length: 64 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    },
    (table) => [
        uniqueIndex('sessions_token_hash_unique_idx').on(table.tokenHash),
        index('sessions_user_id_idx').on(table.userId),
        index('sessions_expires_at_idx').on(table.expiresAt),
    ],
)

export const passwordResetTokens = rentnerProxySchema.table(
    'password_reset_tokens',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        tokenHash: varchar('token_hash', { length: 64 }).notNull(),
        consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    },
    (table) => [
        uniqueIndex('password_reset_tokens_user_id_unique_idx').on(table.userId),
        uniqueIndex('password_reset_tokens_token_hash_unique_idx').on(table.tokenHash),
        index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
    ],
)

export const userInvites = rentnerProxySchema.table(
    'user_invites',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        tokenHash: varchar('token_hash', { length: 64 }).notNull(),
        acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    },
    (table) => [
        uniqueIndex('user_invites_user_id_unique_idx').on(table.userId),
        uniqueIndex('user_invites_token_hash_unique_idx').on(table.tokenHash),
        index('user_invites_invited_by_user_id_idx').on(table.invitedByUserId),
        index('user_invites_expires_at_idx').on(table.expiresAt),
    ],
)
