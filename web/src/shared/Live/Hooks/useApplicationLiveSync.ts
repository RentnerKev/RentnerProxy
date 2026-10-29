import type {
    ApplicationLiveSnapshot,
    ApplicationLiveSyncResult,
} from '../Types/application-live-sync.types.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { auditLogsQueryKeys } from '@/lib/Admin/AuditLogs/auditLogsCache.ts'
import { proxyAccessLogsQueryKeys } from '@/lib/Admin/ProxyAccessLogs/proxyAccessLogsCache.ts'
import { foundationStatusQueryKeys } from '@/lib/FoundationStatus/foundationStatusCache.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import useLiveQuery from './useLiveQuery.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

const snapshotsByClient = new WeakMap<QueryClient, ApplicationLiveSnapshot>()
const identityScopesByClient = new WeakMap<QueryClient, string>()

function principalVersion(user: AuthenticatedUser): string {
    return JSON.stringify([user.id, user.roles.toSorted(), user.permissions.toSorted()])
}

function confirmedIdentityScope(router: ReturnType<typeof useRouter>): string | null {
    const state = router.state
    if (
        state.status !== 'idle' ||
        state.isLoading ||
        (state.resolvedLocation && state.resolvedLocation.href !== state.location.href)
    )
        return null
    const match = state.matches.find((current) => current.routeId === '/_authenticated')
    if (match?.status !== 'success' || match.invalid || match.error) return null
    const context = match?.context as
        { readonly user?: AuthenticatedUser; readonly sessionId?: string | null } | undefined
    if (!context?.sessionId || !context.user?.permissions.includes(PERMISSIONS.APP_ACCESS))
        return null
    return JSON.stringify([principalVersion(context.user), context.sessionId])
}

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
    const identityPending = useRef(true)
    const initialVerificationPending = useRef(true)
    const [isIdentityPending, setIsIdentityPending] = useState(true)
    const [identityGeneration, setIdentityGeneration] = useState(0)
    const [hasIdentityError, setHasIdentityError] = useState(false)
    const [liveGeneration, setLiveGeneration] = useState(0)

    const revalidateIdentity = useCallback(
        (initial = false) => {
            if (!initial) initialVerificationPending.current = false
            const generation = ++syncGeneration.current
            identityPending.current = true
            setIsIdentityPending(true)
            setHasIdentityError(false)
            void (async () => {
                try {
                    if (!initial) await router.invalidate({ sync: true })
                    if (generation !== syncGeneration.current) return
                    if (
                        initial &&
                        (router.state.status !== 'idle' ||
                            router.state.isLoading ||
                            router.state.matches.some(
                                (match) =>
                                    match.routeId === '/_authenticated' &&
                                    match.status === 'pending',
                            ) ||
                            (router.state.resolvedLocation &&
                                router.state.resolvedLocation.href !== router.state.location.href))
                    )
                        return
                    const scope = confirmedIdentityScope(router)
                    const previousScope = identityScopesByClient.get(queryClient)
                    const changed = scope === null || previousScope !== scope
                    if (changed) {
                        void queryClient.cancelQueries()
                        queryClient.clear()
                    }
                    if (!scope) {
                        initialVerificationPending.current = false
                        setHasIdentityError(true)
                        return
                    }
                    if (changed) {
                        setIdentityGeneration((current) => current + 1)
                        snapshotsByClient.delete(queryClient)
                    }
                    identityScopesByClient.set(queryClient, scope)
                    initialVerificationPending.current = false
                } catch {
                    if (generation === syncGeneration.current) setHasIdentityError(true)
                    return
                }
                if (generation !== syncGeneration.current) return
                identityPending.current = false
                setIsIdentityPending(false)
                setLiveGeneration((current) => current + 1)
                if (!initial) await refreshApplicationQueries(queryClient)
            })().catch(() => undefined)
        },
        [queryClient, router],
    )

    useEffect(() => {
        let active = true
        const verifyInitial = () =>
            queueMicrotask(() => {
                if (active && initialVerificationPending.current) revalidateIdentity(true)
            })
        const unsubscribe = router.subscribe('onResolved', verifyInitial)
        verifyInitial()
        return () => {
            active = false
            unsubscribe()
            syncGeneration.current += 1
        }
    }, [revalidateIdentity, router])

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
            snapshotsByClient.set(queryClient, snapshot)
            if (previous) revalidateIdentity()
            else void refreshApplicationQueries(queryClient).catch(() => undefined)
        },
        [queryClient, revalidateIdentity],
    )

    const status = useLiveQuery<ApplicationLiveSnapshot>({
        topic: 'app-events',
        query: {},
        enabled: !isIdentityPending,
        onData: handleSnapshot,
        onUnauthorized: () => revalidateIdentity(),
        onResume: () => revalidateIdentity(),
        resetKey: liveGeneration,
    })
    return {
        status,
        isIdentityPending,
        identityGeneration,
        hasIdentityError,
        retryIdentity: () => revalidateIdentity(),
    }
}
