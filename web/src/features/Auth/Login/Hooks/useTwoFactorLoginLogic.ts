import useValidationFeedback from '@/shared/Forms/Hooks/useValidationFeedback.ts'
import type { TwoFactorLoginLogicResult } from '../Types/two-factor-login-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'

import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { completeTwoFactorLoginHandler, getTwoFactorChallengeStatusHandler } from '../middleware.ts'
import type { TwoFactorLoginFormValues, TwoFactorLoginMode } from '../Types/login-security.types.ts'
import {
    getTwoFactorCredentialError,
    normalizeTwoFactorCredential,
    twoFactorLoginFormSchema,
} from '../validation.ts'

/** Coordinates second-factor verification and toast feedback for each completed status request. */
export default function useTwoFactorLoginLogic() {
    const feedback = useValidationFeedback()
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const status = useQuery({
        queryKey: ['auth', 'two-factor-challenge'],
        queryFn: () => getTwoFactorChallengeStatusHandler({ data: {} }),
    })
    const statusFeedback = status.isFetching
        ? null
        : status.isError
          ? 'unavailable'
          : status.isSuccess && !status.data.valid
            ? 'expired'
            : null
    const statusFeedbackUpdatedAt = status.isError ? status.errorUpdatedAt : status.dataUpdatedAt
    const reportedStatus = useRef<{ kind: typeof statusFeedback; updatedAt: number } | null>(null)
    /** Replays the current sanitized status without starting another authentication request. */
    const handleShowStatus = useCallback(() => {
        if (statusFeedback === 'unavailable') {
            toast.error(
                t('auth.twoFactor.unavailable', {
                    defaultValue: 'Authentication service temporarily unavailable. Try again.',
                }),
                { title: t('toast.titles.error') },
            )
        } else if (statusFeedback === 'expired') {
            toast.warning(
                t('auth.twoFactor.expired', {
                    defaultValue: 'This authentication request has expired. Start again.',
                }),
                { title: t('toast.titles.warning') },
            )
        }
    }, [statusFeedback, t])
    useEffect(() => {
        if (statusFeedback === null) {
            reportedStatus.current = null
            return
        }
        if (
            reportedStatus.current?.kind === statusFeedback &&
            reportedStatus.current.updatedAt === statusFeedbackUpdatedAt
        )
            return
        reportedStatus.current = { kind: statusFeedback, updatedAt: statusFeedbackUpdatedAt }
        handleShowStatus()
    }, [statusFeedback, statusFeedbackUpdatedAt, handleShowStatus])
    const mutation = useMutation({
        mutationFn: (value: TwoFactorLoginFormValues) =>
            completeTwoFactorLoginHandler({
                data:
                    value.mode === 'totp'
                        ? { code: value.credential }
                        : { recoveryCode: value.credential.trim() },
            }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                toast.success(t(result.message), { title: t('toast.titles.success') })
                return
            }
            if ('restartLogin' in result && result.restartLogin) {
                await navigate({ to: '/login', replace: true })
            }

            toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const defaultValues: TwoFactorLoginFormValues = {
        mode: 'totp',
        credential: '',
    }
    const form = useForm({
        defaultValues,
        validators: { onSubmit: twoFactorLoginFormSchema },
        listeners: {
            onBlur: ({ fieldApi }) => feedback.handler.handleValidationCompleted([fieldApi.name]),
        },
        onSubmitInvalid: () => feedback.handler.handleValidationCompleted(['credential']),
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })

    function toggleMode() {
        const nextMode: TwoFactorLoginMode = form.state.values.mode === 'totp' ? 'recovery' : 'totp'
        form.reset({ mode: nextMode, credential: '' }, { keepDefaultValues: true })
        mutation.reset()
    }
    const methods: ReadonlyArray<TwoFactorLoginMode> = status.data?.methods ?? []

    return {
        form,
        state: {
            isLoading: status.isPending || status.isFetching,
            isStatusError: status.isError,
            isPending: mutation.isPending,
            isValid: status.isSuccess && (status.data?.valid ?? false),
            methods,
            validationEpoch: feedback.state.validationEpochs.credential ?? 0,
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            validateCredential: ({ value }) =>
                getTwoFactorCredentialError(form.getFieldValue('mode'), value),
            normalizeCredential: normalizeTwoFactorCredential,
            toggleMode,
            handleShowStatus,
            handleRetryStatus: () => {
                reportedStatus.current = null
                void status.refetch()
            },
        },
    } satisfies TwoFactorLoginLogicResult<typeof form>
}
