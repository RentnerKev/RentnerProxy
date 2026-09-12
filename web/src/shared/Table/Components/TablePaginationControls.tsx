import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

import SelectControl from '../../Select'
import useTranslationStore from '../../../language/useTranslationStore'
import type { TablePaginationControlsProps } from '../Types/table.types'

export type TablePaginationItem = number | 'ellipsis'

const paginationButtonClassName =
    'inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-2 text-sm font-extrabold text-muted transition-[background-color,border-color,color] hover:border-brand-600 hover:text-brand-text aria-[current=page]:border-brand-600 aria-[current=page]:bg-success-bg aria-[current=page]:text-success-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none'

const pageSizeClassName = 'w-18'
const maxVisiblePageItems = 7

function positiveInteger(value: number, fallback: number): number {
    return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : fallback
}

export function getPaginationItems(pageIndex: number, pageCount: number): TablePaginationItem[] {
    const count = positiveInteger(pageCount, 1)
    const current = Math.min(Math.max(Number.isInteger(pageIndex) ? pageIndex : 0, 0), count - 1)

    if (count <= maxVisiblePageItems) {
        return Array.from({ length: count }, (_, index) => index + 1)
    }

    if (current <= 3) return [1, 2, 3, 4, 5, 'ellipsis', count]
    if (current >= count - 4) {
        return [1, 'ellipsis', count - 4, count - 3, count - 2, count - 1, count]
    }
    return [1, 'ellipsis', current, current + 1, current + 2, 'ellipsis', count]
}

function pageCountFor(total: number, pageSize: number): number {
    const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
    return Math.max(1, Math.ceil(safeTotal / positiveInteger(pageSize, 1)))
}

export default function TablePaginationControls({
    pageIndex,
    pageSize,
    total,
    pageSizeOptions,
    itemLabel,
    onPageChange,
    onPageSizeChange,
    disabled = false,
}: TablePaginationControlsProps) {
    const { t } = useTranslationStore()
    const safePageSize = positiveInteger(pageSize, 1)
    const pageCount = pageCountFor(total, safePageSize)
    const safePageIndex = Math.min(
        Math.max(Number.isInteger(pageIndex) ? pageIndex : 0, 0),
        pageCount - 1,
    )
    const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
    const firstItem = safeTotal === 0 ? 0 : safePageIndex * safePageSize + 1
    const lastItem = Math.min((safePageIndex + 1) * safePageSize, safeTotal)
    const items = getPaginationItems(safePageIndex, pageCount)
    const rowsPerPageLabel = t('table.pagination.rowsPerPage')
    const firstPage = safePageIndex === 0
    const lastPage = safePageIndex >= pageCount - 1

    return (
        <div className="flex min-w-0 flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                <p aria-live="polite">
                    <span className="font-extrabold text-ink-soft">
                        {t('table.pagination.range', {
                            from: firstItem,
                            to: lastItem,
                            count: safeTotal,
                            item: itemLabel,
                        })}
                    </span>
                </p>
                <div className="flex min-w-0 items-center gap-2">
                    <span>{rowsPerPageLabel}</span>
                    <SelectControl
                        value={String(safePageSize)}
                        ariaLabel={rowsPerPageLabel}
                        options={pageSizeOptions.map((option) => ({
                            label: String(option),
                            value: String(option),
                        }))}
                        disabled={disabled}
                        onValueChange={(value) => {
                            const nextPageSize = Number(value)
                            if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return
                            onPageChange(0)
                            onPageSizeChange(nextPageSize)
                        }}
                        className={pageSizeClassName}
                    />
                </div>
            </div>

            <nav
                aria-label={t('table.pagination.label')}
                className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2 sm:justify-end"
            >
                <p className="mr-1 min-w-20 text-center text-xs text-muted" aria-live="polite">
                    {t('table.pagination.page', {
                        page: safePageIndex + 1,
                        count: pageCount,
                    })}
                </p>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={() => onPageChange(0)}
                    disabled={disabled || firstPage}
                    aria-label={t('table.pagination.first')}
                >
                    <ChevronsLeft aria-hidden="true" className="size-4" />
                </button>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={() => onPageChange(Math.max(safePageIndex - 1, 0))}
                    disabled={disabled || firstPage}
                    aria-label={t('table.pagination.previous')}
                >
                    <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    {items.map((item, index) => {
                        if (item === 'ellipsis') {
                            const key =
                                'ellipsis-' +
                                items
                                    .slice(0, index + 1)
                                    .filter((candidate) => candidate === 'ellipsis').length
                            return (
                                <span
                                    key={key}
                                    aria-hidden="true"
                                    className="inline-flex size-12 shrink-0 items-center justify-center text-sm font-extrabold text-muted"
                                >
                                    …
                                </span>
                            )
                        }
                        return (
                            <button
                                key={item}
                                type="button"
                                className={paginationButtonClassName}
                                onClick={() => onPageChange(item - 1)}
                                disabled={disabled}
                                aria-current={item - 1 === safePageIndex ? 'page' : undefined}
                                aria-label={t('table.pagination.goToPage', { page: item })}
                            >
                                {item}
                            </button>
                        )
                    })}
                </div>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={() => onPageChange(Math.min(safePageIndex + 1, pageCount - 1))}
                    disabled={disabled || lastPage}
                    aria-label={t('table.pagination.next')}
                >
                    <ChevronRight aria-hidden="true" className="size-4" />
                </button>
                <button
                    type="button"
                    className={paginationButtonClassName}
                    onClick={() => onPageChange(pageCount - 1)}
                    disabled={disabled || lastPage}
                    aria-label={t('table.pagination.last')}
                >
                    <ChevronsRight aria-hidden="true" className="size-4" />
                </button>
            </nav>
        </div>
    )
}
