import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { positiveInteger, pageCountFor, getPaginationItems } from '@/lib/Table/pagination.ts'
import type {
    TablePaginationControlsProps,
    TablePaginationControlsLogicResult,
} from '../Types/table-pagination-controls.types.ts'

export default function useTablePaginationControlsLogic({
    pageIndex,
    pageSize,
    total,
    pageSizeOptions,
    itemLabel,
    onPageChange,
    onPageSizeChange,
    disabled = false,
}: TablePaginationControlsProps): TablePaginationControlsLogicResult {
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

    return {
        state: {
            safePageSize,
            rowsPerPageLabel,
            disabled,
            firstPage,
            lastPage,
            rangeLabel: t('table.pagination.range', {
                from: firstItem,
                to: lastItem,
                count: safeTotal,
                item: itemLabel,
            }),
            pageLabel: t('table.pagination.page', { page: safePageIndex + 1, count: pageCount }),
            pageSizeOptions: pageSizeOptions.map((option) => ({
                label: String(option),
                value: String(option),
            })),
            items: items.map((item, index) =>
                item === 'ellipsis'
                    ? {
                          kind: 'ellipsis' as const,
                          key:
                              'ellipsis-' +
                              items
                                  .slice(0, index + 1)
                                  .filter((candidate) => candidate === 'ellipsis').length,
                      }
                    : {
                          kind: 'page' as const,
                          key: item,
                          page: item,
                          current: item - 1 === safePageIndex,
                          label: t('table.pagination.goToPage', { page: item }),
                      },
            ),
        },
        handler: {
            handleFirstPage: () => onPageChange(0),
            handlePreviousPage: () => onPageChange(Math.max(safePageIndex - 1, 0)),
            handleNextPage: () => onPageChange(Math.min(safePageIndex + 1, pageCount - 1)),
            handleLastPage: () => onPageChange(pageCount - 1),
            handlePageChange: (page: number) => onPageChange(page - 1),
            handlePageSizeChange: (value: string) => {
                const nextPageSize = Number(value)
                if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return
                onPageChange(0)
                onPageSizeChange(nextPageSize)
            },
        },
    }
}
