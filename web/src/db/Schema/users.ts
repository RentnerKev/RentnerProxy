import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    index,
    integer,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'

import { USER_STATUSES } from '../../config/auth.config'
import { DEFAULT_USER_THEME_MODE } from '../../config/theme.config'
import { rentnerProxySchema } from './base'
import { bytea } from './columns'

export const userStatus = rentnerProxySchema.enum('user_status', USER_STATUSES)
export const users = rentnerProxySchema.table(
    'users',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        displayName: varchar('display_name', { length: 100 }).notNull(),
        email: varchar('email', { length: 254 }).notNull(),
        emailVerifiedAt: timestamp('email_verified_at', {
            withTimezone: true,
            mode: 'date',
        }),
        mustChangePassword: boolean('must_change_password').notNull().default(true),
        passwordHash: text('password_hash'),
        profileImageVersion: integer('profile_image_version').notNull().default(0),
        profileImageWebp: bytea('profile_image_webp'),
        status: userStatus('status').notNull().default('pending'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('users_email_lower_unique_idx').on(sql`lower(${table.email})`),
        index('users_status_idx').on(table.status),
    ],
)

export const userSettings = rentnerProxySchema.table(
    'user_settings',
    {
        userId: uuid('user_id')
            .primaryKey()
            .references(() => users.id, { onDelete: 'cascade' }),
        themeMode: varchar('theme_mode', { length: 20 }).notNull().default(DEFAULT_USER_THEME_MODE),
    },
    (table) => [
        check('user_settings_theme_mode_check', sql`${table.themeMode} in ('light', 'dark')`),
    ],
)
