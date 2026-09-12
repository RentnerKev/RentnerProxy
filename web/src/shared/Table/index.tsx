import type { RowData } from '@tanstack/react-table'

import TableLayout from './Components/TableLayout'
import TableFilters from './Components/TableFilters'
import TableFilterToggle from './Components/TableFilterToggle'
import useTableFilters from './Hooks/useTableFilters'
import TableColumnFilters from './Components/TableColumnFilters'
import TableBody from './Components/TableBody'
import TableHead from './Components/TableHead'
import TablePagination from './Components/TablePagination'
import TableToolbar from './Components/TableToolbar'
import useDataTableIds from './Hooks/useDataTableIds'
import type { DataTableProps } from './Types/table.types'

const defaultPageSizeOptions = [5, 10, 20, 50] as const
const defaultColumnFilterConfigs = {}

export default function DataTable<TData extends RowData>({
    table,
    eyebrow,
    title,
    description,
    searchInput,
    searchLabel,
    searchPlaceholder,
    showColumnFilters,
    enableColumnFilters = true,
    onSearchChange,
    onToggleColumnFilters,
    onResetFilters,
    columnFilterConfigs = defaultColumnFilterConfigs,
    isLoading = false,
    loadingLabel,
    emptyState,
    filteredEmptyState,
    itemLabel,
    pageSizeOptions = defaultPageSizeOptions,
    action,
    tableMinWidthClassName = 'min-w-[60rem]',
}: DataTableProps<TData>) {
    const { searchId, titleId } = useDataTableIds()
    const filterPanel = useTableFilters(showColumnFilters, onToggleColumnFilters)

    return (
        <TableLayout
            titleId={titleId}
            title={title}
            eyebrow={eyebrow}
            description={description}
            toolbar={
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                    <TableToolbar
                        searchInput={searchInput}
                        searchId={searchId}
                        searchLabel={searchLabel}
                        searchPlaceholder={searchPlaceholder}
                        onSearchChange={onSearchChange}
                    />
                    {action}
                </div>
            }
            filterToggle={
                enableColumnFilters ? (
                    <table.Subscribe
                        source={table.atoms.columnFilters}
                        selector={(filters) => filters.length}
                    >
                        {(count) => (
                            <TableFilterToggle
                                contentId={filterPanel.contentId}
                                expanded={filterPanel.open}
                                onToggle={filterPanel.toggle}
                                activeCount={count + (searchInput.trim() ? 1 : 0)}
                            />
                        )}
                    </table.Subscribe>
                ) : null
            }
            filters={
                enableColumnFilters ? (
                    <table.Subscribe
                        source={table.atoms.columnFilters}
                        selector={(filters) => filters.length}
                    >
                        {(count) => (
                            <TableFilters
                                contentId={filterPanel.contentId}
                                expanded={filterPanel.open}
                                activeCount={count + (searchInput.trim() ? 1 : 0)}
                                onReset={onResetFilters}
                            >
                                <TableColumnFilters
                                    table={table}
                                    filterConfigs={columnFilterConfigs}
                                />
                            </TableFilters>
                        )}
                    </table.Subscribe>
                ) : null
            }
            pagination={
                <TablePagination
                    table={table}
                    itemLabel={itemLabel}
                    pageSizeOptions={pageSizeOptions}
                />
            }
        >
            <div className="overflow-x-auto">
                <table className={`w-full border-collapse ${tableMinWidthClassName}`}>
                    <TableHead table={table} />
                    <TableBody
                        table={table}
                        isLoading={isLoading}
                        loadingLabel={loadingLabel}
                        emptyState={emptyState}
                        filteredEmptyState={filteredEmptyState}
                    />
                </table>
            </div>
        </TableLayout>
    )
}

export { default as RemoteTablePagination } from './Components/RemoteTablePagination'
export { default as TablePaginationControls } from './Components/TablePaginationControls'
export { remoteTablePageSizeOptions } from './Components/RemoteTablePagination'
export { getPaginationItems } from './Components/TablePaginationControls'
export type { RemoteTablePaginationProps, TablePaginationControlsProps } from './Types/table.types'
