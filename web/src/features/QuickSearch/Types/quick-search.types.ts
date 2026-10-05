import type { RefCallback } from 'react'
import type { QuickSearchResult } from '@/lib/QuickSearch/Types/quick-search.types.ts'
import type { PreventableEvent } from '@/shared/Modal/Types/modal.types.ts'

export interface QuickSearchProps {
    readonly userId: string
    readonly permissions: readonly string[]
    readonly onNavigate?: (() => void) | undefined
}

export interface QuickSearchLogicResult {
    readonly state: {
        readonly open: boolean
        readonly query: string
        readonly inputId: string
        readonly listId: string
        readonly hintId: string
        readonly shortcut: string
        readonly groups: readonly {
            readonly category: QuickSearchResult['category']
            readonly label: string
            readonly results: readonly (QuickSearchResult & { readonly optionId: string })[]
        }[]
        readonly activeOptionId: string | undefined
        readonly isLoading: boolean
        readonly isOpening: boolean
        readonly hasErrors: boolean
        readonly hasResults: boolean
        readonly needsQuery: boolean
        readonly targetUnavailable: boolean
        readonly limit: number
    }
    readonly handler: {
        readonly open: () => void
        readonly focusInput: (event: PreventableEvent) => void
        readonly setOpen: (open: boolean) => void
        readonly changeQuery: (query: string) => void
        readonly highlight: (id: string) => void
        readonly select: (result: QuickSearchResult) => void
        readonly retry: () => void
    }
    readonly refs: { readonly input: RefCallback<HTMLInputElement> }
}
