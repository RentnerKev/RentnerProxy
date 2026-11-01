import type {
    ManagedBackupConfigurationUpdate,
    ManagedBackupStart,
    ManagedBackupDelete,
} from './backups.types.ts'

export type BackupStartInput = Omit<ManagedBackupStart, 'actorId'>
export type BackupConfigurationInput = Omit<ManagedBackupConfigurationUpdate, 'actorId'>
export type BackupActionInput = Omit<ManagedBackupDelete, 'actorId'> & { readonly jobId: string }
export type BackupClientErrorCode =
    | 'authentication_required'
    | 'permission_denied'
    | 'invalid_input'
    | 'busy'
    | 'revision_conflict'
    | 'capacity'
    | 'rate_limited'
    | 'unavailable'
    | 'invalid_response'
    | 'aborted'
    | 'not_found'
    | 'artifact_invalid'
    | 'appliance_required'

export type BackupDownloadError =
    | 'not_found'
    | 'conflict'
    | 'unavailable'
    | 'permission_denied'
    | 'authentication_required'
    | 'rate_limited'
