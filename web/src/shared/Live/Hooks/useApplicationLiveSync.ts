import type {
    ApplicationLiveSnapshot,
    ApplicationLiveSyncResult,
} from '../Types/application-live-sync.types.ts'
import { useCallback, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { auditLogsQueryKeys } from '@/lib/Admin/AuditLogs/auditLogsCache.ts'
import { proxyAccessLogsQueryKeys } from '@/lib/Admin/ProxyAccessLogs/proxyAccessLogsCache.ts'
import { foundationStatusQueryKeys } from '@/lib/FoundationStatus/foundationStatusCache.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import useLiveQuery from './useLiveQuery.ts'

const snapshotsByClient = new WeakMap<QueryClient, ApplicationLiveSnapshot>()

const ownWebSocketQueryPrefixes = [
    [...proxyAccessLogsQueryKeys.all, 'list'],
    [...auditLogsQueryKeys.all, 'list'],
    foundationStatusQueryKeys.all,
    crowdSecQueryKeys.configuration,
    crowdSecQueryKeys.dashboard,
    crowdSecQueryKeys.forwardAuthSummary,
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

export default function useApplicationLiveSync(): ApplicationLiveSyncResult {
    const queryClient = useQueryClient()
    const router = useRouter()
    const syncGeneration = useRef(0)
    const identityPending = useRef(false)
    const [isIdentityPending, setIsIdentityPending] = useState(false)
    const [hasIdentityError, setHasIdentityError] = useState(false)
    const [liveGeneration, setLiveGeneration] = useState(0)

    const revalidateIdentity = useCallback(() => {
        const generation = ++syncGeneration.current
        identityPending.current = true
        setIsIdentityPending(true)
        setHasIdentityError(false)
        void queryClient.cancelQueries()
        queryClient.clear()
        snapshotsByClient.delete(queryClient)
        void (async () => {
            try {
                await router.invalidate()
            } catch {
                if (generation === syncGeneration.current) setHasIdentityError(true)
                return
            }
            if (generation !== syncGeneration.current) return
            identityPending.current = false
            setIsIdentityPending(false)
            setLiveGeneration((current) => current + 1)
            await refreshApplicationQueries(queryClient)
        })().catch(() => undefined)
    }, [queryClient, router])

    const handleSnapshot = useCallback(
        (snapshot: ApplicationLiveSnapshot) => {
            if (!isApplicationLiveSnapshot(snapshot)) return
            if (identityPending.current) return

            const previous = snapshotsByClient.get(queryClient)
            if (
                previous?.revision === snapshot.revision &&
                previous.userVersion === snapshot.userVersion
            ) {
                return
            }
            if (previous && previous.userVersion !== snapshot.userVersion) {
                revalidateIdentity()
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
        [queryClient, router, revalidateIdentity],
    )

    const status = useLiveQuery<ApplicationLiveSnapshot>({
        topic: 'app-events',
        query: {},
        enabled: !isIdentityPending,
        onData: handleSnapshot,
        onUnauthorized: revalidateIdentity,
        onResume: revalidateIdentity,
        resetKey: liveGeneration,
    })
    return { status, isIdentityPending, hasIdentityError, retryIdentity: revalidateIdentity }
}
