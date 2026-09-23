import { toast } from '@rentnerkev/toasts/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { CrowdSecMode } from '../../../../config/crowdsec.config'
import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import { getCrowdSecTransitionProgress } from '../progress'
import { crowdSecQueryKeys } from '../queryKeys'
import {
    getCrowdSecConfigurationHandler,
    enrollCrowdSecConsoleHandler,
    testCrowdSecConnectionHandler,
    updateCrowdSecConfigurationHandler,
} from '../server'
import type {
    CrowdSecPageLogic,
    CrowdSecPageProps,
    CrowdSecTransition,
    CrowdSecTransitionMode,
} from '../Types/crowdsec.types'
import {
    crowdSecConsoleEnrollmentSchema,
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
} from '../validation'

type FieldErrors = CrowdSecPageLogic['state']['fieldErrors']
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
        transition && transitionProgress?.complete
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
        if (displayedTransition?.phase !== 'complete') return
        const timer = setTimeout(() => {
            setDraftMode(null)
            setDraftApiUrl(null)
            setApiKey('')
            setDraftCommunityEnabled(null)
            setTransition(null)
        }, COMPLETION_VISIBLE_MS)
        return () => clearTimeout(timer)
    }, [displayedTransition?.phase])

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
        }) => updateCrowdSecConfigurationHandler({ data: input }),
        onSuccess: (result, { tracksProgress }) => {
            if (!result.success) {
                if (tracksProgress) {
                    setTransition((current) =>
                        current && current.phase !== 'complete'
                            ? { ...current, phase: 'error', errorMessage: t(result.message) }
                            : current,
                    )
                } else {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                }
                return
            }
            setDraftMode(null)
            setDraftApiUrl(null)
            setApiKey('')
            setDraftCommunityEnabled(null)
            void queryClient.invalidateQueries({ queryKey: crowdSecQueryKeys.configuration })
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
        onError: (_error, { tracksProgress }) => {
            if (tracksProgress) {
                setTransition((current) =>
                    current && current.phase !== 'complete'
                        ? { ...current, connectionInterrupted: true }
                        : current,
                )
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
            void queryClient.invalidateQueries({ queryKey: crowdSecQueryKeys.configuration })
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

    return {
        state: {
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
            retry: () => void query.refetch(),
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
                if (targetMode) {
                    setTransition({
                        targetMode,
                        startedAt: Date.now(),
                        phase: 'running',
                        connectionInterrupted: false,
                        runtimePending: false,
                        errorMessage: null,
                    })
                }
                saveMutation.mutate({ input: parsed.data, tracksProgress: targetMode !== null })
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
