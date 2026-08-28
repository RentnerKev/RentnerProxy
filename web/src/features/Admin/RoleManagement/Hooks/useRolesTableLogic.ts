import { useState } from 'react'
import { useTable } from '@tanstack/react-table'

import type { RolesTableProps } from '../Types/role-management-component-props.types'
import useRolesTableColumns, { roleTableFeatures } from './useRolesTableColumns'

export default function useRolesTableLogic({ roles, ...actions }: RolesTableProps) {
    const [search, setSearch] = useState('')
    const columns = useRolesTableColumns(actions)
    const table = useTable({
        features: roleTableFeatures,
        columns,
        data: roles,
        globalFilterFn: 'includesString',
        getColumnCanGlobalFilter: (column) => column.id !== 'actions',
        state: { globalFilter: search },
        onGlobalFilterChange: setSearch,
    })

    return {
        state: { search, table },
        handler: { setSearch },
    }
}
