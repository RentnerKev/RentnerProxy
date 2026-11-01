import type { ManagedBackupJob } from '@/lib/Backups/Types/backups.types.ts'
import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { MenuItem } from '@rentnerkev/menu'

export interface BackupActionsProps {
    readonly label: string
    readonly items: readonly MenuItem[]
}

export interface BackupHistorySelection {
    readonly jobId: string
    readonly action: 'restore' | 'delete'
}

export interface BackupHistoryProps {
    readonly jobs: readonly ManagedBackupJob[]
    readonly canDownload: boolean
    readonly canManage: boolean
    readonly locked: boolean
    readonly onRestore: (jobId: string) => Promise<void>
    readonly onDelete: (jobId: string) => Promise<void>
}

export interface BackupHistoryLogicResult {
    readonly table: ClientTable<ManagedBackupJob>
    readonly state: {
        readonly searchInput: string
        readonly showColumnFilters: boolean
        readonly columnFilterConfigs: TableColumnFilterConfigs
        readonly selection: BackupHistorySelection | null
        readonly pending: boolean
        readonly confirmationDisabled: boolean
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly handleToggleColumnFilters: () => void
        readonly handleConfirmationOpenChange: (open: boolean) => void
        readonly handleConfirmAction: () => Promise<void>
    }
}
