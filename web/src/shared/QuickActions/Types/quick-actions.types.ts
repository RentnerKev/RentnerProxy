import type { ReactNode } from 'react'
import type { QuickSearchActionId } from '@/lib/QuickSearch/Types/quick-search.types.ts'

export interface PendingQuickAction {
    readonly id: QuickSearchActionId
    readonly sequence: number
}

export interface QuickActionsContextValue {
    readonly pending: PendingQuickAction | null
    readonly request: (id: QuickSearchActionId) => void
    readonly consume: (action: PendingQuickAction) => boolean
}

export interface QuickActionsProviderProps {
    readonly children: ReactNode
    readonly permissions: readonly string[]
}
