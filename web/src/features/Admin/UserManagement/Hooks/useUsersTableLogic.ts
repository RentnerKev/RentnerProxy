import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import { createSortedUniqueFilterOptions } from '../../../../shared/Table/Helpers/tableFilters'
import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { UserSummary } from '../../../../shared/Types/auth.types'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { UsersTableProps } from '../Types/user-management-component-props.types'
import useUsersTableColumns from './useUsersTableColumns'

const getUserRowId = (user: UserSummary) => user.id

const userGlobalFilter: FilterFn<ClientTableFeatures, UserSummary> = (
    row,
    _columnId,
    filterValue,
) => {
    const search = String(filterValue).trim().toLocaleLowerCase()

    if (!search) {
        return true
    }

    return [
        row.original.displayName,
        row.original.email,
        row.original.status,
        ...row.original.roleKeys,
    ].some((value) => value.toLocaleLowerCase().includes(search))
}

export default function useUsersTableLogic({ users, ...actions }: UsersTableProps) {
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useUsersTableColumns(actions)
    const tableLogic = useClientTableLogic({
        data: users,
        columns,
        getRowId: getUserRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: userGlobalFilter,
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            displayName: { type: 'text', placeholder: 'Filter names…', maxLength: 100 },
            email: { type: 'text', placeholder: 'Filter email…', maxLength: 254 },
            status: {
                type: 'select',
                placeholder: 'All statuses',
                options: [
                    { label: 'Active', value: 'active' },
                    { label: 'Pending', value: 'pending' },
                    { label: 'Disabled', value: 'disabled' },
                ],
            },
            roles: {
                type: 'select',
                placeholder: 'All roles',
                options: createSortedUniqueFilterOptions(
                    users.flatMap((user) => [...user.roleKeys]),
                ),
            },
            createdAt: { type: 'dateRange', fromLabel: 'Created from', toLabel: 'Created to' },
        }),
        [users],
    )

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
