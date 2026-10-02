import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRedirectHostsTableLogic from './Hooks/useRedirectHostsTableLogic.ts'
import type { RedirectHostsTableProps } from '../../Types/redirect-host-table.types.ts'
export default function RedirectHostsTable(props: RedirectHostsTableProps) {
    const { action, loading, redirectHosts } = props
    const { state, handler, table } = useRedirectHostsTableLogic(props)
    const { t } = useTranslationStore()
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.redirectHosts.table.eyebrow')}
            title={
                loading
                    ? t('admin.redirectHosts.table.loading')
                    : t('admin.redirectHosts.table.count', { count: redirectHosts.length })
            }
            description={t('admin.redirectHosts.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.redirectHosts.table.searchLabel')}
            searchPlaceholder={t('admin.redirectHosts.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={loading}
            loadingLabel={t('admin.redirectHosts.table.loading')}
            emptyState={{
                title: t('admin.redirectHosts.table.emptyTitle'),
                description: t('admin.redirectHosts.table.emptyDescription'),
                action,
            }}
            filteredEmptyState={{
                title: t('admin.redirectHosts.table.filteredEmptyTitle'),
                description: t('admin.redirectHosts.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.redirectHosts.table.itemLabel')}
            action={action}
            tableMinWidthClassName="min-w-[58rem]"
        />
    )
}
