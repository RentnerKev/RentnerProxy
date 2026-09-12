import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    index,
    integer,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type {
    CertificateJobErrorCode,
    CertificateJobStage,
} from '../../config/certificate-jobs.config'
import type { CertificateOperationStage } from '../../config/certificates.config'
import type { PermissionKey } from '../../config/permissions.config'
import { rentnerProxySchema } from './base'
import { bytea } from './columns'
import { certificates } from './certificates'
import { proxyHosts } from './proxyHosts'
import { users } from './users'

export const certificateJobs = rentnerProxySchema.table(
    'certificate_binding_jobs',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
        proxyHostId: uuid('proxy_host_id').references(() => proxyHosts.id, {
            onDelete: 'set null',
        }),
        certificateId: uuid('certificate_id').references(() => certificates.id, {
            onDelete: 'set null',
        }),
        idempotencyKey: uuid('idempotency_key').notNull(),
        requestDigest: varchar('request_digest', { length: 64 }).notNull(),
        domains: text('domains').array().notNull(),
        requiredPermissions: text('required_permissions')
            .array()
            .$type<PermissionKey[]>()
            .notNull(),
        hostRevision: varchar('host_revision', { length: 64 }).notNull(),
        assignedRevision: varchar('assigned_revision', { length: 64 }),
        desiredEnabled: boolean('desired_enabled').notNull(),
        desiredForceHttps: boolean('desired_force_https').notNull(),
        requestCiphertext: bytea('request_ciphertext'),
        requestIv: bytea('request_iv'),
        stage: varchar('stage', { length: 20 })
            .$type<CertificateJobStage>()
            .notNull()
            .default('preparing'),
        controllerStage: varchar('controller_stage', {
            length: 40,
        }).$type<CertificateOperationStage>(),
        controllerOperationId: uuid('controller_operation_id'),
        lastErrorCode: varchar('last_error_code', { length: 64 }).$type<CertificateJobErrorCode>(),
        attemptCount: integer('attempt_count').notNull().default(0),
        retryRequested: boolean('retry_requested').notNull().default(false),
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        leaseToken: uuid('lease_token'),
        leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        unique('certificate_jobs_actor_idempotency_unique').on(
            table.actorUserId,
            table.idempotencyKey,
        ),
        unique('certificate_jobs_certificate_unique').on(table.certificateId),
        index('certificate_jobs_due_idx').on(table.stage, table.nextAttemptAt),
        index('certificate_jobs_host_created_idx').on(table.proxyHostId, table.createdAt),
        check(
            'certificate_jobs_stage_check',
            sql`${table.stage} in ('preparing','issuing','applying','applied','failed','needs_attention')`,
        ),
        check('certificate_jobs_attempts_check', sql`${table.attemptCount} >= 0`),
        check(
            'certificate_jobs_domains_check',
            sql`cardinality(${table.domains}) between 1 and 100`,
        ),
        check(
            'certificate_jobs_permissions_check',
            sql`cardinality(${table.requiredPermissions}) between 1 and 10`,
        ),
        check(
            'certificate_jobs_secret_check',
            sql`(${table.requestCiphertext} is null and ${table.requestIv} is null) or (${table.requestCiphertext} is not null and ${table.requestIv} is not null and octet_length(${table.requestCiphertext}) between 17 and 65536 and octet_length(${table.requestIv}) = 12)`,
        ),
        check(
            'certificate_jobs_lease_check',
            sql`(${table.leaseToken} is null) = (${table.leaseExpiresAt} is null)`,
        ),
    ],
)
