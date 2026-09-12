import type { RowData } from '@tanstack/react-table'
import TablePaginationControls from './TablePaginationControls'
import type { TablePaginationProps } from '../Types/table.types'

export default function TablePagination<TData extends RowData>({
    table,
    itemLabel,
    pageSizeOptions,
}: TablePaginationProps<TData>) {
    return (
        <table.Subscribe
            selector={(state) => ({
                columnFilters: state.columnFilters,
                globalFilter: state.globalFilter,
                pagination: state.pagination,
            })}
        >
            {({ pagination }) => {
                return (
                    <TablePaginationControls
                        pageIndex={pagination.pageIndex}
                        pageSize={pagination.pageSize}
                        total={table.getRowCount()}
                        itemLabel={itemLabel}
                        pageSizeOptions={pageSizeOptions}
                        onPageChange={table.setPageIndex}
                        onPageSizeChange={table.setPageSize}
                    />
                )
            }}
        </table.Subscribe>
    )
}
