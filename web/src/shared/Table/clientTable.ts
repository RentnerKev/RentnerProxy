import {
    columnFilteringFeature,
    columnSizingFeature,
    createFilteredRowModel,
    createPaginatedRowModel,
    createSortedRowModel,
    filterFn_includesString,
    globalFilteringFeature,
    rowPaginationFeature,
    rowSortingFeature,
    sortFn_alphanumeric,
    sortFn_text,
    tableFeatures,
} from '@tanstack/react-table'
import type { ReactTable, RowData } from '@tanstack/react-table'

export const clientTableFeatures = tableFeatures({
    columnSizingFeature,
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    filterFns: {
        includesString: filterFn_includesString,
    },
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: {
        alphanumeric: sortFn_alphanumeric,
        text: sortFn_text,
    },
    rowPaginationFeature,
    paginatedRowModel: createPaginatedRowModel(),
})

export type ClientTableFeatures = typeof clientTableFeatures

export type ClientTable<TData extends RowData> = ReactTable<ClientTableFeatures, TData, null>
