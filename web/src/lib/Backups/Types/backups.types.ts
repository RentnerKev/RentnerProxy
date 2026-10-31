import type { z } from 'zod'
import type {
    managedBackupArtifactSchema,
    managedBackupAuditAcknowledgementSchema,
    managedBackupAuditEventSchema,
    managedBackupConfigurationSchema,
    managedBackupConfigurationUpdateSchema,
    managedBackupJobSchema,
    managedBackupSourceSchema,
    managedBackupStartSchema,
    managedBackupStateSchema,
    managedBackupStatusSchema,
} from '../validation.ts'

export type ManagedBackupAuditAcknowledgement = z.infer<
    typeof managedBackupAuditAcknowledgementSchema
>
export type ManagedBackupArtifact = z.infer<typeof managedBackupArtifactSchema>
export type ManagedBackupAuditEvent = z.infer<typeof managedBackupAuditEventSchema>
export type ManagedBackupConfiguration = z.infer<typeof managedBackupConfigurationSchema>
export type ManagedBackupConfigurationUpdate = z.infer<
    typeof managedBackupConfigurationUpdateSchema
>
export type ManagedBackupJob = z.infer<typeof managedBackupJobSchema>
export type ManagedBackupSource = z.infer<typeof managedBackupSourceSchema>
export type ManagedBackupStart = z.infer<typeof managedBackupStartSchema>
export type ManagedBackupState = z.infer<typeof managedBackupStateSchema>
export type ManagedBackupStatus = z.infer<typeof managedBackupStatusSchema>
