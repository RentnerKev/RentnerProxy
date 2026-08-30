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
import useTranslationStore from '../../../../language/useTranslationStore'

const textFilter = createTrimmedIncludesStringFilter<RoleManagementSummary>()
const dateFilter = createDateRangeFilter<RoleManagementSummary>()

export default function useRolesTableColumns(actions: RoleTableActionProps) {
    const { t } = useTranslationStore()
    return useMemo<Array<ColumnDef<ClientTableFeatures, RoleManagementSummary>>>(
        () => [
            {
                id: 'name',
                accessorFn: (role) =>
                    role.isSystem
                        ? `${t(`systemRoles.${role.key}.name`)} ${role.name} ${role.key}`
                        : `${role.name} ${role.key}`,
                header: t('admin.roles.columns.name'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(RoleNameCell, {
                        name: row.original.name,
                        roleKey: row.original.key,
                        isSystem: row.original.isSystem,
                    }),
            },
            {
                id: 'description',
                accessorFn: (role) =>
                    role.isSystem
                        ? `${t(`systemRoles.${role.key}.description`)} ${role.description}`
                        : role.description,
                header: t('admin.roles.columns.description'),
                enableSorting: false,
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ getValue, row }) =>
                    createElement(RoleDescriptionCell, {
                        value: String(getValue()),
                        isSystem: row.original.isSystem,
                        roleKey: row.original.key,
                    }),
            },
            {
                id: 'type',
                accessorFn: (role) => (role.isSystem ? 'system' : 'custom'),
                header: t('admin.roles.columns.type'),
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
                header: t('admin.roles.columns.permissions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RolePermissionCountCell, { value: Number(getValue()) }),
            },
            {
                accessorKey: 'userCount',
                header: t('admin.roles.columns.users'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(RoleUserCountCell, { value: Number(getValue()) }),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.roles.columns.created'),
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) => createElement(RoleCreatedAtCell, { value: getValue() }),
            },
            {
                id: 'actions',
                header: t('admin.roles.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(RoleTableActions, { ...actions, role: row.original }),
            },
        ],
        [actions, t],
    )
}
