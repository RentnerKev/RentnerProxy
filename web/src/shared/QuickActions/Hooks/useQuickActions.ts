import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { QUICK_SEARCH_ACTIONS } from '@/config/quick-search.config.ts'
import { canRunQuickSearchAction } from '@/lib/QuickSearch/quickSearchActions.ts'
import type { QuickSearchActionId } from '@/lib/QuickSearch/Types/quick-search.types.ts'
import type { PendingQuickAction, QuickActionsContextValue } from '../Types/quick-actions.types.ts'

export const QuickActionsContext = createContext<QuickActionsContextValue | null>(null)

export function useQuickActionsProviderLogic(permissions: readonly string[]) {
    const router = useRouter()
    const pathname = useRouterState({ select: (state) => state.location.pathname })
    const [pending, setPending] = useState<PendingQuickAction | null>(null)
    const current = useRef<PendingQuickAction | null>(null)
    const sequence = useRef(0)
    const request = useCallback(
        (id: QuickSearchActionId) => {
            const definition = QUICK_SEARCH_ACTIONS.find((action) => action.id === id)
            if (
                !definition ||
                !canRunQuickSearchAction(id, permissions) ||
                router.state.location.pathname !== definition.to
            )
                return
            const action = { id, sequence: ++sequence.current }
            current.current = action
            setPending(action)
        },
        [permissions, router],
    )
    const consume = useCallback(
        (action: PendingQuickAction) => {
            if (current.current !== action) return false
            current.current = null
            setPending(null)
            const definition = QUICK_SEARCH_ACTIONS.find((item) => item.id === action.id)
            return (
                canRunQuickSearchAction(action.id, permissions) &&
                router.state.location.pathname === definition?.to
            )
        },
        [permissions, router],
    )
    useEffect(() => {
        if (!pending) return
        const definition = QUICK_SEARCH_ACTIONS.find((action) => action.id === pending.id)
        if (definition?.to !== pathname || !canRunQuickSearchAction(pending.id, permissions))
            consume(pending)
    }, [consume, pathname, pending, permissions])
    const value = useMemo(() => ({ pending, request, consume }), [pending, request, consume])
    return { state: { value } }
}

export function useQuickActions() {
    return useContext(QuickActionsContext)
}

export function useQuickActionPreparation(handler: (id: QuickSearchActionId) => void) {
    const pending = useQuickActions()?.pending
    const prepared = useRef<PendingQuickAction | null>(null)
    useEffect(() => {
        if (pending && prepared.current !== pending) {
            prepared.current = pending
            handler(pending.id)
        }
    }, [handler, pending])
}

export default function useQuickAction(id: QuickSearchActionId, handler: () => void, ready = true) {
    const actions = useQuickActions()
    useEffect(() => {
        if (ready && actions?.pending?.id === id && actions.consume(actions.pending)) handler()
    }, [actions, handler, id, ready])
}
