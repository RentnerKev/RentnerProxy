import { z } from 'zod'
import { dnsZoneIdSchema } from '@/lib/DnsConnections/validation.ts'
import { MAX_DDNS_TARGETS } from '@/config/ddns.config.ts'

export const ddnsIdSchema = z.uuidv7().regex(/^[a-f0-9-]+$/u)
export const ddnsRevisionSchema = z.number().int().min(0).max(4_294_967_295)
const ddnsRecordIdSchema = z.string().regex(/^[a-f0-9]{32}$/u)
const ddnsSelectionSchema = z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('inspect') }),
    z.strictObject({ mode: z.literal('create') }),
    z.strictObject({ mode: z.literal('adopt'), recordId: ddnsRecordIdSchema }),
])
export const ddnsNameSchema = z
    .string()
    .max(253)
    .refine((value) => {
        const name = value.startsWith('*.') ? value.slice(2) : value
        return (
            name.includes('.') &&
            !/^\d+(?:\.\d+){3}$/u.test(name) &&
            name
                .split('.')
                .every(
                    (label) =>
                        label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
                )
        )
    }, 'admin.ddns.validation.domain')
export const ddnsTargetSchema = z.strictObject({
    id: ddnsIdSchema,
    connectionId: ddnsIdSchema,
    zoneId: dnsZoneIdSchema,
    name: ddnsNameSchema,
    recordType: z.enum(['A', 'AAAA']),
    proxied: z.boolean(),
    enabled: z.boolean().default(true),
    selection: ddnsSelectionSchema,
})
export const ddnsDraftSchema = z
    .strictObject({
        intervalSeconds: z
            .number()
            .int()
            .min(60, 'admin.ddns.validation.interval')
            .max(86_400, 'admin.ddns.validation.interval'),
        updateOnStart: z.boolean(),
        ipv4: z.boolean(),
        ipv6: z.boolean(),
        targets: z.array(ddnsTargetSchema).max(MAX_DDNS_TARGETS, 'admin.ddns.validation.targets'),
    })
    .superRefine((value, context) => {
        const records = new Set<string>()
        const ids = new Set<string>()
        for (const [index, target] of value.targets.entries()) {
            const key = `${target.zoneId}:${target.name}:${target.recordType}`
            if (ids.has(target.id) || records.has(key))
                context.addIssue({
                    code: 'custom',
                    path: ['targets', index],
                    message: 'admin.ddns.validation.duplicate',
                })
            ids.add(target.id)
            records.add(key)
        }
    })
const ddnsSettingsSchema = ddnsDraftSchema.safeExtend({ enabled: z.boolean() })
export const ddnsRecordErrorSchema = z.enum([
    'invalid_input',
    'busy',
    'connection_unavailable',
    'zone_not_permitted',
    'name_outside_zone',
    'ip_discovery_failed',
    'family_disabled',
    'target_disabled',
    'adoption_required',
    'creation_required',
    'record_conflict',
    'record_changed',
    'update_precondition_unsupported',
    'provider_unauthorized',
    'provider_rate_limited',
    'provider_unavailable',
    'invalid_provider_response',
    'write_unconfirmed',
    'time_budget_exceeded',
    'run_interrupted',
])
const ddnsRecordStatusSchema = z.enum([
    'unchanged',
    'updated',
    'would_create',
    'would_update',
    'adoption_required',
    'creation_required',
    'skipped',
    'failed',
])
const address = z.union([z.ipv4(), z.ipv6()])
const ddnsTargetResultSchema = z.strictObject({
    targetId: ddnsIdSchema,
    status: ddnsRecordStatusSchema,
    current: z.strictObject({ id: ddnsRecordIdSchema, address, proxied: z.boolean() }).nullable(),
    desiredAddress: address.nullable(),
    error: ddnsRecordErrorSchema.nullable(),
    retryAfterSeconds: z.number().int().min(1).max(86_400).nullable(),
})
export const ddnsBatchSchema = z.strictObject({
    preview: z.boolean(),
    ipv4: z.ipv4().nullable(),
    ipv6: z.ipv6().nullable(),
    targets: z.array(ddnsTargetResultSchema).max(MAX_DDNS_TARGETS),
})
const timestamp = z.number().int().min(0).max(253_402_300_799).nullable()
const trigger = z.enum(['scheduled', 'manual'])
const outcome = z.enum([
    'completed',
    'partial_failure',
    'interrupted',
    'enabled',
    'disabled',
    'configured',
    'restore_paused',
])
export const ddnsSnapshotSchema = z
    .strictObject({
        version: z.literal(1),
        configuration: z
            .strictObject({
                revision: ddnsRevisionSchema.min(1),
                updatedByUserId: ddnsIdSchema,
                settings: ddnsSettingsSchema,
            })
            .nullable(),
        targets: z
            .array(
                z.strictObject({
                    targetId: ddnsIdSchema,
                    lastAttemptAt: timestamp,
                    lastSuccessAt: timestamp,
                    lastSuccessfulAddress: address.nullable(),
                    lastSuccessfulProxied: z.boolean().nullable(),
                    lastResult: ddnsTargetResultSchema.nullable(),
                    consecutiveFailures: z.number().int().min(0).max(32),
                    permanentFailure: z.boolean(),
                    connectionRevision: ddnsRevisionSchema.min(1).nullable(),
                    createdRecordId: ddnsRecordIdSchema.optional(),
                    nextAttemptAt: timestamp,
                    retryNotBefore: timestamp,
                }),
            )
            .max(MAX_DDNS_TARGETS),
        inFlight: z
            .strictObject({
                startedAt: timestamp.unwrap(),
                actorUserId: ddnsIdSchema,
                trigger,
                targetIds: z.array(ddnsIdSchema).min(1).max(MAX_DDNS_TARGETS),
            })
            .nullable(),
        lastRun: z
            .strictObject({
                startedAt: timestamp.unwrap(),
                finishedAt: timestamp.unwrap(),
                actorUserId: ddnsIdSchema,
                trigger,
                outcome,
                updated: z.number().int().min(0).max(100),
                failed: z.number().int().min(0).max(100),
            })
            .nullable(),
        providerNotBefore: timestamp,
        providerPauseReason: ddnsRecordErrorSchema.nullable(),
        manualNotBefore: timestamp,
        restorePaused: z.boolean(),
        events: z
            .array(
                z.strictObject({
                    sequence: ddnsRevisionSchema.min(1),
                    at: timestamp.unwrap(),
                    actorUserId: ddnsIdSchema.nullable(),
                    trigger: trigger.nullable(),
                    outcome,
                    updated: z.number().int().min(0).max(100),
                    failed: z.number().int().min(0).max(100),
                }),
            )
            .max(64),
        eventSequence: ddnsRevisionSchema,
    })
    .superRefine((value, context) => {
        const ids = value.configuration?.settings.targets.map((target) => target.id) ?? []
        if (
            new Set(ids).size !== ids.length ||
            value.targets.length !== ids.length ||
            new Set(value.targets.map((target) => target.targetId)).size !== ids.length ||
            value.targets.some(
                (target) =>
                    !ids.includes(target.targetId) ||
                    (target.lastResult !== null && target.lastResult.targetId !== target.targetId),
            ) ||
            (value.inFlight !== null &&
                (new Set(value.inFlight.targetIds).size !== value.inFlight.targetIds.length ||
                    value.inFlight.targetIds.some((id) => !ids.includes(id))))
        )
            context.addIssue({ code: 'custom', message: 'invalid DDNS state' })
    })
