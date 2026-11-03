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
import useQueryFailureRecovery from './useQueryFailureRecovery.ts'
import { LIVE_READ_RETRY_INITIAL_MS, LIVE_READ_RETRY_MAX_MS } from '@/config/realtime.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import principalVersion from '@/lib/Auth/principalVersion.ts'

const snapshotsByClient = new WeakMap<QueryClient, ApplicationLiveSnapshot>()
const identityScopesByClient = new WeakMap<QueryClient, string>()

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
    ['backups'],
] as ReadonlyArray<ReadonlyArray<unknown>>

function isApplicationLiveSnapshot(value: unknown): value is ApplicationLiveSnapshot {
    if (typeof value !== 'object' || value === null) return false
    const snapshot = value as Partial<ApplicationLiveSnapshot>
    return (
        typeof snapshot.revision === 'string' &&
        typeof snapshot.userVersion === 'string' &&
        (snapshot.identityVersion === undefined ||
            (typeof snapshot.identityVersion === 'string' &&
                /^[a-f0-9]{64}$/u.test(snapshot.identityVersion)))
    )
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

export default function useApplicationLiveSync(suspended = false): ApplicationLiveSyncResult {
    const queryClient = useQueryClient()
    const router = useRouter()
    const syncGeneration = useRef(0)
    const identityPending = useRef(true)
    const initialVerificationPending = useRef(true)
    const [isIdentityPending, setIsIdentityPending] = useState(true)
    const [identityGeneration, setIdentityGeneration] = useState(0)
    const [identityFailures, setIdentityFailures] = useState(0)
    const [liveGeneration, setLiveGeneration] = useState(0)
    const wasSuspended = useRef(suspended)

    const revalidateIdentity = useCallback(
        (initial = false, background = false) => {
            if (!initial) initialVerificationPending.current = false
            const generation = ++syncGeneration.current
            if (!background) {
                identityPending.current = true
                setIsIdentityPending(true)
            }
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
                        identityPending.current = true
                        setIsIdentityPending(true)
                        void queryClient.cancelQueries()
                        queryClient.clear()
                    }
                    if (!scope) {
                        initialVerificationPending.current = false
                        setIdentityFailures((failures) => failures + 1)
                        return
                    }
                    if (changed) {
                        setIdentityGeneration((current) => current + 1)
                        snapshotsByClient.delete(queryClient)
                    }
                    identityScopesByClient.set(queryClient, scope)
                    initialVerificationPending.current = false
                } catch {
                    if (generation === syncGeneration.current) {
                        identityPending.current = true
                        setIsIdentityPending(true)
                        setIdentityFailures((failures) => failures + 1)
                    }
                    return
                }
                if (generation !== syncGeneration.current) return
                identityPending.current = false
                setIdentityFailures(0)
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

    useEffect(() => {
        if (suspended) syncGeneration.current += 1
        else if (wasSuspended.current) queueMicrotask(() => revalidateIdentity())
        wasSuspended.current = suspended
    }, [suspended, revalidateIdentity])

    useEffect(() => {
        if (identityFailures === 0 || suspended) return
        const retry = () => {
            if (document.visibilityState !== 'hidden' && navigator.onLine !== false)
                revalidateIdentity()
        }
        const timer = setTimeout(
            retry,
            Math.min(
                LIVE_READ_RETRY_INITIAL_MS * 2 ** Math.min(identityFailures - 1, 6),
                LIVE_READ_RETRY_MAX_MS,
            ),
        )
        window.addEventListener('online', retry)
        window.addEventListener('focus', retry)
        document.addEventListener('visibilitychange', retry)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('online', retry)
            window.removeEventListener('focus', retry)
            document.removeEventListener('visibilitychange', retry)
        }
    }, [identityFailures, suspended, revalidateIdentity])

    useQueryFailureRecovery(
        !isIdentityPending && !suspended,
        identityGeneration,
        isOwnedByWebSocket,
    )

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
            if (previous) {
                // Preference/data updates keep the page mounted only when the server confirms
                // an unchanged principal. Older snapshots retain blocking identity validation.
                const background =
                    previous.identityVersion !== undefined &&
                    previous.identityVersion === snapshot.identityVersion
                if (background && previous.userVersion === snapshot.userVersion) {
                    void refreshApplicationQueries(queryClient).catch(() => undefined)
                    return
                }
                revalidateIdentity(false, background)
            } else void refreshApplicationQueries(queryClient).catch(() => undefined)
        },
        [queryClient, revalidateIdentity],
    )

    const status = useLiveQuery<ApplicationLiveSnapshot>({
        topic: 'app-events',
        query: {},
        enabled: !isIdentityPending && !suspended,
        onData: handleSnapshot,
        onUnauthorized: () => revalidateIdentity(),
        onResume: () => revalidateIdentity(),
        resetKey: liveGeneration,
    })
    return {
        status,
        isIdentityPending,
        identityGeneration,
        hasIdentityError: identityFailures > 0,
        retryIdentity: () => revalidateIdentity(),
    }
}
