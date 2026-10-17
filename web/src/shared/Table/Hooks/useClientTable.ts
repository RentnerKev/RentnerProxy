import { useTable } from '@tanstack/react-table'
import type { RowData } from '@tanstack/react-table'
import { useCallback, useEffect, useState } from 'react'

import { clientTableFeatures } from '../clientTable.ts'
import type { UseClientTableParams, UseClientTableReturn } from '../Types/table.types.ts'

export default function useClientTable<TData extends RowData>({
    data,
    columns,
    getRowId,
    initialSorting = [],
    initialPageSize = 10,
    globalFilterFn,
}: UseClientTableParams<TData>): UseClientTableReturn<TData> {
    const [searchInput, setSearchInput] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const table = useTable(
        {
            features: clientTableFeatures,
            data,
            columns,
            getRowId,
            globalFilterFn: globalFilterFn ?? 'includesString',
            autoResetPageIndex: false,
            initialState: {
                sorting: initialSorting,
                pagination: { pageIndex: 0, pageSize: initialPageSize },
            },
        },
        () => null,
    )

    const setGlobalFilter = table.setGlobalFilter
    const firstPage = table.firstPage
    const pageCount = table.getPageCount()
    const setPageIndex = table.setPageIndex
    const columnFiltersAtom = table.atoms.columnFilters
    const globalFilterAtom = table.atoms.globalFilter
    const paginationAtom = table.atoms.pagination
    const sortingAtom = table.atoms.sorting

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setDebouncedSearch(searchInput)
        }, 300)

        return () => window.clearTimeout(timeout)
    }, [searchInput])

    useEffect(() => {
        setGlobalFilter(debouncedSearch)
    }, [debouncedSearch, setGlobalFilter])

    useEffect(() => {
        const subscriptions = [
            columnFiltersAtom.subscribe(firstPage),
            globalFilterAtom.subscribe(firstPage),
            sortingAtom.subscribe(firstPage),
        ]

        return () => {
            subscriptions.forEach((subscription) => subscription.unsubscribe())
        }
    }, [columnFiltersAtom, firstPage, globalFilterAtom, sortingAtom])

    useEffect(() => {
        const lastPageIndex = Math.max(pageCount - 1, 0)
        const pageIndex = paginationAtom.get().pageIndex

        if (pageIndex > lastPageIndex) {
            setPageIndex(lastPageIndex)
        }
    }, [pageCount, paginationAtom, setPageIndex])

    const handleResetFilters = useCallback(() => {
        setSearchInput('')
        setDebouncedSearch('')
        table.setGlobalFilter('')
        table.resetColumnFilters(true)
        table.firstPage()
    }, [table])

    return {
        table,
        state: {
            searchInput,
        },
        handler: {
            handleSearchInputChange: setSearchInput,
            handleResetFilters,
        },
    }
}
