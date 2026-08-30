import DataTable from '../../../../shared/Table'
import useTranslationStore from '../../../../language/useTranslationStore'
import useProxyHostsTableLogic from '../Hooks/useProxyHostsTableLogic'
import type { ProxyHostsTableProps } from '../Types/proxy-host-table.types'

export default function ProxyHostsTable(props: ProxyHostsTableProps) {
    const { action, loading, proxyHosts } = props
    const { state, handler } = useProxyHostsTableLogic(props)
    const { t } = useTranslationStore()

    return (
        <DataTable
            table={state.table}
            eyebrow={t('admin.proxyHosts.table.eyebrow')}
            title={t('admin.proxyHosts.table.count', { count: proxyHosts.length })}
            description={t('admin.proxyHosts.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.proxyHosts.table.searchLabel')}
            searchPlaceholder={t('admin.proxyHosts.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={loading}
            loadingLabel={t('admin.proxyHosts.table.loading')}
            emptyState={{
                title: t('admin.proxyHosts.table.emptyTitle'),
                description: t('admin.proxyHosts.table.emptyDescription'),
                action,
            }}
            filteredEmptyState={{
                title: t('admin.proxyHosts.table.filteredEmptyTitle'),
                description: t('admin.proxyHosts.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.proxyHosts.table.itemLabel')}
            action={action}
            tableMinWidthClassName="min-w-[52rem]"
        />
    )
}
