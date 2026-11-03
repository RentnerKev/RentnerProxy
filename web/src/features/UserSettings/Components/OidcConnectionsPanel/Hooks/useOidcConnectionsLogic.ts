import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    getOidcConnections,
    getOidcConnectionsErrorKey,
    OidcConnectionsError,
    unlinkOidcConnection,
} from '@/lib/UserSettings/oidcConnections.ts'
import type { OidcConnectionAction } from '@/lib/UserSettings/Types/oidc-connections.types.ts'
import type { OidcConnectionsLogicResult } from '../Types/oidc-connections.types.ts'

export default function useOidcConnectionsLogic(
    userId: string,
    canUpdate: boolean,
): OidcConnectionsLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const router = useRouter()
    const { oidcResult, oidcError } = useSearch({ strict: false })
    const [initialFeedback] = useState({ oidcResult, oidcError })
    const feedbackHandled = useRef(false)
    const [action, setAction] = useState<OidcConnectionAction | null>(null)
    const nativeNavigation = useRef<OidcConnectionAction | null>(null)
    const cancellationLock = useRef(false)
    const [message, setMessage] = useState<string | null>(null)
    const [isNavigating, setIsNavigating] = useState(false)
    const form = useRef<HTMLFormElement>(null)
    const lock = useRef(false)
    const generation = useRef(0)
    const controller = useRef<AbortController | null>(null)
    const queryKey = ['auth', 'account', 'oidc-connections', userId]
    const query = useQuery({
        queryKey,
        queryFn: ({ signal }) => getOidcConnections(signal),
        enabled: canUpdate,
        retry: (count, error) =>
            !(
                error instanceof OidcConnectionsError &&
                (error.code === 'authentication_required' || error.code === 'permission_denied')
            ) && count < 3,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        gcTime: 0,
        staleTime: 0,
    })
    const unlink = useMutation({
        mutationFn: (input: OidcConnectionAction) => {
            controller.current = new AbortController()
            return unlinkOidcConnection(input, controller.current.signal)
        },
        retry: false,
        gcTime: 0,
    })

    const resumeFromCache = useEffectEvent(() => {
        generation.current += 1
        controller.current?.abort()
        lock.current = false
        nativeNavigation.current = null
        setIsNavigating(false)
        setAction(null)
        void queryClient.invalidateQueries({
            queryKey: ['auth', 'account', 'oidc-connections', userId],
        })
    })

    useEffect(() => {
        const resume = (event: PageTransitionEvent) => {
            if (event.persisted) resumeFromCache()
        }
        window.addEventListener('pageshow', resume)
        return () => {
            if (nativeNavigation.current) window.stop()
            nativeNavigation.current = null
            generation.current += 1
            controller.current?.abort()
            window.removeEventListener('pageshow', resume)
        }
    }, [])

    const showCallbackFeedback = useEffectEvent((key: string, linked: boolean) => {
        toast[linked ? 'success' : 'error'](t(key), {
            title: t(linked ? 'toast.titles.success' : 'toast.titles.error'),
        })
        void navigate({ to: '/account', search: { section: 'linked-accounts' }, replace: true })
    })

    const callbackReady =
        initialFeedback.oidcResult !== 'linked' ||
        !canUpdate ||
        (query.isFetchedAfterMount && !query.isFetching)
    const callbackLinked =
        initialFeedback.oidcResult === 'linked' &&
        canUpdate &&
        query.isSuccess &&
        query.data.providers.some((provider) => provider.linked)
    const callbackMessage =
        !callbackReady || (!initialFeedback.oidcResult && !initialFeedback.oidcError)
            ? null
            : callbackLinked
              ? 'account.oidc.linkedSuccess'
              : initialFeedback.oidcError === 'conflict'
                ? 'account.oidc.error.conflict'
                : initialFeedback.oidcError === 'expired'
                  ? 'account.oidc.error.expired'
                  : initialFeedback.oidcError === 'denied'
                    ? 'account.oidc.error.deniedLink'
                    : initialFeedback.oidcError === 'unavailable'
                      ? 'account.oidc.error.unavailableProvider'
                      : 'account.oidc.error.failed'

    useEffect(() => {
        if (feedbackHandled.current || !callbackMessage) return
        if (
            query.error instanceof OidcConnectionsError &&
            query.error.code === 'authentication_required'
        )
            return
        feedbackHandled.current = true
        showCallbackFeedback(callbackMessage, callbackLinked)
    }, [callbackMessage, callbackLinked, query.error])

    useEffect(() => {
        if (
            query.error instanceof OidcConnectionsError &&
            query.error.code === 'authentication_required'
        ) {
            queryClient.clear()
            void router.invalidate().then(() => navigate({ to: '/login', replace: true }))
        }
    }, [query.error, queryClient, router, navigate])

    function close() {
        if (nativeNavigation.current) return
        generation.current += 1
        lock.current = false
        setAction(null)
    }

    function cancelNavigation(target: OidcConnectionAction | null) {
        if (!target || nativeNavigation.current !== target || cancellationLock.current) return
        cancellationLock.current = true
        try {
            // Stop the document request before a later response could overtake another action.
            window.stop()
        } catch {
            cancellationLock.current = false
            return
        }
        nativeNavigation.current = null
        close()
        setIsNavigating(false)
        setMessage('')
        const cancelledGeneration = generation.current
        lock.current = true
        void query.refetch().finally(() => {
            if (generation.current === cancelledGeneration) lock.current = false
        })
        cancellationLock.current = false
    }

    async function report(error: unknown) {
        if (error instanceof OidcConnectionsError && error.code === 'authentication_required') {
            queryClient.clear()
            await router.invalidate()
            await navigate({ to: '/login', replace: true })
            return
        }
        const key = getOidcConnectionsErrorKey(error)
        setMessage(key)
        toast.error(t(key), { title: t('toast.titles.error') })
        if (error instanceof OidcConnectionsError && error.code === 'configuration_conflict')
            await query.refetch()
    }

    function request(providerId: string, kind: 'link' | 'unlink') {
        const data = query.data
        const provider = data?.providers.find((entry) => entry.id === providerId)
        if (
            lock.current ||
            query.isFetching ||
            query.isError ||
            !canUpdate ||
            !data ||
            data.externallyManaged ||
            !provider ||
            (kind === 'link' ? !provider.enabled || provider.linked : !provider.linked)
        )
            return
        lock.current = true
        setMessage('')
        const nextAction = { providerId, kind, expectedRevision: data.revision }
        setAction(nextAction)
        void execute(nextAction)
    }

    async function execute(pendingAction: OidcConnectionAction) {
        const currentGeneration = generation.current
        try {
            if (pendingAction.kind === 'link') {
                const element = form.current
                if (!element) throw new Error('form_unavailable')
                const providerInput = element.elements.namedItem('providerId')
                if (!(providerInput instanceof HTMLInputElement))
                    throw new Error('form_unavailable')
                providerInput.value = pendingAction.providerId
                nativeNavigation.current = pendingAction
                setIsNavigating(true)
                setMessage('account.oidc.pending')
                element.submit()
            } else {
                await unlink.mutateAsync(pendingAction)
                if (currentGeneration !== generation.current) return
                setMessage('account.oidc.unlinkedSuccess')
                toast.success(t('account.oidc.unlinkedSuccess'), {
                    title: t('toast.titles.success'),
                })
                close()
                const refreshGeneration = generation.current
                lock.current = true
                await query.refetch()
                if (generation.current === refreshGeneration) lock.current = false
            }
        } catch (error) {
            if (currentGeneration === generation.current) {
                nativeNavigation.current = null
                close()
                setIsNavigating(false)
                await report(error)
            }
        }
    }

    return {
        state: {
            data: !canUpdate || query.isError ? undefined : query.data,
            isLoading: query.isPending && canUpdate,
            error: query.error,
            canUpdate,
            message: message ?? callbackMessage,
            isPending: unlink.isPending || isNavigating || query.isFetching,
            isNavigating,
            action,
        },
        refs: { form },
        handler: {
            handleRequest: request,
            handleCancelNavigation: () => cancelNavigation(action),
        },
    } satisfies OidcConnectionsLogicResult
}
