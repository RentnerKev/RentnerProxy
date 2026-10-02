import useDataTableLogic from './Hooks/useDataTableLogic.ts'
import type { RowData } from '@tanstack/react-table'

import TableLayout from './Components/TableLayout.tsx'
import TableFilters from './Components/TableFilters.tsx'
import TableFilterToggle from './Components/TableFilterToggle.tsx'
import TableColumnFilters from './Components/TableColumnFilters.tsx'
import TableBody from './Components/TableBody.tsx'
import TableHead from './Components/TableHead.tsx'
import TablePagination from './Components/TablePagination.tsx'
import TableToolbar from './Components/TableToolbar.tsx'
import type { DataTableProps } from './Types/table.types.ts'

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
    const { state, handler } = useDataTableLogic({ showColumnFilters, onToggleColumnFilters })

    return (
        <TableLayout
            titleId={state.titleId}
            title={title}
            eyebrow={eyebrow}
            description={description}
            toolbar={
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                    <TableToolbar
                        searchInput={searchInput}
                        searchId={state.searchId}
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
                                contentId={state.filterPanelId}
                                expanded={state.filtersExpanded}
                                onToggle={handler.handleToggleFilters}
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
                                contentId={state.filterPanelId}
                                expanded={state.filtersExpanded}
                                activeCount={count + (searchInput.trim() ? 1 : 0)}
                                onReset={onResetFilters}
                            >
                                {(resetButton) => (
                                    <div className="grid min-w-0 items-end gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                        <TableColumnFilters
                                            table={table}
                                            filterConfigs={columnFilterConfigs}
                                            resetButton={resetButton}
                                        />
                                    </div>
                                )}
                            </TableFilters>
                        )}
                    </table.Subscribe>
                ) : null
            }
            pagination={
                isLoading ? null : (
                    <TablePagination
                        table={table}
                        itemLabel={itemLabel}
                        pageSizeOptions={pageSizeOptions}
                    />
                )
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

export { default as RemoteTablePagination } from './Components/RemoteTablePagination.tsx'
export { default as TablePaginationControls } from './Components/TablePaginationControls/index.tsx'
export { remoteTablePageSizeOptions } from './Components/RemoteTablePagination.tsx'
export { getPaginationItems } from '@/lib/Table/pagination.ts'
export type { RemoteTablePaginationProps } from './Types/table.types.ts'
export type { TablePaginationControlsProps } from './Components/TablePaginationControls/Types/table-pagination-controls.types.ts'
