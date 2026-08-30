import type { RowData } from '@tanstack/react-table'

import useTranslationStore from '../../../language/useTranslationStore'
import type { TableColumnFiltersProps } from '../Types/table.types'
import TableColumnFilterInput from './TableColumnFilterInput'

export default function TableColumnFilters<TData extends RowData>({
    headerGroup,
    filterConfigs,
}: TableColumnFiltersProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <tr className="border-t border-border bg-surface">
            {headerGroup.headers.map((header) => {
                const config = filterConfigs[header.column.id] ?? {
                    type: 'text',
                    placeholder: t('table.filterColumnPlaceholder', {
                        column: String(header.column.columnDef.header ?? ''),
                    }),
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
