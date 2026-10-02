import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select/select'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTablePaginationControlsLogic from './Hooks/useTablePaginationControlsLogic.ts'
import type { TablePaginationControlsProps } from './Types/table-pagination-controls.types.ts'

const paginationButtonClassName =
    'inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-2 text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-accent-border hover:text-accent-ring aria-[current=page]:border-accent-border aria-[current=page]:bg-accent-muted aria-[current=page]:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none'

const pageSizeClassName = 'w-18!'
export default function TablePaginationControls(props: TablePaginationControlsProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useTablePaginationControlsLogic(props)
    return (
        <div className="flex min-w-0 flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                <p aria-live="polite">
                    <span className="font-extrabold text-ink-soft">{state.rangeLabel}</span>
                </p>
                <div className="flex min-w-0 items-center gap-2">
                    <span>{state.rowsPerPageLabel}</span>
                    <CustomSelect
                        value={String(state.safePageSize)}
                        aria-label={state.rowsPerPageLabel}
                        options={state.pageSizeOptions}
                        disabled={state.disabled}
                        onValueChange={handler.handlePageSizeChange}
                        className={pageSizeClassName}
                        searchable={false}
                    />
                </div>
            </div>

            <nav
                aria-label={t('table.pagination.label')}
                className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end"
            >
                <p className="mr-1 min-w-20 text-center text-xs text-muted" aria-live="polite">
                    {state.pageLabel}
                </p>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={handler.handleFirstPage}
                    disabled={state.disabled || state.firstPage}
                    aria-label={t('table.pagination.first')}
                >
                    <ChevronsLeft aria-hidden="true" className="size-4" />
                </button>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={handler.handlePreviousPage}
                    disabled={state.disabled || state.firstPage}
                    aria-label={t('table.pagination.previous')}
                >
                    <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    {state.items.map((item) => {
                        if (item.kind === 'ellipsis') {
                            return (
                                <span
                                    key={item.key}
                                    aria-hidden="true"
                                    className="inline-flex size-12 shrink-0 items-center justify-center text-sm font-extrabold text-muted"
                                >
                                    …
                                </span>
                            )
                        }
                        return (
                            <button
                                key={item.key}
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => handler.handlePageChange(item.page)}
                                disabled={state.disabled}
                                aria-current={item.current ? 'page' : undefined}
                                aria-label={item.label}
                            >
                                {item.page}
                            </button>
                        )
                    })}
                </div>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={handler.handleNextPage}
                    disabled={state.disabled || state.lastPage}
                    aria-label={t('table.pagination.next')}
                >
                    <ChevronRight aria-hidden="true" className="size-4" />
                </button>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={handler.handleLastPage}
                    disabled={state.disabled || state.lastPage}
                    aria-label={t('table.pagination.last')}
                >
                    <ChevronsRight aria-hidden="true" className="size-4" />
                </button>
            </nav>
        </div>
    )
}
