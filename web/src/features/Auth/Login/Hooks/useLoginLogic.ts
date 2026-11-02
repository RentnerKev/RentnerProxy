import {
    credentialPasswordSchema,
    emailSchema,
    getValidationMessage,
} from '@/lib/Auth/validation.ts'
import type { LoginLogicResult } from '../Types/login-logic.types.ts'
import { startAuthentication } from '@simplewebauthn/browser'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useState } from 'react'

import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { beginPasskeyLoginHandler, finishPasskeyLoginHandler, loginHandler } from '../middleware.ts'
import { loginInputSchema } from '../validation.ts'
import type { LoginFormValues } from '../Types/login-form.types.ts'
import { getPublicOidcProvidersHandler } from '@/features/Auth/Oidc/middleware.ts'
export default function useLoginLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const search = useSearch({ strict: false })
    const [isOidcPending, setIsOidcPending] = useState(false)
    const providers = useQuery({
        queryKey: ['auth', 'oidc-providers'],
        queryFn: () => getPublicOidcProvidersHandler(),
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: Infinity,
    })
    const mutation = useMutation({
        mutationFn: (values: LoginFormValues) => loginHandler({ data: values }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                return
            }
            if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
                await navigate({ to: '/login/two-factor', replace: true })
                toast.info(t(result.message), { title: t('toast.titles.info') })
                return
            }

            toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const passkeyMutation = useMutation({
        mutationFn: async () => {
            const started = await beginPasskeyLoginHandler({ data: {} })
            if (!started.success || !started.options || !started.challengeId) return started
            const response = await startAuthentication({
                optionsJSON: started.options as Parameters<
                    typeof startAuthentication
                >[0]['optionsJSON'],
            })
            return await finishPasskeyLoginHandler({
                data: { challengeId: started.challengeId, response },
            })
        },
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                return
            }

            toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const form = useForm({
        defaultValues: { email: '', password: '' } satisfies LoginFormValues,
        validators: { onSubmit: loginInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })
    return {
        form,
        state: {
            isPending: mutation.isPending || isOidcPending,
            isPasskeyPending: passkeyMutation.isPending,
            oidcProviders: providers.data ?? [],
            oidcFailed: !!search && 'oidcError' in search && search.oidcError === 'failed',
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (isOidcPending || mutation.isPending || passkeyMutation.isPending) return
                void form.handleSubmit()
            },
            validateEmail: ({ value }) => getValidationMessage(emailSchema, value),
            validatePassword: ({ value }) => getValidationMessage(credentialPasswordSchema, value),

            handlePasskeyLogin: async () => {
                if (isOidcPending || mutation.isPending || passkeyMutation.isPending) return
                passkeyMutation.reset()

                try {
                    await passkeyMutation.mutateAsync()
                } catch {}
            },
            handleOidcSubmit: (event) => {
                if (isOidcPending || mutation.isPending || passkeyMutation.isPending) {
                    event.preventDefault()
                    return
                }
                setIsOidcPending(true)
            },
        },
    } satisfies LoginLogicResult<typeof form>
}
