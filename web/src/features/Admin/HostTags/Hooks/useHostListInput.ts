import { useCallback, useState } from 'react'
import { hostListQuerySchema } from '../validation.ts'
import type { ClientTableState } from '@/shared/Table/Types/table.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useHostListInput() {
    const { language } = useTranslationStore()
    const [query, setQuery] = useState(() => hostListQuerySchema.parse({}))
    const handleStateChange = useCallback((snapshot: ClientTableState) => {
        const parsed = hostListQuerySchema.safeParse({
            search: String(snapshot.globalFilter ?? '').slice(0, 256),
            filters: snapshot.columnFilters,
            sorting: snapshot.sorting,
            ...snapshot.pagination,
        })
        if (!parsed.success) return
        const next = parsed.data
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
