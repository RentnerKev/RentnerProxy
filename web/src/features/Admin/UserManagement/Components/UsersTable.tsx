import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import { TOOLTIP_DEFAULT_PROPS } from '../../../../config/tooltip.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import DataTable from '../../../../shared/Table'
import useUsersTableLogic from '../Hooks/useUsersTableLogic'
import type { UsersTableProps } from '../Types/user-management-component-props.types'

export default function UsersTable(props: UsersTableProps) {
    const { canCreate, createDisabled, isLoading, onCreate, users } = props
    const { t } = useTranslationStore()
    const { state, handler } = useUsersTableLogic(props)
    const createButton = (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
            disabled={createDisabled}
            onClick={onCreate}
        >
            {t('admin.users.actions.add')}
        </button>
    )
    const createAction = canCreate ? (
        createDisabled ? (
            <CustomTooltip
                {...TOOLTIP_DEFAULT_PROPS}
                content={t('admin.users.messages.rolesNotReady')}
                disabledTrigger
            >
                {createButton}
            </CustomTooltip>
        ) : (
            createButton
        )
    ) : undefined

    return (
        <DataTable
            table={state.table}
            eyebrow={t('admin.users.table.eyebrow')}
            title={
                isLoading
                    ? t('admin.users.table.loading')
                    : t('admin.users.table.count', { count: users.length })
            }
            description={t('admin.users.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.users.table.searchLabel')}
            searchPlaceholder={t('admin.users.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={isLoading}
            loadingLabel={t('admin.users.table.loading')}
            emptyState={{
                title: t('admin.users.table.emptyTitle'),
                description: t('admin.users.table.emptyDescription'),
                action: createAction,
            }}
            filteredEmptyState={{
                title: t('admin.users.table.filteredEmptyTitle'),
                description: t('admin.users.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.users.table.itemLabel')}
            action={createAction}
            tableMinWidthClassName="min-w-[58rem]"
        />
    )
}
