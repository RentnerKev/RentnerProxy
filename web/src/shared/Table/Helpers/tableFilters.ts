import type { FilterFn, Row, RowData } from '@tanstack/react-table'

import type { TableDateRangeFilterValue, TableFilterOption } from '../Types/table.types'
import type { ClientTableFeatures } from '../Hooks/useClientTableLogic'

function filterTrimmedIncludesString<TData extends RowData>(
    row: Row<ClientTableFeatures, TData>,
    columnId: string,
    filterValue: unknown,
) {
    return String(row.getValue(columnId) ?? '')
        .toLocaleLowerCase()
        .includes(String(filterValue))
}

export function createTrimmedIncludesStringFilter<TData extends RowData>(): FilterFn<
    ClientTableFeatures,
    TData
> {
    const filter: FilterFn<ClientTableFeatures, TData> = filterTrimmedIncludesString

    filter.resolveFilterValue = (value) => String(value).trim().toLocaleLowerCase()
    filter.autoRemove = (value) => !String(value).trim()

    return filter
}

export function createDateRangeFilter<TData extends RowData>(): FilterFn<
    ClientTableFeatures,
    TData
> {
    return (row, columnId, filterValue) => {
        const range = filterValue as TableDateRangeFilterValue | undefined
        const rowValue = row.getValue(columnId)
        const timestamp =
            rowValue instanceof Date ? rowValue.getTime() : new Date(String(rowValue)).getTime()

        if (Number.isNaN(timestamp)) {
            return false
        }

        if (range?.from) {
            const from = new Date(`${range.from}T00:00:00`).getTime()

            if (!Number.isNaN(from) && timestamp < from) {
                return false
            }
        }

        if (range?.to) {
            const toDate = new Date(`${range.to}T00:00:00`)
            toDate.setHours(23, 59, 59, 999)

            if (!Number.isNaN(toDate.getTime()) && timestamp > toDate.getTime()) {
                return false
            }
        }

        return true
    }
}

export function createArrayIncludesFilter<TData extends RowData>(): FilterFn<
    ClientTableFeatures,
    TData
> {
    return (row, columnId, filterValue) => {
        const value = row.getValue(columnId)

        return Array.isArray(value) && value.includes(String(filterValue))
    }
}

export function createSortedUniqueFilterOptions(
    values: ReadonlyArray<string>,
): Array<TableFilterOption> {
    return [...new Set(values)]
        .toSorted((left, right) => left.localeCompare(right))
        .map((value) => ({ label: value, value }))
}
