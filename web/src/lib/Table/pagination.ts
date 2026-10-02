import type { TablePaginationItem } from './Types/pagination.types.ts'

const maxVisiblePageItems = 7

export function positiveInteger(value: number, fallback: number): number {
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

export function pageCountFor(total: number, pageSize: number): number {
    const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
    return Math.max(1, Math.ceil(safeTotal / positiveInteger(pageSize, 1)))
}
