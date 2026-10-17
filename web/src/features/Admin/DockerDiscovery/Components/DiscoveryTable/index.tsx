import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDiscoveryTableLogic from './Hooks/useDiscoveryTableLogic.ts'
import type { DiscoveryTableProps } from '../../Types/discovery-ui.types.ts'
export default function DiscoveryTable(props: DiscoveryTableProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useDiscoveryTableLogic(props)
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.dockerDiscovery.table.eyebrow')}
            title={t('admin.dockerDiscovery.table.title', { count: props.rows.length })}
            searchInput={state.searchInput}
            searchLabel={t('admin.dockerDiscovery.table.search')}
            searchPlaceholder={t('admin.dockerDiscovery.table.searchPlaceholder')}
            onSearchChange={handler.handleSearchInputChange}
            showColumnFilters={state.showColumnFilters}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            loadingLabel={t('common.loading')}
            isLoading={props.loading}
            emptyState={{
                title: t('admin.dockerDiscovery.table.emptyTitle'),
                description: t('admin.dockerDiscovery.table.emptyDescription'),
            }}
            filteredEmptyState={{
                title: t('admin.dockerDiscovery.table.filteredTitle'),
                description: t('admin.dockerDiscovery.table.filteredDescription'),
            }}
            itemLabel={t('admin.dockerDiscovery.table.itemLabel')}
            tableMinWidthClassName="min-w-[64rem]"
        />
    )
}
