import useTranslationStore from '../../../../language/useTranslationStore'
import DataTable from '../../../../shared/Table'
import useAccessPoliciesTableLogic from '../Hooks/useAccessPoliciesTableLogic'
import type { AccessPoliciesTableProps } from '../Types/access-policy-table.types'

export default function AccessPoliciesTable(props: AccessPoliciesTableProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useAccessPoliciesTableLogic(props)

    return (
        <DataTable
            table={state.table}
            eyebrow={t('admin.accessPolicies.table.eyebrow')}
            title={
                props.isLoading
                    ? t('admin.accessPolicies.table.loading')
                    : t('admin.accessPolicies.table.count', { count: props.policies.length })
            }
            description={t('admin.accessPolicies.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.accessPolicies.table.searchLabel')}
            searchPlaceholder={t('admin.accessPolicies.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={props.isLoading}
            loadingLabel={t('admin.accessPolicies.table.loading')}
            emptyState={{
                title: t('admin.accessPolicies.table.emptyTitle'),
                description: t('admin.accessPolicies.table.emptyDescription'),
                action: props.action,
            }}
            filteredEmptyState={{
                title: t('admin.accessPolicies.table.filteredEmptyTitle'),
                description: t('admin.accessPolicies.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.accessPolicies.table.itemLabel')}
            action={props.action}
            tableMinWidthClassName="min-w-[60rem]"
        />
    )
}
