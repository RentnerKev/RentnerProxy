import { z } from 'zod'
import { HOST_MONITORING_OUTCOME_CODES } from '@/config/host-monitoring.config.ts'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import { hostMonitoringSettingsSchema } from './validation.ts'

const uuid = z.uuid().refine((value) => value === value.toLowerCase())
const date = z.iso.datetime().transform((value) => new Date(value))
const state = z.enum(['healthy', 'unhealthy', 'unknown'])
const code = z.enum(HOST_MONITORING_OUTCOME_CODES)
const duration = z.number().int().min(0).max(12_000).nullable()
const httpStatus = z.number().int().min(100).max(599).nullable()

export const hostMonitoringPolicyResponseSchema = z.strictObject({
    id: uuid,
    proxyHostId: uuid,
    version: uuid,
    settings: hostMonitoringSettingsSchema,
    state,
    availability: z.enum([
        'healthy',
        'unhealthy',
        'unknown',
        'disabled',
        'host_disabled',
        'domain_removed',
        'not_checked',
        'stale',
    ]),
    lastCheckedAt: date.nullable(),
    lastOutcome: state.nullable(),
    lastCode: code.nullable(),
    lastDurationMs: duration,
    lastHttpStatus: httpStatus,
    nextCheckAt: date.nullable(),
    observationPoint: z.literal('appliance'),
    publicReachability: z.literal('not_checked'),
})

export const hostMonitoringSummaryResponseSchema = z.strictObject({
    summaries: z
        .array(
            z.strictObject({
                proxyHostId: uuid,
                policy: hostMonitoringPolicyResponseSchema.nullable(),
            }),
        )
        .max(HOST_MONITORING_UI.summaryBatchLimit)
        .refine((rows) => new Set(rows.map((row) => row.proxyHostId)).size === rows.length)
        .refine((rows) =>
            rows.every((row) => row.policy === null || row.policy.proxyHostId === row.proxyHostId),
        ),
    checkedAt: date,
})

export const hostMonitoringHistoryResponseSchema = z.strictObject({
    observations: z
        .array(
            z.strictObject({
                id: uuid,
                policyId: uuid,
                policyVersion: uuid,
                checkedAt: date,
                status: state,
                code,
                durationMs: duration,
                httpStatus,
            }),
        )
        .max(HOST_MONITORING_UI.historyPageLimit),
    incidents: z
        .array(
            z.strictObject({
                id: uuid,
                policyId: uuid,
                startedAt: date,
                detectedAt: date,
                recoveryStartedAt: date.nullable(),
                recoveredAt: date.nullable(),
                failureCode: code,
                recoveryCode: code.nullable(),
                closedReason: z
                    .enum(['recovered', 'policy_changed', 'monitoring_disabled'])
                    .nullable(),
                closedAt: date.nullable(),
            }),
        )
        .max(HOST_MONITORING_UI.historyPageLimit),
    nextCursor: z.strictObject({ checkedAt: z.iso.datetime(), id: uuid }).nullable(),
})
