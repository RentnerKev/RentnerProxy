import type {
    ManagedBackupArtifact,
    ManagedBackupJob,
    ManagedBackupSource,
    ManagedBackupState,
    ManagedBackupMaintenance,
} from '../../../web/src/lib/Backups/Types/backups.types.ts'
import type {
    OffHostConfigurationAudit,
    OffHostReceipt,
} from '../../../web/src/lib/Backups/Types/off-host.types.ts'

export interface ManagedBackupDependencies {
    read: () => Promise<unknown | null>
    write: (state: ManagedBackupState) => Promise<void>
    now: () => number
    id: () => string
    source: () => ManagedBackupSource | Promise<ManagedBackupSource>
    execute: (job: ManagedBackupJob) => Promise<ManagedBackupArtifact>
    verify: (job: ManagedBackupJob) => Promise<boolean>
    remove: (job: ManagedBackupJob) => Promise<void>
    removed?: (job: ManagedBackupJob) => Promise<boolean>
    replicate?: (job: ManagedBackupJob, retentionCount: number) => Promise<OffHostReceipt | null>
    offHostAudit?: {
        pending: () => Promise<OffHostConfigurationAudit | null>
        acknowledge: (receipt: OffHostConfigurationAudit) => Promise<void>
    }
    recoverRestore?: (operation: ManagedBackupMaintenance) => Promise<boolean>
    restore?: (
        job: ManagedBackupJob,
        operation: ManagedBackupMaintenance,
        progress: (phase: ManagedBackupMaintenance['phase'], percent: number) => Promise<void>,
    ) => Promise<void>
}
export type ManagedBackupErrorCode =
    | 'busy'
    | 'revision_conflict'
    | 'capacity'
    | 'execution_failed'
    | 'artifact_invalid'
    | 'recovery_failed'
