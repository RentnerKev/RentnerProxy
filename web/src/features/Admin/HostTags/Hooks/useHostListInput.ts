import { useCallback, useState } from 'react'
import { hostListQuerySchema } from '../validation.ts'
import type { ClientTableState } from '@/shared/Table/Types/table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useHostListInput() {
    const { language } = useTranslationStore()
    const [query, setQuery] = useState(() => hostListQuerySchema.parse({}))
    const handleStateChange = useCallback((snapshot: ClientTableState) => {
        const next = hostListQuerySchema.parse({
            search: String(snapshot.globalFilter ?? ''),
            filters: snapshot.columnFilters,
            sorting: snapshot.sorting,
            ...snapshot.pagination,
        })
        setQuery((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    }, [])
    return {
        query: { ...query, locale: language },
        onStateChange: handleStateChange,
        initialState: {
            globalFilter: query.search,
            columnFilters: query.filters,
            sorting: query.sorting,
            pagination: { pageIndex: query.pageIndex, pageSize: query.pageSize },
        },
    }
}
