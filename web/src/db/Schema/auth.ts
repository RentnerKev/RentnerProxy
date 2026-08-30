import { sql } from 'drizzle-orm'
import {
    bigint,
    boolean,
    check,
    index,
    jsonb,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'
import { bytea } from './columns'
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
        reauthenticatedAt: timestamp('reauthenticated_at', {
            withTimezone: true,
            mode: 'date',
        })
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

export const userTotpFactors = rentnerProxySchema.table(
    'user_totp_factors',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        secretCiphertext: bytea('secret_ciphertext').notNull(),
        secretIv: bytea('secret_iv').notNull(),
        lastUsedCounter: bigint('last_used_counter', { mode: 'number' }).notNull().default(-1),
        enabledAt: timestamp('enabled_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('user_totp_factors_user_id_unique_idx').on(table.userId),
        check(
            'user_totp_factors_secret_iv_length_check',
            sql`octet_length(${table.secretIv}) = 12`,
        ),
        check('user_totp_factors_last_used_counter_check', sql`${table.lastUsedCounter} >= -1`),
    ],
)

export const userRecoveryCodes = rentnerProxySchema.table(
    'user_recovery_codes',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        codeHash: varchar('code_hash', { length: 64 }).notNull(),
        usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('user_recovery_codes_user_id_code_hash_unique_idx').on(
            table.userId,
            table.codeHash,
        ),
        index('user_recovery_codes_user_id_idx').on(table.userId),
    ],
)

export const passkeys = rentnerProxySchema.table(
    'passkeys',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 100 }).notNull(),
        credentialId: text('credential_id').notNull(),
        publicKey: bytea('public_key').notNull(),
        counter: bigint('counter', { mode: 'number' }).notNull().default(0),
        transports: jsonb('transports').$type<Array<string>>().notNull().default([]),
        deviceType: varchar('device_type', { length: 32 }).notNull(),
        backedUp: boolean('backed_up').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    },
    (table) => [
        uniqueIndex('passkeys_credential_id_unique_idx').on(table.credentialId),
        index('passkeys_user_id_idx').on(table.userId),
        check('passkeys_counter_check', sql`${table.counter} >= 0`),
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
        index('password_reset_tokens_user_id_idx').on(table.userId),
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
