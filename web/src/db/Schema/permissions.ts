import { sql } from 'drizzle-orm'
import { boolean, index, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

import { rentnerProxySchema } from './base'
import { users } from './users'

export const roles = rentnerProxySchema.table(
    'roles',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        key: varchar('key', { length: 100 }).notNull().unique(),
        name: varchar('name', { length: 100 }).notNull(),
        description: text('description').notNull().default(''),
        isSystem: boolean('is_system').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [index('roles_is_system_idx').on(table.isSystem)],
)

export const permissions = rentnerProxySchema.table('permissions', {
    id: uuid('id')
        .primaryKey()
        .default(sql`uuidv7()`),
    key: varchar('key', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const rolePermissions = rentnerProxySchema.table(
    'role_permissions',
    {
        roleId: uuid('role_id')
            .notNull()
            .references(() => roles.id, { onDelete: 'cascade' }),
        permissionId: uuid('permission_id')
            .notNull()
            .references(() => permissions.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.roleId, table.permissionId] }),
        index('role_permissions_permission_id_idx').on(table.permissionId),
    ],
)

export const userRoles = rentnerProxySchema.table(
    'user_roles',
    {
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        roleId: uuid('role_id')
            .notNull()
            .references(() => roles.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        primaryKey({ columns: [table.userId, table.roleId] }),
        index('user_roles_role_id_idx').on(table.roleId),
    ],
)
