import type {
    ManagedBackupArtifact,
    ManagedBackupJob,
    ManagedBackupSource,
    ManagedBackupState,
} from '../../../web/src/lib/Backups/Types/backups.types.ts'

export interface ManagedBackupDependencies {
    read: () => Promise<unknown | null>
    write: (state: ManagedBackupState) => Promise<void>
    now: () => number
    id: () => string
    source: () => ManagedBackupSource | Promise<ManagedBackupSource>
    execute: (job: ManagedBackupJob) => Promise<ManagedBackupArtifact>
    verify: (job: ManagedBackupJob) => Promise<boolean>
    remove: (job: ManagedBackupJob) => Promise<void>
}
export type ManagedBackupErrorCode =
    | 'busy'
    | 'revision_conflict'
    | 'capacity'
    | 'execution_failed'
    | 'artifact_invalid'
    | 'recovery_failed'
