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
        readonly refreshing: boolean
        readonly locked: boolean
        readonly pending: boolean
        readonly confirmOpen: boolean
        readonly uncertain: boolean
        readonly notice: string
        readonly status: ManagedBackupStatus | null
        readonly jobs: readonly ManagedBackupJob[]
        readonly active: ManagedBackupJob | undefined
        readonly lastSuccess: ManagedBackupJob | undefined
    }
    readonly handler: {
        readonly handleRefresh: () => void
        readonly handleStart: () => void
        readonly handleConfirmOpenChange: (open: boolean) => void
        readonly handleConfirmStart: () => Promise<void>
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
        readonly notice: string
    }
    readonly handler: {
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
        readonly handleEnabledChange: (enabled: boolean) => void
        readonly handleIntervalChange: (value: string) => void
        readonly handleRetentionChange: (value: string) => void
        readonly handleReset: () => void
    }
}
