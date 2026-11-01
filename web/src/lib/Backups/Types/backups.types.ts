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
    managedBackupDeleteSchema,
    managedBackupRestoreSchema,
    managedBackupMaintenanceSchema,
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
export type ManagedBackupDelete = z.infer<typeof managedBackupDeleteSchema>
export type ManagedBackupRestore = z.infer<typeof managedBackupRestoreSchema>
export type ManagedBackupMaintenance = z.infer<typeof managedBackupMaintenanceSchema>
