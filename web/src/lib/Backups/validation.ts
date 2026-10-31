import { z } from 'zod'

const timestamp = z.number().int().nonnegative().safe()
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const managedBackupStartSchema = z.strictObject({ requestId: z.uuid(), actorId: z.uuid() })
export const managedBackupConfigurationUpdateSchema = managedBackupStartSchema.extend({
    expectedRevision: z.number().int().nonnegative().safe(),
    enabled: z.boolean(),
    intervalHours: z.number().int().min(1).max(8760),
    retentionCount: z.number().int().min(1).max(50),
})
export const managedBackupConfigurationSchema = z.strictObject({
    revision: z.number().int().nonnegative().safe(),
    enabled: z.boolean(),
    intervalHours: z.number().int().min(1).max(8760),
    retentionCount: z.number().int().min(1).max(50),
    nextRunAt: timestamp.nullable(),
})
export const managedBackupSourceSchema = z.strictObject({
    imageId: z.null(),
    revision: z
        .string()
        .regex(/^[a-f0-9]{40}$/u)
        .nullable(),
    version: z.string().min(1).max(128),
    buildSha256: digest,
})
export const managedBackupArtifactSchema = z.strictObject({
    id: z.uuid(),
    metadataSha256: digest,
    bytes: z.number().int().positive().safe(),
})
export const managedBackupJobSchema = z.strictObject({
    id: z.uuid(),
    requestId: z.uuid(),
    origin: z.enum(['manual', 'schedule']),
    actorId: z.uuid().nullable(),
    scheduledFor: timestamp.nullable(),
    state: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']),
    requestedAt: timestamp,
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    durationMs: timestamp.nullable(),
    error: z
        .enum(['execution_failed', 'interrupted', 'artifact_invalid', 'recovery_failed'])
        .nullable(),
    source: managedBackupSourceSchema,
    artifact: managedBackupArtifactSchema.nullable(),
    retained: z.boolean(),
})
export const managedBackupAuditEventSchema = z.strictObject({
    sequence: z.number().int().nonnegative().safe(),
    kind: z.enum([
        'requested',
        'configuration_updated',
        'started',
        'succeeded',
        'failed',
        'interrupted',
        'pruned',
    ]),
    jobId: z.uuid().nullable(),
    actorId: z.uuid().nullable(),
    at: timestamp,
})
export const managedBackupStatusSchema = z.strictObject({
    storeId: z.uuid(),
    configuration: managedBackupConfigurationSchema,
    jobs: z.array(managedBackupJobSchema).max(100),
    auditEvents: z.array(managedBackupAuditEventSchema).max(500),
})
export const managedBackupStateSchema = managedBackupStatusSchema
    .extend({
        version: z.literal(1),
        auditEvents: z.array(managedBackupAuditEventSchema).max(500),
        configurationRequests: z
            .array(
                z.strictObject({
                    request: managedBackupConfigurationUpdateSchema,
                    configuration: managedBackupConfigurationSchema,
                }),
            )
            .max(100),
    })
    .superRefine((state, context) => {
        if (
            state.jobs.filter((job) => job.state === 'queued' || job.state === 'running').length > 1
        ) {
            context.addIssue({ code: 'custom', message: 'Multiple active backup jobs' })
        }
        if (state.jobs.filter((job) => job.retained).length > 50) {
            context.addIssue({ code: 'custom', message: 'Too many retained backup jobs' })
        }
        if (
            new Set(state.jobs.map((job) => job.id)).size !== state.jobs.length ||
            new Set(state.jobs.map((job) => job.requestId)).size !== state.jobs.length
        ) {
            context.addIssue({ code: 'custom', message: 'Duplicate backup job identity' })
        }
    })
