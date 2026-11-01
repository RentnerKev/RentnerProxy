import type {
    OffHostConfigurationInput,
    OffHostStatus,
} from '@/lib/Backups/Types/off-host.types.ts'
import type { FormEvent } from 'react'
import type {
    ManagedBackupConfiguration,
    ManagedBackupJob,
    ManagedBackupStatus,
} from '@/lib/Backups/Types/backups.types.ts'
import type {
    BackupConfigurationInput,
    BackupDownloadError,
} from '@/lib/Backups/Types/backups-client.types.ts'

export interface BackupsPageProps {
    readonly userId: string
    readonly permissions: readonly string[]
    readonly downloadError?: BackupDownloadError | undefined
}

export interface BackupsLogicResult {
    readonly state: {
        readonly canManage: boolean
        readonly forbidden: boolean
        readonly isLoading: boolean
        readonly isError: boolean
        readonly locked: boolean
        readonly pending: boolean
        readonly confirmOpen: boolean
        readonly uncertain: boolean
        readonly status: ManagedBackupStatus | null
        readonly jobs: readonly ManagedBackupJob[]
        readonly active: ManagedBackupJob | undefined
        readonly lastSuccess: ManagedBackupJob | undefined
    }
    readonly handler: {
        readonly handleRestore: (jobId: string) => Promise<void>
        readonly handleDelete: (jobId: string) => Promise<void>
        readonly handleStart: () => void
        readonly handleConfirmOpenChange: (open: boolean) => void
        readonly handleConfirmStart: () => Promise<void>
        readonly handleSaveOffHost: (
            input: OffHostConfigurationInput,
        ) => Promise<ManagedBackupStatus>
        readonly handleSave: (input: BackupConfigurationInput) => Promise<ManagedBackupStatus>
    }
}

export interface BackupScheduleProps {
    readonly configuration: ManagedBackupConfiguration
    readonly storeId: string
    readonly locked: boolean
    readonly onSave: (input: BackupConfigurationInput) => Promise<ManagedBackupStatus>
}

export interface BackupScheduleLogicResult {
    readonly state: {
        readonly id: string
        readonly enabled: boolean
        readonly intervalHours: string
        readonly retentionCount: string
        readonly conflict: boolean
        readonly pending: boolean
        readonly locked: boolean
        readonly canSave: boolean
        readonly valid: boolean
    }
    readonly handler: {
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
        readonly handleEnabledChange: (enabled: boolean) => void
        readonly handleIntervalChange: (value: string) => void
        readonly handleRetentionChange: (value: string) => void
        readonly handleReset: () => void
    }
}

export interface OffHostBackupProps {
    readonly configuration: OffHostStatus
    readonly locked: boolean
    readonly onSave: (input: OffHostConfigurationInput) => Promise<ManagedBackupStatus>
}
export interface OffHostFormValues {
    enabled: boolean
    endpoint: string
    region: string
    bucket: string
    prefix: string
    accessKeyId: string
    secretAccessKey: string
    recoveryKey: string
    recoveryKeySaved: boolean
}
export interface OffHostBackupLogicResult {
    readonly state: OffHostFormValues & {
        readonly id: string
        readonly locked: boolean
        readonly canSave: boolean
        readonly conflict: boolean
        readonly downloaded: boolean
        readonly recoveryCommand: string
        readonly restoreCommand: string
    }
    readonly handler: {
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
        readonly handleTextChange: (
            name: 'endpoint' | 'region' | 'bucket' | 'prefix' | 'accessKeyId' | 'secretAccessKey',
            value: string,
        ) => void
        readonly handleEnabledChange: (value: boolean) => void
        readonly handleSavedChange: (value: boolean) => void
        readonly handleGenerate: () => void
        readonly handleDownload: () => void
        readonly handleReset: () => void
    }
}
