import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import DataTable from '@/shared/Table/index.tsx'
import useUsersTableLogic from './Hooks/useUsersTableLogic.ts'
import type { UsersTableProps } from '../../Types/user-management-component-props.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function UsersTable(props: UsersTableProps) {
    const { canCreate, createDisabled, isLoading, onCreate, users } = props
    const { t } = useTranslationStore()
    const { state, handler, table } = useUsersTableLogic(props)
    const createButton = (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
            disabled={createDisabled}
            onClick={onCreate}
        >
            {t('admin.users.actions.add')}
        </button>
    )
    const createAction = canCreate ? (
        createDisabled ? (
            <CustomTooltip
                collisionPadding={10}
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
            table={table}
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
