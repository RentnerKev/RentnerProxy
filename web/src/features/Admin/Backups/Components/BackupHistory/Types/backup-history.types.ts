import type { ManagedBackupJob } from '@/lib/Backups/Types/backups.types.ts'
import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'

export interface BackupHistoryProps {
    readonly jobs: readonly ManagedBackupJob[]
    readonly canDownload: boolean
}

export interface BackupHistoryLogicResult {
    readonly table: ClientTable<ManagedBackupJob>
    readonly state: {
        readonly searchInput: string
        readonly showColumnFilters: boolean
        readonly columnFilterConfigs: TableColumnFilterConfigs
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
        readonly handleToggleColumnFilters: () => void
    }
}
