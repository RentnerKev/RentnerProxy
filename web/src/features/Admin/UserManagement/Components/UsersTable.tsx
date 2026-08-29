import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import DataTable from '../../../../shared/Table'
import useUsersTableLogic from '../Hooks/useUsersTableLogic'
import type { UsersTableProps } from '../Types/user-management-component-props.types'

export default function UsersTable(props: UsersTableProps) {
    const { canCreate, createDisabled, isLoading, onCreate, users } = props
    const { state, handler } = useUsersTableLogic(props)
    const createAction = canCreate ? (
        <button
            type="button"
            className={uiClassNames.button.add}
            disabled={createDisabled}
            title={createDisabled ? 'Role options are not available yet.' : undefined}
            onClick={onCreate}
        >
            Add user
        </button>
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
