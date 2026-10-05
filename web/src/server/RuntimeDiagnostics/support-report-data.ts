// oxlint-disable-next-line import/no-unassigned-import -- Keeps aggregate reads behind the server boundary.
import '@tanstack/react-start/server-only'
import { count, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

import { proxyHosts, redirectHosts, certificates, certificateJobs } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import {
    CERTIFICATE_ERROR_CODES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_STORED_STATUSES,
} from '@/config/certificates.config.ts'
import { CERTIFICATE_JOB_STAGES } from '@/config/certificate-jobs.config.ts'
import { SUPPORT_CERTIFICATE_JOB_ERROR_CODES } from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'

// Fixed columns and aggregate queries avoid loading names, domains, credentials or job payloads.
function aggregateCounters(
    column: SQLWrapper,
    values: readonly string[],
    prefix: string,
    nullable: boolean,
): Record<string, SQL<number>> {
    const result: Record<string, SQL<number>> = {}
    for (const value of values) {
        result[prefix + value] = sql<number>`count(*) filter (where ${column} = ${value})`.mapWith(
            Number,
        )
    }
    if (nullable)
        result[prefix + 'none'] = sql<number>`count(*) filter (where ${column} is null)`.mapWith(
            Number,
        )
    result[prefix + 'other'] =
        sql<number>`count(*) filter (where ${column} is not null and ${column} not in (${sql.join(
            values.map((value) => sql`${value}`),
            sql`, `,
        )}))`.mapWith(Number)
    return result
}

function readCounters(
    row: Readonly<Record<string, number>>,
    values: readonly string[],
    prefix: string,
    nullable: boolean,
): Record<string, number> {
    const result: Record<string, number> = {}
    for (const key of [...values, ...(nullable ? ['none'] : []), 'other']) {
        const value = row[prefix + key]
        if (value === undefined) throw new Error('invalid_aggregate')
        result[key] = value
    }
    return result
}

function readAggregates<T>(work: (transaction: AuthTransaction) => Promise<T>): Promise<T> {
    return getAuthDatabase().transaction(
        async (transaction) => {
            await transaction.execute(sql`set local statement_timeout = '2000ms'`)
            return work(transaction)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export function readSupportDesiredRevision(): Promise<string> {
    return readAggregates(async (transaction) => {
        const snapshot = await readProxyRuntimeSnapshot(transaction)
        return snapshot.revision
    })
}

export function readSupportConfigurationCounts() {
    return readAggregates(async (transaction) => {
        const [proxy, redirect] = await Promise.all([
            transaction
                .select({
                    total: count(),
                    enabled:
                        sql<number>`count(*) filter (where ${proxyHosts.enabled} = true)`.mapWith(
                            Number,
                        ),
                })
                .from(proxyHosts),
            transaction
                .select({
                    total: count(),
                    enabled:
                        sql<number>`count(*) filter (where ${redirectHosts.enabled} = true)`.mapWith(
                            Number,
                        ),
                })
                .from(redirectHosts),
        ])
        return { proxyHosts: proxy[0], redirectHosts: redirect[0] }
    })
}

export function readSupportCertificateCounts() {
    return readAggregates(async (transaction) => {
        const rows = await transaction
            .select({
                ...aggregateCounters(
                    certificates.status,
                    CERTIFICATE_STORED_STATUSES,
                    'status_',
                    false,
                ),
                ...aggregateCounters(
                    certificates.operation,
                    CERTIFICATE_OPERATIONS,
                    'operation_',
                    false,
                ),
                ...aggregateCounters(
                    sql`${certificates.currentOperation}->>'stage'`,
                    CERTIFICATE_OPERATION_STAGES,
                    'stage_',
                    true,
                ),
                ...aggregateCounters(
                    certificates.lastErrorCode,
                    CERTIFICATE_ERROR_CODES,
                    'error_',
                    true,
                ),
                total: count(),
            })
            .from(certificates)
        const row = rows[0]
        if (!row) return null
        return {
            total: row.total,
            storedStatuses: readCounters(row, CERTIFICATE_STORED_STATUSES, 'status_', false),
            operations: readCounters(row, CERTIFICATE_OPERATIONS, 'operation_', false),
            operationStages: readCounters(row, CERTIFICATE_OPERATION_STAGES, 'stage_', true),
            errors: readCounters(row, CERTIFICATE_ERROR_CODES, 'error_', true),
        }
    })
}

export function readSupportCertificateJobCounts() {
    return readAggregates(async (transaction) => {
        const rows = await transaction
            .select({
                ...aggregateCounters(
                    certificateJobs.stage,
                    CERTIFICATE_JOB_STAGES,
                    'stage_',
                    false,
                ),
                ...aggregateCounters(
                    certificateJobs.controllerStage,
                    CERTIFICATE_OPERATION_STAGES,
                    'controller_',
                    true,
                ),
                ...aggregateCounters(
                    certificateJobs.lastErrorCode,
                    SUPPORT_CERTIFICATE_JOB_ERROR_CODES,
                    'error_',
                    true,
                ),
                total: count(),
            })
            .from(certificateJobs)
        const row = rows[0]
        if (!row) return null
        return {
            total: row.total,
            stages: readCounters(row, CERTIFICATE_JOB_STAGES, 'stage_', false),
            controllerStages: readCounters(row, CERTIFICATE_OPERATION_STAGES, 'controller_', true),
            errors: readCounters(row, SUPPORT_CERTIFICATE_JOB_ERROR_CODES, 'error_', true),
        }
    })
}
