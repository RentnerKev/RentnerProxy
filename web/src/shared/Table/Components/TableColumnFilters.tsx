import type { RowData } from '@tanstack/react-table'

import type { TableColumnFiltersProps } from '../Types/table.types'
import TableColumnFilterInput from './TableColumnFilterInput'

export default function TableColumnFilters<TData extends RowData>({
    headerGroup,
    filterConfigs,
}: TableColumnFiltersProps<TData>) {
    return (
        <tr className="border-t border-border bg-surface">
            {headerGroup.headers.map((header) => {
                const config = filterConfigs[header.column.id] ?? {
                    type: 'text',
                    placeholder: `Filter ${String(header.column.columnDef.header ?? '')}…`,
                }

                return (
                    <th key={`${header.id}-filter`} className="px-4 py-2.5 align-top">
                        {header.column.getCanFilter() ? (
                            <TableColumnFilterInput column={header.column} config={config} />
                        ) : (
                            <span className="block h-9" />
                        )}
                    </th>
                )
            })}
        </tr>
    )
}
