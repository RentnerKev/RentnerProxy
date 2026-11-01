import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import DataTable from '@/shared/Table/index.tsx'
import useBackupHistoryLogic from './Hooks/useBackupHistoryLogic.ts'
import type { BackupHistoryProps } from './Types/backup-history.types.ts'

export default function BackupHistory(props: BackupHistoryProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useBackupHistoryLogic(props)
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.backups.eyebrow')}
            title={t('admin.backups.history.title')}
            description={t('admin.backups.history.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.backups.history.searchLabel')}
            searchPlaceholder={t('admin.backups.history.searchPlaceholder')}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.handleToggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            showColumnFilters={state.showColumnFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            loadingLabel={t('admin.backups.loading')}
            emptyState={{
                title: t('admin.backups.history.noData'),
                description: t('admin.backups.history.emptyDescription'),
            }}
            filteredEmptyState={{
                title: t('admin.backups.history.filteredEmptyTitle'),
                description: t('admin.backups.history.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.backups.history.itemLabel')}
            tableMinWidthClassName="min-w-[64rem]"
        />
    )
}
