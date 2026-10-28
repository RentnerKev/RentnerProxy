import { z } from 'zod'
import { normalizeProxyDomain } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'

const uuid = z.uuid().refine((value) => value === value.toLowerCase())
export const hostMonitoringSelectorSchema = z.strictObject({ proxyHostId: uuid })
export const hostMonitoringSummarySchema = z.strictObject({
    proxyHostIds: z
        .array(uuid)
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length),
})

export const hostMonitoringSettingsSchema = z.strictObject({
    domain: z
        .string()
        .min(1)
        .max(253)
        .refine((value) => normalizeProxyDomain(value) === value && !value.startsWith('*.')),
    enabled: z.boolean().default(HOST_MONITORING_DEFAULTS.enabled),
    intervalSeconds: z
        .number()
        .int()
        .min(30)
        .max(86_400)
        .default(HOST_MONITORING_DEFAULTS.intervalSeconds),
    timeoutMs: z.number().int().min(1_000).max(10_000).default(HOST_MONITORING_DEFAULTS.timeoutMs),
    expectedStatus: z
        .number()
        .int()
        .min(100)
        .max(599)
        .default(HOST_MONITORING_DEFAULTS.expectedStatus),
    failureThreshold: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(HOST_MONITORING_DEFAULTS.failureThreshold),
    recoveryThreshold: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(HOST_MONITORING_DEFAULTS.recoveryThreshold),
    retentionDays: z.number().int().min(1).max(30).default(HOST_MONITORING_DEFAULTS.retentionDays),
    sampleLimit: z.number().int().min(10).max(10_000).default(HOST_MONITORING_DEFAULTS.sampleLimit),
    incidentLimit: z
        .number()
        .int()
        .min(1)
        .max(1_000)
        .default(HOST_MONITORING_DEFAULTS.incidentLimit),
})

export const saveHostMonitoringPolicySchema = hostMonitoringSelectorSchema.extend({
    expectedVersion: uuid.nullable(),
    settings: hostMonitoringSettingsSchema,
})

export const hostMonitoringHistorySchema = hostMonitoringSelectorSchema.extend({
    status: z.enum(['all', 'healthy', 'unhealthy', 'unknown']).default('all'),
    since: z.iso.datetime().optional(),
    before: z.strictObject({ checkedAt: z.iso.datetime(), id: uuid }).optional(),
    limit: z.number().int().min(1).max(100).default(50),
})
