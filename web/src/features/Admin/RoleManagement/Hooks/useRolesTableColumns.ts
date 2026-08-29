import { filterFn_equalsString } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'

import {
    RoleCreatedAtCell,
    RoleDescriptionCell,
    RoleNameCell,
    RolePermissionCountCell,
    RoleTypeCell,
    RoleUserCountCell,
} from '../Components/RoleTableCells'
import RoleTableActions from '../Components/RoleTableActions'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '../../../../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import type { RoleTableActionProps } from '../Types/role-management-component-props.types'

const textFilter = createTrimmedIncludesStringFilter<RoleManagementSummary>()
const dateFilter = createDateRangeFilter<RoleManagementSummary>()

export default function useRolesTableColumns(actions: RoleTableActionProps) {
    return useMemo<Array<ColumnDef<ClientTableFeatures, RoleManagementSummary>>>(
        () => [
            {
                id: 'name',
                accessorFn: (role) => `${role.name} ${role.key}`,
                header: 'Name',
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RoleNameCell, {
                        name: row.original.name,
                        roleKey: row.original.key,
                    }),
            },
            {
                accessorKey: 'description',
                header: 'Description',
                enableSorting: false,
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ getValue }) =>
                    createElement(RoleDescriptionCell, { value: String(getValue()) }),
            },
            {
                id: 'type',
                accessorFn: (role) => (role.isSystem ? 'system' : 'custom'),
                header: 'Type',
                enableSorting: false,
                filterFn: filterFn_equalsString,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RoleTypeCell, {
                        value: getValue() === 'system' ? 'system' : 'custom',
                    }),
            },
            {
                id: 'permissions',
                accessorFn: (role) => role.permissionKeys.length,
                header: 'Permissions',
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RolePermissionCountCell, { value: Number(getValue()) }),
            },
            {
                accessorKey: 'userCount',
                header: 'Users',
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RoleUserCountCell, { value: Number(getValue()) }),
            },
            {
                accessorKey: 'createdAt',
                header: 'Created',
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) => createElement(RoleCreatedAtCell, { value: getValue() }),
            },
            {
                id: 'actions',
                header: 'Actions',
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(RoleTableActions, { ...actions, role: row.original }),
            },
        ],
        [actions],
    )
}
