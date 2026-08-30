import type { RowData } from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

import SelectControl from '../../Select'
import useTranslationStore from '../../../language/useTranslationStore'
import type { TablePaginationProps } from '../Types/table.types'

const paginationButtonClassName =
    'inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none'

export default function TablePagination<TData extends RowData>({
    table,
    itemLabel,
    pageSizeOptions,
}: TablePaginationProps<TData>) {
    const { t } = useTranslationStore()
    const rowsPerPageLabel = t('table.pagination.rowsPerPage')

    return (
        <table.Subscribe
            selector={(state) => ({
                columnFilters: state.columnFilters,
                globalFilter: state.globalFilter,
                pagination: state.pagination,
            })}
        >
            {({ pagination }) => {
                const filteredRowCount = table.getRowCount()
                const firstItem =
                    filteredRowCount === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
                const lastItem = Math.min(
                    (pagination.pageIndex + 1) * pagination.pageSize,
                    filteredRowCount,
                )
                const pageCount = Math.max(table.getPageCount(), 1)

                return (
                    <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                            <p aria-live="polite">
                                <span className="font-extrabold text-ink-soft">
                                    {t('table.pagination.range', {
                                        from: firstItem,
                                        to: lastItem,
                                        count: filteredRowCount,
                                        item: itemLabel,
                                    })}
                                </span>
                            </p>
                            <div className="flex items-center gap-2">
                                <span>{rowsPerPageLabel}</span>
                                <SelectControl
                                    value={String(pagination.pageSize)}
                                    ariaLabel={rowsPerPageLabel}
                                    options={pageSizeOptions.map((pageSize) => ({
                                        label: String(pageSize),
                                        value: String(pageSize),
                                    }))}
                                    onValueChange={(value) => {
                                        table.setPageSize(Number(value))
                                    }}
                                    className="w-18"
                                />
                            </div>
                        </div>

                        <nav
                            aria-label={t('table.pagination.label')}
                            className="flex items-center justify-between gap-2 sm:justify-end"
                        >
                            <p
                                className="mr-1 min-w-20 text-center text-xs text-muted"
                                aria-live="polite"
                            >
                                {t('table.pagination.page', {
                                    page: pagination.pageIndex + 1,
                                    count: pageCount,
                                })}
                            </p>
                            <button
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => table.firstPage()}
                                disabled={!table.getCanPreviousPage()}
                                aria-label={t('table.pagination.first')}
                            >
                                <ChevronsLeft aria-hidden="true" className="size-4" />
                            </button>
                            <button
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => table.previousPage()}
                                disabled={!table.getCanPreviousPage()}
                                aria-label={t('table.pagination.previous')}
                            >
                                <ChevronLeft aria-hidden="true" className="size-4" />
                            </button>
                            <button
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => table.nextPage()}
                                disabled={!table.getCanNextPage()}
                                aria-label={t('table.pagination.next')}
                            >
                                <ChevronRight aria-hidden="true" className="size-4" />
                            </button>
                            <button
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => table.lastPage()}
                                disabled={!table.getCanNextPage()}
                                aria-label={t('table.pagination.last')}
                            >
                                <ChevronsRight aria-hidden="true" className="size-4" />
                            </button>
                        </nav>
                    </div>
                )
            }}
        </table.Subscribe>
    )
}
