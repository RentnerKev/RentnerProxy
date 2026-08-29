import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import DataTable from '../../../../shared/Table'
import { Tooltip } from '../../../../shared/Tooltip'
import useUsersTableLogic from '../Hooks/useUsersTableLogic'
import type { UsersTableProps } from '../Types/user-management-component-props.types'

export default function UsersTable(props: UsersTableProps) {
    const { canCreate, createDisabled, isLoading, onCreate, users } = props
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
            Add user
        </button>
    )
    const createAction = canCreate ? (
        createDisabled ? (
            <Tooltip content="Role options are not available yet.">{createButton}</Tooltip>
        ) : (
            createButton
        )
    ) : undefined

    return (
        <DataTable
            table={state.table}
            eyebrow="Directory"
            title={`${users.length} ${users.length === 1 ? 'user' : 'users'}`}
            description="Search the directory, refine individual columns, and manage access from one consistent view."
            searchInput={state.searchInput}
            searchLabel="Search users"
            searchPlaceholder="Search name, email, status, or role…"
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={isLoading}
            loadingLabel="Loading users"
            emptyState={{
                title: 'No users yet',
                description: 'Create the first user to start building the access directory.',
                action: createAction,
            }}
            filteredEmptyState={{
                title: 'No users match your filters',
                description: 'Adjust the search or reset the active filters to see more users.',
            }}
            itemLabel="users"
            action={createAction}
            tableMinWidthClassName="min-w-[58rem]"
        />
    )
}
