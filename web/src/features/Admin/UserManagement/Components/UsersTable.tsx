import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import DataTable from '../../../../shared/Table'
import { Tooltip } from '../../../../shared/Tooltip'
import useTranslationStore from '../../../../language/useTranslationStore'
import useUsersTableLogic from '../Hooks/useUsersTableLogic'
import type { UsersTableProps } from '../Types/user-management-component-props.types'

export default function UsersTable(props: UsersTableProps) {
    const { canCreate, createDisabled, isLoading, onCreate, users } = props
    const { t } = useTranslationStore()
    const { state, handler } = useUsersTableLogic(props)
    const createButton = (
        <button
            type="button"
            className={`${uiClassNames.button.add}${
                createDisabled
                    ? ' cursor-not-allowed opacity-[0.55] hover:translate-y-0! hover:bg-brand-500!'
                    : ''
            }`}
            aria-disabled={createDisabled}
            onClick={createDisabled ? undefined : onCreate}
        >
            {t('admin.users.actions.add')}
        </button>
    )
    const createAction = canCreate ? (
        createDisabled ? (
            <Tooltip content={t('admin.users.messages.rolesNotReady')}>{createButton}</Tooltip>
        ) : (
            createButton
        )
    ) : undefined

    return (
        <DataTable
            table={state.table}
            eyebrow={t('admin.users.table.eyebrow')}
            title={t('admin.users.table.count', { count: users.length })}
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
