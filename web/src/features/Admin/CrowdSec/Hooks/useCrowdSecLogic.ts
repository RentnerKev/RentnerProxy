import type { FieldErrors } from '../Types/crowd-sec-logic.types.ts'
import { invalidateCrowdSecConfigurationCache } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { toast } from '@rentnerkev/toasts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { CrowdSecMode } from '@/config/Types/crowdsec-config.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getCrowdSecTransitionProgress } from '../progress.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import {
    getCrowdSecConfigurationHandler,
    enrollCrowdSecConsoleHandler,
    testCrowdSecConnectionHandler,
    updateCrowdSecConfigurationHandler,
} from '../middleware.ts'
import type {
    CrowdSecPageLogic,
    CrowdSecPageProps,
    CrowdSecTransition,
    CrowdSecTransitionMode,
} from '../Types/crowdsec.types.ts'
import {
    crowdSecConsoleEnrollmentSchema,
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
} from '../validation.ts'

const TRANSITION_POLL_INTERVAL_MS = 1_500
const TRANSITION_DELAY_NOTICE_MS = 120_000
const COMPLETION_VISIBLE_MS = 2_000

function validationErrors(error: {
    issues: readonly { path: readonly PropertyKey[] }[]
}): FieldErrors {
    return {
        ...(error.issues.some((issue) => issue.path[0] === 'apiUrl')
            ? { apiUrl: 'admin.crowdSec.validation.apiUrl' }
            : {}),
        ...(error.issues.some((issue) => issue.path[0] === 'apiKey')
            ? { apiKey: 'admin.crowdSec.validation.apiKey' }
            : {}),
        ...(error.issues.some((issue) => issue.path[0] === 'enrollmentKey')
            ? { enrollmentKey: 'admin.crowdSec.validation.enrollmentKey' }
            : {}),
    }
}

export default function useCrowdSecLogic({ permissions }: CrowdSecPageProps): CrowdSecPageLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const canUpdate = permissions.includes(PERMISSIONS.CROWDSEC_UPDATE)
    const [draftMode, setDraftMode] = useState<CrowdSecMode | null>(null)
    const [draftApiUrl, setDraftApiUrl] = useState<string | null>(null)
    const [apiKey, setApiKey] = useState('')
    const [draftCommunityEnabled, setDraftCommunityEnabled] = useState<boolean | null>(null)
    const [enrollmentKey, setEnrollmentKey] = useState('')
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
    const [transition, setTransition] = useState<CrowdSecTransition | null>(null)
    const [previousCanUpdate, setPreviousCanUpdate] = useState(canUpdate)
    if (previousCanUpdate !== canUpdate) {
        setPreviousCanUpdate(canUpdate)
        if (!canUpdate) setTransition(null)
    }
    const saveGeneration = useRef(0)
    const reportedCompletion = useRef<number | null>(null)
    useEffect(() => {
        if (!canUpdate) {
            saveGeneration.current += 1
        }
        return () => {
            saveGeneration.current += 1
        }
    }, [canUpdate])
    const transitionActive = transition?.phase === 'running' || transition?.phase === 'delayed'
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        refetchInterval: transitionActive ? TRANSITION_POLL_INTERVAL_MS : 10_000,
    })
    const configuration = query.data
    const mode = draftMode ?? configuration?.mode ?? 'disabled'
    const apiUrl = draftApiUrl ?? configuration?.externalApiUrl ?? ''
    const communityEnabled = draftCommunityEnabled ?? configuration?.communityEnabled ?? false
    const transitionProgress = transition
        ? getCrowdSecTransitionProgress(
              transition.targetMode,
              configuration,
              query.dataUpdatedAt,
              transition.startedAt,
          )
        : null
    const displayedTransition =
        transition && transition.phase !== 'error' && transitionProgress?.complete
            ? { ...transition, phase: 'complete' as const }
            : transition

    useEffect(() => {
        if (transition?.phase !== 'running') return
        const remaining = Math.max(
            0,
            TRANSITION_DELAY_NOTICE_MS - (Date.now() - transition.startedAt),
        )
        const timer = setTimeout(() => {
            setTransition((current) =>
                current?.startedAt === transition.startedAt && current.phase === 'running'
                    ? { ...current, phase: 'delayed' }
                    : current,
            )
        }, remaining)
        return () => clearTimeout(timer)
    }, [transition?.phase, transition?.startedAt])

    useEffect(() => {
        if (!canUpdate || displayedTransition?.phase !== 'complete') return
        if (reportedCompletion.current !== displayedTransition.attemptId) {
            reportedCompletion.current = displayedTransition.attemptId
            toast.success(t(`admin.crowdSec.progress.${displayedTransition.targetMode}.complete`), {
                title: t('toast.titles.success'),
            })
        }
        const timer = setTimeout(() => {
            setDraftMode(null)
            setDraftApiUrl(null)
            setApiKey('')
            setDraftCommunityEnabled(null)
            setTransition(null)
        }, COMPLETION_VISIBLE_MS)
        return () => clearTimeout(timer)
    }, [
        canUpdate,
        displayedTransition?.phase,
        displayedTransition?.attemptId,
        displayedTransition?.targetMode,
        t,
    ])

    const testMutation = useMutation({
        mutationFn: async () => {
            const candidate = {
                apiUrl,
                ...(apiKey.length > 0 ? { apiKey } : {}),
            }
            const parsed = testCrowdSecConnectionSchema.safeParse(candidate)
            if (!parsed.success) {
                setFieldErrors(validationErrors(parsed.error))
                return null
            }
            setFieldErrors({})
            return testCrowdSecConnectionHandler({ data: parsed.data })
        },
        onSuccess: (result) => {
            if (!result) return
            toast[result.success ? 'success' : 'error'](t(result.message), {
                title: t(`toast.titles.${result.success ? 'success' : 'error'}`),
            })
        },
        onError: () => {
            toast.error(t('admin.crowdSec.errors.testFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })

    const saveMutation = useMutation({
        mutationFn: ({
            input,
        }: {
            input: ReturnType<typeof updateCrowdSecConfigurationSchema.parse>
            tracksProgress: boolean
            attemptId: number
        }) => updateCrowdSecConfigurationHandler({ data: input }),
        onSuccess: (result, { tracksProgress, attemptId }) => {
            if (saveGeneration.current !== attemptId || !canUpdate) return
            if (!result.success) {
                if (tracksProgress) {
                    setTransition((current) =>
                        current && current.phase !== 'complete'
                            ? { ...current, phase: 'error' }
                            : current,
                    )
                }
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            setDraftMode(null)
            setDraftApiUrl(null)
            setApiKey('')
            setDraftCommunityEnabled(null)
            void invalidateCrowdSecConfigurationCache(queryClient)
            void queryClient.resetQueries({ queryKey: crowdSecQueryKeys.dashboard })
            if (tracksProgress) {
                setTransition((current) =>
                    current
                        ? { ...current, runtimePending: result.runtimeStatus === 'pending' }
                        : current,
                )
            } else {
                const kind = result.runtimeStatus === 'pending' ? 'warning' : 'success'
                toast[kind](t(result.message), { title: t(`toast.titles.${kind}`) })
            }
        },
        onError: (_error, { tracksProgress, attemptId }) => {
            if (saveGeneration.current !== attemptId || !canUpdate) return
            if (tracksProgress) {
                setTransition((current) =>
                    current && current.phase !== 'complete'
                        ? { ...current, connectionInterrupted: true }
                        : current,
                )
                toast.warning(t('admin.crowdSec.progress.connectionInterrupted'), {
                    title: t('toast.titles.warning'),
                })
            } else {
                toast.error(t('admin.crowdSec.errors.saveFailed'), {
                    title: t('toast.titles.error'),
                })
            }
        },
    })

    const enrollMutation = useMutation({
        mutationFn: (key: string) => enrollCrowdSecConsoleHandler({ data: { enrollmentKey: key } }),
        onSuccess: (result) => {
            setEnrollmentKey('')
            toast[result.success ? 'success' : 'error'](t(result.message), {
                title: t(`toast.titles.${result.success ? 'success' : 'error'}`),
            })
            void invalidateCrowdSecConfigurationCache(queryClient)
        },
        onError: () => {
            setEnrollmentKey('')
            toast.error(t('admin.crowdSec.errors.enrollmentFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })

    const isDirty =
        configuration !== undefined &&
        (mode !== configuration.mode ||
            apiUrl !== (configuration.externalApiUrl ?? '') ||
            apiKey.length > 0 ||
            (mode === 'managed' && communityEnabled !== configuration.communityEnabled))

    const busy =
        saveMutation.isPending ||
        (transitionActive && !transitionProgress?.complete) ||
        testMutation.isPending ||
        enrollMutation.isPending
    const activeManaged = Boolean(
        configuration?.mode === 'managed' &&
        configuration.runtime?.mode === 'managed' &&
        configuration.synchronized,
    )
    const communityState = activeManaged
        ? (configuration?.runtime?.communityState ?? 'disabled')
        : 'disabled'
    const consoleState = activeManaged
        ? (configuration?.runtime?.consoleState ?? 'not_enrolled')
        : 'not_enrolled'
    const canEnroll = Boolean(
        activeManaged &&
        communityEnabled &&
        configuration?.communityEnabled &&
        communityState === 'connected' &&
        consoleState !== 'connected' &&
        consoleState !== 'pending',
    )

    return {
        state: {
            busy,
            activeManaged,
            communityState,
            consoleState,
            canEnroll,
            canUpdate,
            configuration,
            mode,
            apiUrl,
            apiKey,
            communityEnabled,
            enrollmentKey,
            fieldErrors,
            isDirty,
            isError: query.isError && configuration === undefined,
            isLoading: query.isPending,
            isRefreshing: query.isFetching,
            isSaving: saveMutation.isPending || (transitionActive && !transitionProgress?.complete),
            isTesting: testMutation.isPending,
            isEnrolling: enrollMutation.isPending,
            transition: displayedTransition,
            transitionProgress,
        },
        handler: {
            setMode: (nextMode) => {
                if (!canUpdate) return
                setDraftMode(nextMode)
                setFieldErrors({})
            },
            setApiUrl: (value) => {
                if (!canUpdate) return
                setDraftApiUrl(value)
                setFieldErrors(({ apiUrl: _apiUrl, ...current }) => current)
            },
            setApiKey: (value) => {
                if (!canUpdate) return
                setApiKey(value)
                setFieldErrors(({ apiKey: _apiKey, ...current }) => current)
            },
            setCommunityEnabled: (value) => {
                if (!canUpdate) return
                setDraftCommunityEnabled(value)
            },
            setEnrollmentKey: (value) => {
                if (!canUpdate) return
                setEnrollmentKey(value)
                setFieldErrors(({ enrollmentKey: _enrollmentKey, ...current }) => current)
            },
            enrollConsole: () => {
                if (
                    !canUpdate ||
                    enrollMutation.isPending ||
                    saveMutation.isPending ||
                    transitionActive
                )
                    return
                const parsed = crowdSecConsoleEnrollmentSchema.safeParse({ enrollmentKey })
                if (!parsed.success) {
                    setFieldErrors(validationErrors(parsed.error))
                    return
                }
                setFieldErrors({})
                enrollMutation.mutate(parsed.data.enrollmentKey)
            },
            testConnection: () => {
                if (canUpdate && mode === 'external' && !testMutation.isPending)
                    testMutation.mutate()
            },
            save: () => {
                if (!canUpdate || !isDirty || saveMutation.isPending || transitionActive) return
                const candidate =
                    mode === 'external'
                        ? { mode, apiUrl, ...(apiKey.length > 0 ? { apiKey } : {}) }
                        : mode === 'managed'
                          ? { mode, communityEnabled }
                          : { mode }
                const parsed = updateCrowdSecConfigurationSchema.safeParse(candidate)
                if (!parsed.success) {
                    setFieldErrors(validationErrors(parsed.error))
                    return
                }
                setFieldErrors({})
                const targetMode: CrowdSecTransitionMode | null =
                    parsed.data.mode === 'managed' && configuration?.mode !== 'managed'
                        ? 'managed'
                        : parsed.data.mode === 'disabled' && configuration?.mode === 'managed'
                          ? 'disabled'
                          : null
                const attemptId = ++saveGeneration.current
                if (targetMode) {
                    setTransition({
                        attemptId,
                        targetMode,
                        startedAt: Date.now(),
                        phase: 'running',
                        connectionInterrupted: false,
                        runtimePending: false,
                    })
                }
                saveMutation.mutate({
                    input: parsed.data,
                    tracksProgress: targetMode !== null,
                    attemptId,
                })
            },
            closeTransition: () => {
                if (!displayedTransition || displayedTransition.phase === 'running') return
                if (displayedTransition.phase === 'complete') {
                    setDraftMode(null)
                    setDraftApiUrl(null)
                    setApiKey('')
                    setDraftCommunityEnabled(null)
                }
                setTransition(null)
            },
        },
    }
}
