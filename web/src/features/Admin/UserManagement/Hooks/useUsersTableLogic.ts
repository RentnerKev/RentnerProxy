import { useState } from 'react'
import { useTable } from '@tanstack/react-table'

import type { UsersTableProps } from '../Types/user-management-component-props.types'
import useUsersTableColumns, { userTableFeatures } from './useUsersTableColumns'

export default function useUsersTableLogic({ users, ...actions }: UsersTableProps) {
    const [search, setSearch] = useState('')
    const columns = useUsersTableColumns(actions)
    const table = useTable({
        features: userTableFeatures,
        columns,
        data: users,
        globalFilterFn: 'includesString',
        getColumnCanGlobalFilter: (column) => column.id !== 'actions' && column.id !== 'createdAt',
        state: { globalFilter: search },
        onGlobalFilterChange: setSearch,
    })

    return {
        state: { search, table },
        handler: { setSearch },
    }
}
