import TablePaginationControls from './TablePaginationControls/index.tsx'
import type { RemoteTablePaginationProps } from '../Types/table.types.ts'

export const remoteTablePageSizeOptions = [15, 25, 50, 100] as const

export default function RemoteTablePagination({
    pageIndex,
    pageSize,
    total,
    itemLabel,
    onPageChange,
    onPageSizeChange,
    disabled,
    pageSizeOptions = remoteTablePageSizeOptions,
}: RemoteTablePaginationProps) {
    return (
        <TablePaginationControls
            pageIndex={pageIndex}
            pageSize={pageSize}
            total={total}
            itemLabel={itemLabel}
            pageSizeOptions={pageSizeOptions}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            disabled={disabled ?? false}
        />
    )
}
