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
import useTranslationStore from '../../../../language/useTranslationStore'

const textFilter = createTrimmedIncludesStringFilter<UserSummary>()
const roleFilter = createArrayIncludesFilter<UserSummary>()
const dateFilter = createDateRangeFilter<UserSummary>()

export default function useUsersTableColumns(actions: UserTableActionProps) {
    const { t } = useTranslationStore()
    return useMemo<Array<ColumnDef<ClientTableFeatures, UserSummary>>>(
        () => [
            {
                accessorKey: 'displayName',
                header: t('admin.users.columns.name'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(UserNameCell, { user: row.original }),
            },
            {
                accessorKey: 'email',
                header: t('admin.users.columns.email'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ getValue }) => createElement(UserEmailCell, { value: String(getValue()) }),
            },
            {
                accessorKey: 'status',
                header: t('admin.users.columns.status'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ getValue }) =>
                    createElement(UserStatusCell, { value: String(getValue()) }),
            },
            {
                id: 'roles',
                accessorFn: (user) => user.roleKeys,
                header: t('admin.users.columns.roles'),
                enableSorting: false,
                filterFn: roleFilter,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(UserRolesCell, { roleKeys: row.original.roleKeys }),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.users.columns.created'),
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) => createElement(UserCreatedAtCell, { value: getValue() }),
            },
            {
                id: 'actions',
                header: t('admin.users.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(UserTableActions, { ...actions, user: row.original }),
            },
        ],
        [actions, t],
    )
}
