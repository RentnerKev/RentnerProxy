import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    timestamp,
    unique,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type {
    AcmeChallengeType,
    AcmeEnvironment,
    CertificateEventKind,
    CertificateErrorCode,
    CertificateOperation,
    CertificateOperationStage,
    CertificateSource,
    CertificateStoredStatus,
} from '../../config/certificates.config'
import type {
    CertificateCandidateMetadata,
    CertificateCurrentOperationMetadata,
} from '../../shared/Types/certificates.types'
import { rentnerProxySchema } from './base'

export const certificates = rentnerProxySchema.table(
    'certificates',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        name: varchar('name', { length: 120 }).notNull(),
        source: varchar('source', { length: 10 }).$type<CertificateSource>().notNull(),
        environment: varchar('environment', { length: 10 }).$type<AcmeEnvironment>(),
        status: varchar('status', { length: 10 })
            .$type<CertificateStoredStatus>()
            .notNull()
            .default('pending'),
        operation: varchar('operation', { length: 10 })
            .$type<CertificateOperation>()
            .notNull()
            .default('idle'),
        currentOperation: jsonb(
            'current_operation',
        ).$type<CertificateCurrentOperationMetadata | null>(),
        challengeType: varchar('challenge_type', { length: 7 }).$type<AcmeChallengeType | null>(),
        issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
        expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
        issuer: varchar('issuer', { length: 512 }),
        fingerprint: varchar('fingerprint', { length: 71 }),
        candidate: jsonb('candidate').$type<CertificateCandidateMetadata | null>(),
        dnsCleanupPending: boolean('dns_cleanup_pending').notNull().default(false),
        lastErrorCode: varchar('last_error_code', { length: 64 }).$type<CertificateErrorCode>(),
        lastActivatedAt: timestamp('last_activated_at', { withTimezone: true, mode: 'date' }),
        lastErrorAt: timestamp('last_error_at', { withTimezone: true, mode: 'date' }),
        nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
        attemptCount: integer('attempt_count').notNull().default(0),
        lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true, mode: 'date' }),
        lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'date' }),
        nextRenewalAt: timestamp('next_renewal_at', { withTimezone: true, mode: 'date' }),
        controllerUpdatedAt: timestamp('controller_updated_at', {
            withTimezone: true,
            mode: 'date',
        }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        check('certificates_name_check', sql`length(btrim(${table.name})) > 0`),
        check('certificates_source_check', sql`${table.source} in ('manual', 'acme')`),
        check(
            'certificates_environment_check',
            sql`(${table.source} = 'manual' and ${table.environment} is null) or (${table.source} = 'acme' and ${table.environment} is not null and ${table.environment} in ('staging', 'production'))`,
        ),
        check('certificates_status_check', sql`${table.status} in ('pending', 'valid', 'failed')`),
        check(
            'certificates_operation_check',
            sql`${table.operation} in ('idle', 'issuing', 'renewing')`,
        ),
        check(
            'certificates_challenge_type_check',
            sql`${table.challengeType} is null or ${table.challengeType} in ('http-01', 'dns-01')`,
        ),
        check('certificates_attempt_count_check', sql`${table.attemptCount} >= 0`),
        check(
            'certificates_validity_check',
            sql`${table.status} != 'valid' or (${table.issuedAt} is not null and ${table.expiresAt} is not null and ${table.issuedAt} < ${table.expiresAt} and ${table.fingerprint} is not null)`,
        ),
        check(
            'certificates_fingerprint_check',
            sql`${table.fingerprint} is null or ${table.fingerprint} ~ '^sha256:[a-f0-9]{64}$'`,
        ),
        index('certificates_expires_at_idx').on(table.expiresAt),
    ],
)

/**
 * Event receipts deliberately have no foreign keys. The controller may report an event for a
 * certificate that was deleted locally, and that event still belongs in the audit trail exactly
 * once.
 */
export const certificateEventReceipts = rentnerProxySchema.table(
    'certificate_event_receipts',
    {
        eventId: uuid('event_id').primaryKey(),
        operationId: uuid('operation_id').notNull(),
        certificateId: uuid('certificate_id').notNull(),
        kind: varchar('kind', { length: 32 }).$type<CertificateEventKind>().notNull(),
        stage: varchar('stage', { length: 32 }).$type<CertificateOperationStage>().notNull(),
        occurredAt: timestamp('occurred_at', {
            precision: 3,
            withTimezone: true,
            mode: 'date',
        }).notNull(),
        errorCode: varchar('error_code', { length: 64 }).$type<CertificateErrorCode>(),
        receivedAt: timestamp('received_at', { precision: 3, withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        index('certificate_event_receipts_received_at_idx').on(table.receivedAt),
        index('certificate_event_receipts_certificate_id_idx').on(table.certificateId),
        check(
            'certificate_event_receipts_kind_check',
            sql`${table.kind} in ('accepted', 'started', 'issued', 'activated', 'renewed', 'retry_scheduled', 'failed')`,
        ),
        check(
            'certificate_event_receipts_stage_check',
            sql`${table.stage} in ('queued', 'creating_order', 'preparing_challenge', 'waiting_for_validation', 'finalizing', 'certificate_ready', 'applying', 'applied', 'retry_scheduled', 'failed', 'needs_attention')`,
        ),
    ],
)

/** Singleton durable cursor for the controller's certificate event stream. */
export const certificateEventCursor = rentnerProxySchema.table(
    'certificate_event_cursor',
    {
        id: integer('id').primaryKey().default(1),
        cursor: varchar('cursor', { length: 512 }),
        updatedAt: timestamp('updated_at', { precision: 3, withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [check('certificate_event_cursor_singleton_check', sql`${table.id} = 1`)],
)

export const certificateDomains = rentnerProxySchema.table(
    'certificate_domains',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        certificateId: uuid('certificate_id')
            .notNull()
            .references(() => certificates.id, { onDelete: 'cascade' }),
        domain: varchar('domain', { length: 253 }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        unique('certificate_domains_certificate_domain_unique').on(
            table.certificateId,
            table.domain,
        ),
        check(
            'certificate_domains_canonical_check',
            sql`${table.domain} ~ '^([*][.])?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and ${table.domain} !~ '^[0-9.]+$'`,
        ),
        index('certificate_domains_certificate_id_idx').on(table.certificateId),
    ],
)
