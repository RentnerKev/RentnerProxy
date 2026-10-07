import type { TwoFactorLoginLogicResult } from '../Types/two-factor-login-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { completeTwoFactorLoginHandler, getTwoFactorChallengeStatusHandler } from '../middleware.ts'
import type { TwoFactorLoginFormValues, TwoFactorLoginMode } from '../Types/login-security.types.ts'
import {
    getTwoFactorCredentialError,
    normalizeTwoFactorCredential,
    twoFactorLoginFormSchema,
} from '../validation.ts'

export default function useTwoFactorLoginLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const status = useQuery({
        queryKey: ['auth', 'two-factor-challenge'],
        queryFn: () => getTwoFactorChallengeStatusHandler({ data: {} }),
    })
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
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })

    function toggleMode() {
        const nextMode: TwoFactorLoginMode = form.state.values.mode === 'totp' ? 'recovery' : 'totp'
        form.reset({ mode: nextMode, credential: '' })
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
            handleRetryStatus: () => {
                void status.refetch()
            },
        },
    } satisfies TwoFactorLoginLogicResult<typeof form>
}
