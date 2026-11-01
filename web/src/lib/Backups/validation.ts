import { z } from 'zod'
import { BACKUP_AUDIT_POLICY } from '../../config/backups.config.ts'
import {
    offHostConfigurationAuditSchema,
    offHostJobSchema,
    offHostStatusSchema,
} from './offHostValidation.ts'

const timestamp = z.number().int().nonnegative().safe()
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const managedBackupAuditAcknowledgementSchema = z.strictObject({
    storeId: z.uuid(),
    sequence: timestamp,
})
export const managedBackupStartSchema = z.strictObject({ requestId: z.uuid(), actorId: z.uuid() })
export const managedBackupDeleteSchema = managedBackupStartSchema.extend({
    metadataSha256: digest.nullable(),
})
export const managedBackupRestoreSchema = managedBackupDeleteSchema.extend({
    metadataSha256: digest,
    actorName: z.string().trim().min(1).max(160),
})
export const managedBackupMaintenanceSchema = z.strictObject({
    id: z.uuid(),
    requestId: z.uuid(),
    actorId: z.uuid(),
    actorName: z.string().min(1).max(160).nullable(),
    artifactId: z.uuid(),
    metadataSha256: digest.nullable(),
    operation: z.enum(['restore', 'delete']),
    state: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']),
    phase: z.enum([
        'queued',
        'validating',
        'quiescing',
        'database',
        'controller',
        'crowdsec',
        'secrets',
        'restarting',
        'complete',
    ]),
    progressPercent: z.number().int().min(0).max(100),
    requestedAt: timestamp,
    startedAt: timestamp.nullable(),
    finishedAt: timestamp.nullable(),
    error: z
        .enum(['execution_failed', 'recovery_failed', 'artifact_invalid', 'interrupted'])
        .nullable(),
})
export const backupRestoreSnapshotSchema = z.strictObject({
    maintenance: managedBackupMaintenanceSchema.nullable(),
})
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
    remote: offHostJobSchema.nullable().optional(),
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
        'delete_requested',
        'deleted',
        'delete_failed',
        'restore_requested',
        'restore_started',
        'restore_succeeded',
        'restore_failed',
        'restore_interrupted',
        'off_host_configuration_updated',
    ]),
    jobId: z.uuid().nullable(),
    actorId: z.uuid().nullable(),
    at: timestamp,
})
export const managedBackupStatusSchema = z.strictObject({
    storeId: z.uuid(),
    configuration: managedBackupConfigurationSchema,
    jobs: z.array(managedBackupJobSchema).max(100),
    auditEvents: z.array(managedBackupAuditEventSchema).max(BACKUP_AUDIT_POLICY.capacity),
    maintenance: managedBackupMaintenanceSchema.nullable().optional(),
    offHost: offHostStatusSchema.optional(),
})
export const managedBackupStateSchema = managedBackupStatusSchema
    .extend({
        version: z.literal(1),
        auditAcknowledged: timestamp.optional(),
        auditEvents: z.array(managedBackupAuditEventSchema).max(BACKUP_AUDIT_POLICY.capacity),
        configurationRequests: z
            .array(
                z.strictObject({
                    request: managedBackupConfigurationUpdateSchema,
                    configuration: managedBackupConfigurationSchema,
                }),
            )
            .max(100),
        maintenanceRequests: z.array(managedBackupMaintenanceSchema).max(100).optional(),
        offHostConfigurationAudits: z.array(offHostConfigurationAuditSchema).max(100).optional(),
    })
    .superRefine((state, context) => {
        let previous = state.auditAcknowledged ?? (state.auditEvents[0]?.sequence ?? 1) - 1
        for (const event of state.auditEvents) {
            if (event.sequence !== previous + 1)
                context.addIssue({ code: 'custom', message: 'Non-contiguous backup audit events' })
            previous = event.sequence
        }
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
