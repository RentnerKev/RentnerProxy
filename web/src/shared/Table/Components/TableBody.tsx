import type { RowData } from '@tanstack/react-table'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { TableBodyProps } from '../Types/table.types.ts'
import TableBodyState from './TableBodyState.tsx'
import TableLoadingBody from './TableLoadingBody.tsx'

export default function TableBody<TData extends RowData>({
    table,
    isLoading,
    loadingLabel,
    emptyState,
    filteredEmptyState,
}: TableBodyProps<TData>) {
    const { t } = useTranslationStore()
    return (
        <table.Subscribe
            selector={(state) => ({
                sorting: state.sorting,
                columnFilters: state.columnFilters,
                globalFilter: state.globalFilter,
                pagination: state.pagination,
                columnVisibility: state.columnVisibility,
            })}
        >
            {({ columnFilters, globalFilter }) => {
                const columnCount = Math.max(table.getVisibleLeafColumns().length, 1)
                if (isLoading)
                    return (
                        <TableLoadingBody columnCount={columnCount} loadingLabel={loadingLabel} />
                    )
                const rows = table.getRowModel().rows
                const hasActiveFilters =
                    columnFilters.length > 0 || String(globalFilter ?? '').trim().length > 0
                return (
                    <tbody>
                        {rows.length === 0 ? (
                            <TableBodyState
                                columnCount={columnCount}
                                state={hasActiveFilters ? filteredEmptyState : emptyState}
                            />
                        ) : (
                            rows.map((row) => (
                                <tr
                                    key={row.id}
                                    className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <td
                                            key={cell.id}
                                            aria-label={t('table.cell', { column: cell.column.id })}
                                            className={`py-[0.85rem] align-middle text-[0.78rem] text-ink-soft ${cell.column.id === 'selection' ? 'w-px px-3 whitespace-nowrap' : 'px-4'} ${cell.column.id === 'actions' ? 'sticky right-0 bg-surface text-right' : ''}`}
                                        >
                                            <div className="min-w-0">
                                                <table.FlexRender cell={cell} />
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                )
            }}
        </table.Subscribe>
    )
}
