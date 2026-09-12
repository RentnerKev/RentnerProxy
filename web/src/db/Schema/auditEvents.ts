import { sql } from 'drizzle-orm'
import { check, index, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core'

import type { AuditMetadata } from '../../shared/Types/audit-events.types'
import { rentnerProxySchema } from './base'

export const auditActorKind = rentnerProxySchema.enum('audit_actor_kind', [
    'user',
    'anonymous',
    'system',
])
export const auditAction = rentnerProxySchema.enum('audit_action', [
    'login',
    'logout',
    'create',
    'update',
    'delete',
    'enable',
    'disable',
    'rotate',
    'reset',
    'accept',
    'reauthenticate',
    'import',
    'replace',
    'request',
    'renew',
    'save',
    'apply',
    'accepted',
    'started',
    'issued',
    'activated',
    'renewed',
    'retry_scheduled',
    'failed',
])
export const auditResource = rentnerProxySchema.enum('audit_resource', [
    'session',
    'password',
    'totp',
    'recovery-codes',
    'passkey',
    'invite',
    'setup',
    'security-settings',
    'user',
    'role',
    'proxy-host',
    'redirect-host',
    'access-policy',
    'basic-auth-account',
    'certificate',
    'trusted-ca',
    'proxy-runtime-settings',
    'proxy-host-settings',
    'proxy-runtime',
])
export const auditResult = rentnerProxySchema.enum('audit_result', ['success', 'failure', 'denied'])

export const auditEvents = rentnerProxySchema.table(
    'audit_events',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        // Deliberately no FK: audit history must survive user deletion.
        actorUserId: uuid('actor_user_id'),
        actorKind: auditActorKind('actor_kind').notNull(),
        action: auditAction('action').notNull(),
        resource: auditResource('resource').notNull(),
        targetId: uuid('target_id'),
        result: auditResult('result').notNull(),
        metadata: jsonb('metadata').$type<AuditMetadata>().notNull().default({}),
    },
    (table) => [
        index('audit_events_created_at_id_idx').on(table.createdAt, table.id),
        index('audit_events_actor_user_id_idx').on(table.actorUserId),
        index('audit_events_action_resource_idx').on(table.action, table.resource),
        index('audit_events_result_idx').on(table.result),
        check('audit_events_metadata_size_check', sql`pg_column_size(${table.metadata}) <= 4096`),
    ],
)
