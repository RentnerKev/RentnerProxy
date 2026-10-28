import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    index,
    integer,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core'
import type {
    HostMonitoringOutcomeCode,
    HostMonitoringState,
} from '../../lib/HostMonitoring/Types/host-monitoring.types.ts'
import { rentnerProxySchema } from './base.ts'
import { proxyHosts } from './proxyHosts.ts'
import { users } from './users.ts'

export const hostCheckPolicies = rentnerProxySchema.table(
    'host_check_policies',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        proxyHostId: uuid('proxy_host_id')
            .notNull()
            .references(() => proxyHosts.id, { onDelete: 'cascade' }),
        domain: varchar('domain', { length: 253 }).notNull(),
        enabled: boolean('enabled').notNull().default(false),
        version: uuid('version')
            .notNull()
            .default(sql`uuidv7()`),
        contextProof: varchar('context_proof', { length: 71 }),
        contextRevision: varchar('context_revision', { length: 71 }),
        intervalSeconds: integer('interval_seconds').notNull().default(60),
        timeoutMs: integer('timeout_ms').notNull().default(3_000),
        expectedStatus: integer('expected_status').notNull().default(200),
        failureThreshold: integer('failure_threshold').notNull().default(3),
        recoveryThreshold: integer('recovery_threshold').notNull().default(2),
        retentionDays: integer('retention_days').notNull().default(7),
        sampleLimit: integer('sample_limit').notNull().default(1_440),
        incidentLimit: integer('incident_limit').notNull().default(100),
        state: varchar('state', { length: 10 })
            .$type<HostMonitoringState>()
            .notNull()
            .default('unknown'),
        failureCount: integer('failure_count').notNull().default(0),
        recoveryCount: integer('recovery_count').notNull().default(0),
        failureStartedAt: timestamp('failure_started_at', { withTimezone: true, mode: 'date' }),
        recoveryStartedAt: timestamp('recovery_started_at', { withTimezone: true, mode: 'date' }),
        nextCheckAt: timestamp('next_check_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
        lastOutcome: varchar('last_outcome', { length: 10 }).$type<HostMonitoringState>(),
        lastCode: varchar('last_code', { length: 32 }).$type<HostMonitoringOutcomeCode>(),
        lastDurationMs: integer('last_duration_ms'),
        lastHttpStatus: integer('last_http_status'),
        leaseToken: uuid('lease_token'),
        leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
        configuredBy: uuid('configured_by').references(() => users.id, { onDelete: 'set null' }),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        uniqueIndex('host_check_policies_host_unique').on(table.proxyHostId),
        index('host_check_policies_due_idx')
            .on(table.nextCheckAt)
            .where(sql`${table.enabled}`),
        index('host_check_policies_lease_idx')
            .on(table.leaseExpiresAt)
            .where(sql`${table.leaseToken} is not null`),
        check(
            'host_check_policies_domain_check',
            sql`${table.domain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and ${table.domain} !~ '^[0-9.]+$'`,
        ),
        check(
            'host_check_policies_interval_check',
            sql`${table.intervalSeconds} between 30 and 86400`,
        ),
        check('host_check_policies_timeout_check', sql`${table.timeoutMs} between 1000 and 10000`),
        check('host_check_policies_status_check', sql`${table.expectedStatus} between 100 and 599`),
        check(
            'host_check_policies_thresholds_check',
            sql`${table.failureThreshold} between 1 and 20 and ${table.recoveryThreshold} between 1 and 20`,
        ),
        check(
            'host_check_policies_retention_check',
            sql`${table.retentionDays} between 1 and 30 and ${table.sampleLimit} between 10 and 10000 and ${table.incidentLimit} between 1 and 1000`,
        ),
        check(
            'host_check_policies_state_check',
            sql`${table.state} in ('unknown','healthy','unhealthy')`,
        ),
        check(
            'host_check_policies_streaks_check',
            sql`${table.failureCount} between 0 and ${table.failureThreshold} and ${table.recoveryCount} between 0 and ${table.recoveryThreshold} and (${table.failureCount} = 0) = (${table.failureStartedAt} is null) and (${table.recoveryCount} = 0) = (${table.recoveryStartedAt} is null)`,
        ),
        check(
            'host_check_policies_lease_check',
            sql`(${table.leaseToken} is null) = (${table.leaseExpiresAt} is null)`,
        ),
        check(
            'host_check_policies_context_check',
            sql`(${table.contextProof} is null and ${table.contextRevision} is null) or (${table.contextProof} is not null and ${table.contextRevision} is not null and ${table.contextProof} ~ '^sha256:[a-f0-9]{64}$' and ${table.contextRevision} ~ '^sha256:[a-f0-9]{64}$')`,
        ),
        check(
            'host_check_policies_last_outcome_check',
            sql`${table.lastOutcome} is null or ${table.lastOutcome} in ('unknown','healthy','unhealthy')`,
        ),
        check(
            'host_check_policies_last_duration_check',
            sql`${table.lastDurationMs} is null or ${table.lastDurationMs} between 0 and 12000`,
        ),
        check(
            'host_check_policies_last_http_status_check',
            sql`${table.lastHttpStatus} is null or ${table.lastHttpStatus} between 100 and 599`,
        ),
        check(
            'host_check_policies_last_code_check',
            sql`${table.lastCode} is null or ${table.lastCode} in ('expected_status','unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed','configuration_stale','configuration_changed','host_not_active','runtime_unavailable','busy','invalid_response')`,
        ),
    ],
)

export const hostCheckObservations = rentnerProxySchema.table(
    'host_check_observations',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        policyId: uuid('policy_id')
            .notNull()
            .references(() => hostCheckPolicies.id, { onDelete: 'cascade' }),
        policyVersion: uuid('policy_version').notNull(),
        checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' })
            .notNull()
            .defaultNow(),
        status: varchar('status', { length: 10 }).$type<HostMonitoringState>().notNull(),
        code: varchar('code', { length: 32 }).$type<HostMonitoringOutcomeCode>().notNull(),
        durationMs: integer('duration_ms'),
        httpStatus: integer('http_status'),
    },
    (table) => [
        index('host_check_observations_policy_time_idx').on(
            table.policyId,
            table.checkedAt,
            table.id,
        ),
        index('host_check_observations_time_idx').on(table.checkedAt, table.id),
        check(
            'host_check_observations_status_check',
            sql`${table.status} in ('unknown','healthy','unhealthy')`,
        ),
        check(
            'host_check_observations_code_check',
            sql`${table.code} in ('expected_status','unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed','configuration_stale','configuration_changed','host_not_active','runtime_unavailable','busy','invalid_response')`,
        ),
        check(
            'host_check_observations_duration_check',
            sql`${table.durationMs} is null or ${table.durationMs} between 0 and 12000`,
        ),
        check(
            'host_check_observations_http_status_check',
            sql`${table.httpStatus} is null or ${table.httpStatus} between 100 and 599`,
        ),
    ],
)

export const hostCheckIncidents = rentnerProxySchema.table(
    'host_check_incidents',
    {
        id: uuid('id')
            .primaryKey()
            .default(sql`uuidv7()`),
        policyId: uuid('policy_id')
            .notNull()
            .references(() => hostCheckPolicies.id, { onDelete: 'cascade' }),
        startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
        detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' }).notNull(),
        recoveryStartedAt: timestamp('recovery_started_at', { withTimezone: true, mode: 'date' }),
        recoveredAt: timestamp('recovered_at', { withTimezone: true, mode: 'date' }),
        failureCode: varchar('failure_code', { length: 32 })
            .$type<HostMonitoringOutcomeCode>()
            .notNull(),
        recoveryCode: varchar('recovery_code', { length: 32 }).$type<HostMonitoringOutcomeCode>(),
        closedReason: varchar('closed_reason', { length: 24 }).$type<
            'recovered' | 'policy_changed' | 'monitoring_disabled'
        >(),
        closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    },
    (table) => [
        uniqueIndex('host_check_incidents_one_open_unique')
            .on(table.policyId)
            .where(sql`${table.closedReason} is null`),
        index('host_check_incidents_policy_time_idx').on(table.policyId, table.startedAt, table.id),
        index('host_check_incidents_closed_time_idx')
            .on(table.closedAt, table.id)
            .where(sql`${table.closedAt} is not null`),
        check(
            'host_check_incidents_closed_reason_check',
            sql`${table.closedReason} is null or ${table.closedReason} in ('recovered','policy_changed','monitoring_disabled')`,
        ),
        check(
            'host_check_incidents_closed_at_check',
            sql`(${table.closedReason} is null) = (${table.closedAt} is null) and (${table.closedAt} is null or ${table.closedAt} >= ${table.detectedAt})`,
        ),
        check(
            'host_check_incidents_dates_check',
            sql`${table.detectedAt} >= ${table.startedAt} and (${table.recoveryStartedAt} is null or ${table.recoveryStartedAt} >= ${table.startedAt}) and (${table.recoveredAt} is null or ${table.recoveredAt} >= ${table.detectedAt})`,
        ),
        check(
            'host_check_incidents_recovery_check',
            sql`(${table.closedReason} is not distinct from 'recovered' and ${table.recoveryStartedAt} is not null and ${table.recoveredAt} is not null and ${table.recoveryCode} is not null) or (${table.closedReason} is distinct from 'recovered' and ${table.recoveredAt} is null and ${table.recoveryCode} is null)`,
        ),
        check(
            'host_check_incidents_failure_code_check',
            sql`${table.failureCode} in ('unexpected_status','upstream_unreachable','upstream_timeout','upstream_dns_failed','tls_failed')`,
        ),
        check(
            'host_check_incidents_recovery_code_check',
            sql`${table.recoveryCode} is null or ${table.recoveryCode} = 'expected_status'`,
        ),
    ],
)
