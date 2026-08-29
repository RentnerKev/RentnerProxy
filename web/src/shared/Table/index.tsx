import type { RowData } from '@tanstack/react-table'

import { uiClassNames } from '../Styles/uiClassNames'
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

    return (
        <section aria-labelledby={titleId} className={uiClassNames.table.panel}>
            <TableToolbar
                table={table}
                titleId={titleId}
                eyebrow={eyebrow}
                title={title}
                description={description}
                searchInput={searchInput}
                searchId={searchId}
                searchLabel={searchLabel}
                searchPlaceholder={searchPlaceholder}
                showColumnFilters={showColumnFilters}
                enableColumnFilters={enableColumnFilters}
                onSearchChange={onSearchChange}
                onToggleColumnFilters={onToggleColumnFilters}
                onResetFilters={onResetFilters}
                action={action}
            />
            <div className="overflow-x-auto">
                <table className={`w-full border-collapse ${tableMinWidthClassName}`}>
                    <TableHead
                        table={table}
                        showColumnFilters={showColumnFilters}
                        columnFilterConfigs={columnFilterConfigs}
                    />
                    <TableBody
                        table={table}
                        isLoading={isLoading}
                        loadingLabel={loadingLabel}
                        emptyState={emptyState}
                        filteredEmptyState={filteredEmptyState}
                    />
                </table>
            </div>
            <TablePagination
                table={table}
                itemLabel={itemLabel}
                pageSizeOptions={pageSizeOptions}
            />
        </section>
    )
}
