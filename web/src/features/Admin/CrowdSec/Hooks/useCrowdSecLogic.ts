import { toast } from '@rentnerkev/toasts/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { CrowdSecMode } from '../../../../config/crowdsec.config'
import { PERMISSIONS } from '../../../../config/permissions.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import { crowdSecQueryKeys } from '../queryKeys'
import {
    getCrowdSecConfigurationHandler,
    testCrowdSecConnectionHandler,
    updateCrowdSecConfigurationHandler,
} from '../server'
import type { CrowdSecPageLogic, CrowdSecPageProps } from '../Types/crowdsec.types'
import { testCrowdSecConnectionSchema, updateCrowdSecConfigurationSchema } from '../validation'

type FieldErrors = CrowdSecPageLogic['state']['fieldErrors']

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
    }
}

export default function useCrowdSecLogic({ permissions }: CrowdSecPageProps): CrowdSecPageLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const canUpdate = permissions.includes(PERMISSIONS.CROWDSEC_UPDATE)
    const [draftMode, setDraftMode] = useState<CrowdSecMode | null>(null)
    const [draftApiUrl, setDraftApiUrl] = useState<string | null>(null)
    const [apiKey, setApiKey] = useState('')
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        refetchInterval: 10_000,
    })
    const configuration = query.data
    const mode = draftMode ?? configuration?.mode ?? 'disabled'
    const apiUrl = draftApiUrl ?? configuration?.externalApiUrl ?? ''

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
        mutationFn: async () => {
            const candidate =
                mode === 'external'
                    ? { mode, apiUrl, ...(apiKey.length > 0 ? { apiKey } : {}) }
                    : { mode }
            const parsed = updateCrowdSecConfigurationSchema.safeParse(candidate)
            if (!parsed.success) {
                setFieldErrors(validationErrors(parsed.error))
                return null
            }
            setFieldErrors({})
            return updateCrowdSecConfigurationHandler({ data: parsed.data })
        },
        onSuccess: async (result) => {
            if (!result) return
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            setDraftMode(null)
            setDraftApiUrl(null)
            setApiKey('')
            await queryClient.invalidateQueries({ queryKey: crowdSecQueryKeys.configuration })
            const kind = result.runtimeStatus === 'pending' ? 'warning' : 'success'
            toast[kind](t(result.message), { title: t(`toast.titles.${kind}`) })
        },
        onError: () => {
            toast.error(t('admin.crowdSec.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })

    const isDirty =
        configuration !== undefined &&
        (mode !== configuration.mode ||
            apiUrl !== (configuration.externalApiUrl ?? '') ||
            apiKey.length > 0)

    return {
        state: {
            canUpdate,
            configuration,
            mode,
            apiUrl,
            apiKey,
            fieldErrors,
            isDirty,
            isError: query.isError,
            isLoading: query.isPending,
            isRefreshing: query.isFetching,
            isSaving: saveMutation.isPending,
            isTesting: testMutation.isPending,
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
            testConnection: () => {
                if (canUpdate && mode === 'external' && !testMutation.isPending)
                    testMutation.mutate()
            },
            save: () => {
                if (canUpdate && isDirty && !saveMutation.isPending) saveMutation.mutate()
            },
        },
    }
}
