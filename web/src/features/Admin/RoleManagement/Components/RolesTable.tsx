import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import DataTable from '../../../../shared/Table'
import useRolesTableLogic from '../Hooks/useRolesTableLogic'
import type { RolesTableProps } from '../Types/role-management-component-props.types'

export default function RolesTable(props: RolesTableProps) {
    const { canCreate, isLoading, onCreate, roles } = props
    const { state, handler } = useRolesTableLogic(props)
    const createAction = canCreate ? (
        <button type="button" className={uiClassNames.button.add} onClick={onCreate}>
            Add role
        </button>
    ) : undefined

    return (
        <DataTable
            table={state.table}
            eyebrow="Registry"
            title={`${roles.length} ${roles.length === 1 ? 'role' : 'roles'}`}
            description="Review system policies and manage custom permission sets through one shared table workflow."
            searchInput={state.searchInput}
            searchLabel="Search roles"
            searchPlaceholder="Search name, key, description, or permission…"
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={isLoading}
            loadingLabel="Loading roles"
            emptyState={{
                title: 'No roles yet',
                description: 'Create the first custom role to define a reusable access policy.',
                action: createAction,
            }}
            filteredEmptyState={{
                title: 'No roles match your filters',
                description: 'Adjust the search or reset the active filters to see more roles.',
            }}
            itemLabel="roles"
            action={createAction}
            tableMinWidthClassName="min-w-[64rem]"
        />
    )
}
