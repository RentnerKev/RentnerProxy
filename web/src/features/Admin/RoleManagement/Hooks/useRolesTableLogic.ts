import type { FilterFn } from '@tanstack/react-table'
import { useState } from 'react'

import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { RolesTableProps } from '../Types/role-management-component-props.types'
import useRolesTableColumns from './useRolesTableColumns'

const getRoleRowId = (role: RoleManagementSummary) => role.id

const roleGlobalFilter: FilterFn<ClientTableFeatures, RoleManagementSummary> = (
    row,
    _columnId,
    filterValue,
) => {
    const search = String(filterValue).trim().toLocaleLowerCase()

    if (!search) {
        return true
    }

    return [
        row.original.name,
        row.original.key,
        row.original.description,
        row.original.isSystem ? 'system' : 'custom',
        ...row.original.permissionKeys,
    ].some((value) => value.toLocaleLowerCase().includes(search))
}

const columnFilterConfigs = {
    name: { type: 'text', placeholder: 'Filter name or key…', maxLength: 100 },
    description: { type: 'text', placeholder: 'Filter descriptions…', maxLength: 200 },
    type: {
        type: 'select',
        placeholder: 'All types',
        options: [
            { label: 'System', value: 'system' },
            { label: 'Custom', value: 'custom' },
        ],
    },
    createdAt: { type: 'dateRange', fromLabel: 'Created from', toLabel: 'Created to' },
} as const satisfies TableColumnFilterConfigs

export default function useRolesTableLogic({ roles, ...actions }: RolesTableProps) {
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useRolesTableColumns(actions)
    const tableLogic = useClientTableLogic({
        data: roles,
        columns,
        getRowId: getRoleRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: roleGlobalFilter,
    })

    return {
        state: {
            ...tableLogic.state,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            ...tableLogic.handler,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}
