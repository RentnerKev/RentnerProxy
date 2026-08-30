import type { RowData } from '@tanstack/react-table'

import useTranslationStore from '../../../language/useTranslationStore'
import type { TableBodyProps } from '../Types/table.types'
import TableBodyState from './TableBodyState'
import TableLoadingBody from './TableLoadingBody'

export default function TableBody<TData extends RowData>({
    table,
    isLoading,
    loadingLabel,
    emptyState,
    filteredEmptyState,
}: TableBodyProps<TData>) {
    const { t } = useTranslationStore()
    const columnCount = Math.max(table.getAllLeafColumns().length, 1)

    if (isLoading) {
        return <TableLoadingBody columnCount={columnCount} loadingLabel={loadingLabel} />
    }

    return (
        <tbody>
            <table.Subscribe
                selector={(state) => ({
                    sorting: state.sorting,
                    columnFilters: state.columnFilters,
                    globalFilter: state.globalFilter,
                    pagination: state.pagination,
                })}
            >
                {({ columnFilters, globalFilter }) => {
                    const rows = table.getRowModel().rows

                    if (rows.length === 0) {
                        const hasActiveFilters =
                            columnFilters.length > 0 || String(globalFilter ?? '').trim().length > 0

                        return (
                            <TableBodyState
                                columnCount={columnCount}
                                state={hasActiveFilters ? filteredEmptyState : emptyState}
                            />
                        )
                    }

                    return rows.map((row) => (
                        <tr
                            key={row.id}
                            className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover"
                        >
                            {row.getAllCells().map((cell) => (
                                <td
                                    key={cell.id}
                                    aria-label={t('table.cell', {
                                        column: cell.column.id,
                                    })}
                                    className="px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft"
                                >
                                    <div className="min-w-0">
                                        <table.FlexRender cell={cell} />
                                    </div>
                                </td>
                            ))}
                        </tr>
                    ))
                }}
            </table.Subscribe>
        </tbody>
    )
}
