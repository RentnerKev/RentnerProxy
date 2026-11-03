import { useEffect, useRef } from 'react'
import { useQueryClient, type Query } from '@tanstack/react-query'

import { LIVE_READ_RETRY_INITIAL_MS, LIVE_READ_RETRY_MAX_MS } from '@/config/realtime.config.ts'
import { getPageErrorDetails } from '@/lib/Errors/pageError.ts'

/** Retries failed active reads; successful data continues to update through WebSocket events. */
export default function useQueryFailureRecovery(
    enabled: boolean,
    resetKey: number,
    isWebSocketOwned: (key: ReadonlyArray<unknown>) => boolean,
): void {
    const queryClient = useQueryClient()
    const activeScope = useRef<{ identity: number } | null>(null)
    useEffect(() => {
        if (!enabled) return
        const scope = { identity: resetKey }
        activeScope.current = scope
        const delays = new Map<Query, number>()
        const timers = new Map<Query, ReturnType<typeof setTimeout>>()
        const available = () => document.visibilityState !== 'hidden' && navigator.onLine !== false
        const canRecover = (query: Query) => {
            if (
                !query.isActive() ||
                isWebSocketOwned(query.queryKey) ||
                query.state.status !== 'error'
            )
                return false
            const { status } = getPageErrorDetails(query.state.error)
            return status !== 401 && status !== 403 && status !== 404
        }
        const clearTimer = (query: Query) => {
            const timer = timers.get(query)
            if (timer !== undefined) clearTimeout(timer)
            timers.delete(query)
        }
        const recover = (query: Query) => {
            clearTimer(query)
            if (
                activeScope.current !== scope ||
                !available() ||
                !canRecover(query) ||
                query.state.fetchStatus !== 'idle'
            )
                return
            delays.set(
                query,
                Math.min(
                    (delays.get(query) ?? LIVE_READ_RETRY_INITIAL_MS) * 2,
                    LIVE_READ_RETRY_MAX_MS,
                ),
            )
            void queryClient
                .refetchQueries(
                    { queryKey: query.queryKey, exact: true, type: 'active' },
                    { cancelRefetch: false },
                )
                .catch(() => undefined)
        }
        const update = (query: Query) => {
            if (activeScope.current !== scope) return
            if (
                query.isActive() &&
                !isWebSocketOwned(query.queryKey) &&
                query.state.fetchStatus !== 'idle'
            ) {
                clearTimer(query)
                return
            }
            if (!canRecover(query)) {
                clearTimer(query)
                delays.delete(query)
                return
            }
            if (timers.has(query) || !available()) return
            timers.set(
                query,
                setTimeout(() => recover(query), delays.get(query) ?? LIVE_READ_RETRY_INITIAL_MS),
            )
        }
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            if (event.type === 'removed') {
                clearTimer(event.query)
                delays.delete(event.query)
            } else update(event.query)
        })
        const resume = () => {
            if (available()) queryClient.getQueryCache().getAll().forEach(recover)
        }
        queryClient.getQueryCache().getAll().forEach(update)
        window.addEventListener('online', resume)
        window.addEventListener('focus', resume)
        document.addEventListener('visibilitychange', resume)
        return () => {
            if (activeScope.current === scope) activeScope.current = null
            unsubscribe()
            timers.forEach(clearTimeout)
            timers.clear()
            delays.clear()
            window.removeEventListener('online', resume)
            window.removeEventListener('focus', resume)
            document.removeEventListener('visibilitychange', resume)
        }
    }, [enabled, resetKey, isWebSocketOwned, queryClient])
}
