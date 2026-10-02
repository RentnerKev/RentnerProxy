import DataTable from '@/shared/Table/index.tsx'
import useRolesTableLogic from './Hooks/useRolesTableLogic.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { RolesTableProps } from '../../Types/role-management-component-props.types.ts'

export default function RolesTable(props: RolesTableProps) {
    const { t } = useTranslationStore()
    const { canCreate, isLoading, onCreate, roles } = props
    const { state, handler, table } = useRolesTableLogic(props)
    const createAction = canCreate ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
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
