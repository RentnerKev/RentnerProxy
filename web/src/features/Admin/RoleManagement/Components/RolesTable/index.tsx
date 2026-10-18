import DataTable from '@/shared/Table/index.tsx'
import useRolesTableLogic from './Hooks/useRolesTableLogic.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { RolesTableProps } from '../../Types/role-management-component-props.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function RolesTable(props: RolesTableProps) {
    const { t } = useTranslationStore()
    const { canCreate, isLoading, onCreate, roles } = props
    const { state, handler, table } = useRolesTableLogic(props)
    const createAction = canCreate ? (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
            onClick={onCreate}
        >
            {t('admin.roles.actions.add')}
        </button>
    ) : undefined

    return (
        <DataTable
            table={table}
            eyebrow={t('admin.roles.table.eyebrow')}
            title={
                isLoading
                    ? t('admin.roles.table.loading')
                    : t('admin.roles.table.count', { count: roles.length })
            }
            description={t('admin.roles.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.roles.table.searchLabel')}
            searchPlaceholder={t('admin.roles.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={isLoading}
            loadingLabel={t('admin.roles.table.loading')}
            emptyState={{
                title: t('admin.roles.table.emptyTitle'),
                description: t('admin.roles.table.emptyDescription'),
                action: createAction,
            }}
            filteredEmptyState={{
                title: t('admin.roles.table.filteredEmptyTitle'),
                description: t('admin.roles.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.roles.table.itemLabel')}
            action={createAction}
            tableMinWidthClassName="min-w-[64rem]"
        />
    )
}
