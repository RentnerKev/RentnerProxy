import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import DataTable from '@/shared/Table/index.tsx'
import useMonitoringChecksTableLogic from './Hooks/useMonitoringChecksTableLogic.ts'
import type { MonitoringChecksTableProps } from './Types/checks-table.types.ts'

export default function MonitoringChecksTable(props: MonitoringChecksTableProps) {
    const { state, handler, table } = useMonitoringChecksTableLogic(props.observations)
    const { t } = useTranslationStore()
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.hostMonitoring.table.eyebrow')}
            title={t('admin.hostMonitoring.observations')}
            description={t('admin.hostMonitoring.table.description', {
                count: props.observations.length,
            })}
            searchInput={state.searchInput}
            searchLabel={t('admin.hostMonitoring.table.searchLabel')}
            searchPlaceholder={t('admin.hostMonitoring.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.handleToggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            loadingLabel={t('admin.hostMonitoring.loading')}
            emptyState={{
                title: t('admin.hostMonitoring.noData'),
                description: t('admin.hostMonitoring.table.description', { count: 0 }),
            }}
            filteredEmptyState={{
                title: t('admin.hostMonitoring.table.filteredEmptyTitle'),
                description: t('admin.hostMonitoring.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.hostMonitoring.table.itemLabel')}
            tableMinWidthClassName="min-w-[46rem]"
            action={
                props.more ? (
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={props.loadingMore}
                        onClick={props.onLoadMore}
                    >
                        {t('admin.hostMonitoring.table.loadOlder')}
                    </button>
                ) : null
            }
        />
    )
}
