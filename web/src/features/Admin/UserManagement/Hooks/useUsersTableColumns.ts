import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'

import {
    UserCreatedAtCell,
    UserEmailCell,
    UserNameCell,
    UserRolesCell,
    UserStatusCell,
} from '../Components/UserTableCells'
import UserTableActions from '../Components/UserTableActions'
import {
    createArrayIncludesFilter,
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '../../../../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { UserSummary } from '../../../../shared/Types/auth.types'
import type { UserTableActionProps } from '../Types/user-management-component-props.types'

const textFilter = createTrimmedIncludesStringFilter<UserSummary>()
const roleFilter = createArrayIncludesFilter<UserSummary>()
const dateFilter = createDateRangeFilter<UserSummary>()

export default function useUsersTableColumns(actions: UserTableActionProps) {
    return useMemo<Array<ColumnDef<ClientTableFeatures, UserSummary>>>(
        () => [
            {
                accessorKey: 'displayName',
                header: 'Name',
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(UserNameCell, { user: row.original }),
            },
            {
                accessorKey: 'email',
                header: 'Email',
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ getValue }) => createElement(UserEmailCell, { value: String(getValue()) }),
            },
            {
                accessorKey: 'status',
                header: 'Status',
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ getValue }) =>
                    createElement(UserStatusCell, { value: String(getValue()) }),
            },
            {
                id: 'roles',
                accessorFn: (user) => user.roleKeys,
                header: 'Roles',
                enableSorting: false,
                filterFn: roleFilter,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(UserRolesCell, { roleKeys: row.original.roleKeys }),
            },
            {
                accessorKey: 'createdAt',
                header: 'Created',
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) => createElement(UserCreatedAtCell, { value: getValue() }),
            },
            {
                id: 'actions',
                header: 'Actions',
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(UserTableActions, { ...actions, user: row.original }),
            },
        ],
        [actions],
    )
}
