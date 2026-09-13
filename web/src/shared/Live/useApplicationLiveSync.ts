import { useCallback, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { auditLogsQueryKeys } from '../../features/Admin/AuditLogs/queryKeys'
import { proxyAccessLogsQueryKeys } from '../../features/Admin/ProxyAccessLogs/queryKeys'
import { foundationStatusQueryKeys } from '../../features/FoundationStatus/queryKeys'
import useLiveQuery, { type LiveStatus } from './useLiveQuery'

export interface ApplicationLiveSnapshot {
    readonly revision: string
    readonly userVersion: string
}

const snapshotsByClient = new WeakMap<QueryClient, ApplicationLiveSnapshot>()

const ownWebSocketQueryPrefixes = [
    [...proxyAccessLogsQueryKeys.all, 'list'],
    [...auditLogsQueryKeys.all, 'list'],
    foundationStatusQueryKeys.all,
] as ReadonlyArray<ReadonlyArray<unknown>>

function isApplicationLiveSnapshot(value: unknown): value is ApplicationLiveSnapshot {
    if (typeof value !== 'object' || value === null) return false
    const snapshot = value as Partial<ApplicationLiveSnapshot>
    return typeof snapshot.revision === 'string' && typeof snapshot.userVersion === 'string'
}

function hasPrefix(queryKey: ReadonlyArray<unknown>, prefix: ReadonlyArray<unknown>): boolean {
    return prefix.every((part, index) => queryKey[index] === part)
}

function isOwnedByWebSocket(queryKey: ReadonlyArray<unknown>): boolean {
    return ownWebSocketQueryPrefixes.some((prefix) => hasPrefix(queryKey, prefix))
}

async function refreshApplicationQueries(queryClient: QueryClient): Promise<void> {
    await queryClient.invalidateQueries({
        predicate: (query) => !isOwnedByWebSocket(query.queryKey),
        refetchType: 'active',
    })
}

export default function useApplicationLiveSync(): LiveStatus {
    const queryClient = useQueryClient()
    const router = useRouter()
    const syncGeneration = useRef(0)

    const handleSnapshot = useCallback(
        (snapshot: ApplicationLiveSnapshot) => {
            if (!isApplicationLiveSnapshot(snapshot)) return

            const previous = snapshotsByClient.get(queryClient)
            if (
                previous?.revision === snapshot.revision &&
                previous.userVersion === snapshot.userVersion
            ) {
                return
            }
            snapshotsByClient.set(queryClient, snapshot)
            const generation = ++syncGeneration.current

            void (async () => {
                if (previous) await router.invalidate()
                if (generation !== syncGeneration.current) return
                await refreshApplicationQueries(queryClient)
            })().catch(() => undefined)
        },
        [queryClient, router, syncGeneration],
    )

    const handleUnauthorized = useCallback(() => {
        syncGeneration.current += 1
        void (async () => {
            await queryClient.cancelQueries()
            queryClient.clear()
            await router.invalidate()
        })().catch(() => undefined)
    }, [queryClient, router, syncGeneration])

    const handleResume = useCallback(() => {
        const generation = ++syncGeneration.current
        void (async () => {
            await router.invalidate()
            if (generation !== syncGeneration.current) return
            await refreshApplicationQueries(queryClient)
        })().catch(() => undefined)
    }, [queryClient, router, syncGeneration])

    return useLiveQuery<ApplicationLiveSnapshot>({
        topic: 'app-events',
        query: {},
        enabled: true,
        onData: handleSnapshot,
        onUnauthorized: handleUnauthorized,
        onResume: handleResume,
    })
}
