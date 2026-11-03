import useValidationFeedback from '@/shared/Forms/Hooks/useValidationFeedback.ts'
import {
    credentialPasswordSchema,
    emailSchema,
    getValidationMessage,
} from '@/lib/Auth/validation.ts'
import type { AlternativeSignInOption, LoginLogicResult } from '../Types/login-logic.types.ts'
import { startAuthentication } from '@simplewebauthn/browser'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { beginPasskeyLoginHandler, finishPasskeyLoginHandler, loginHandler } from '../middleware.ts'
import { loginInputSchema } from '../validation.ts'
import type { LoginFormValues } from '../Types/login-form.types.ts'
import { getPublicOidcProvidersHandler } from '@/features/Auth/Oidc/middleware.ts'
import { oidcFeedbackCodeSchema } from '@/lib/Auth/Oidc/validation.ts'
/** Coordinates local sign-in and native provider navigation, including restoration after browser Back. */
export default function useLoginLogic() {
    const feedback = useValidationFeedback()
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const search = useSearch({ strict: false })
    const [isOidcPending, setIsOidcPending] = useState(false)
    const [oidcAttempt, setOidcAttempt] = useState(0)
    const oidcGeneration = useRef(0)
    const cancelBusy = useRef(false)
    const [oidcFeedback, setOidcFeedback] = useState<string | null>(null)
    const oidcBusy = useRef(false)
    const localBusy = useRef(false)
    const formBusy = useRef(false)
    const oidcForm = useRef<HTMLFormElement>(null)
    const oidcProviderId = useRef<HTMLInputElement>(null)
    const reportedOidcFailure = useRef(false)
    const oidcFailure = oidcFeedbackCodeSchema.safeParse(
        search && 'oidcError' in search ? search.oidcError : undefined,
    )
    const oidcFailureCode = oidcFailure.success ? oidcFailure.data : null
    useEffect(() => {
        if (!oidcFailureCode) {
            reportedOidcFailure.current = false
            return
        }
        if (reportedOidcFailure.current) return
        reportedOidcFailure.current = true
        const message = `auth.oidc.${oidcFailureCode}`
        setOidcFeedback(message)
        toast.error(t(message), { title: t('toast.titles.error') })
        // Consume the fixed failure marker so refresh and browser Back do not repeat the notice.
        void navigate({ to: '/login', search: {}, replace: true }).catch(() => {})
    }, [oidcFailureCode, navigate, t])
    useEffect(() => {
        /** Restores submission after Back returns from the provider through the browser's page cache. */
        const restoreLogin = (event: PageTransitionEvent) => {
            if (event.persisted) {
                oidcGeneration.current += 1
                oidcBusy.current = false
                setIsOidcPending(false)
            }
        }
        window.addEventListener('pageshow', restoreLogin)
        return () => {
            if (oidcBusy.current) window.stop()
            oidcGeneration.current += 1
            oidcBusy.current = false
            window.removeEventListener('pageshow', restoreLogin)
        }
    }, [])
    const providers = useQuery({
        queryKey: ['auth', 'oidc-providers'],
        queryFn: () => getPublicOidcProvidersHandler(),
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 30_000,
    })
    const mutation = useMutation({
        mutationFn: (values: LoginFormValues) => loginHandler({ data: values }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                toast.success(t(result.message), { title: t('toast.titles.success') })
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
                toast.success(t(result.message), { title: t('toast.titles.success') })
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
        listeners: {
            onBlur: ({ fieldApi }) => feedback.handler.handleValidationCompleted([fieldApi.name]),
        },
        onSubmitInvalid: () => feedback.handler.handleValidationCompleted(['email', 'password']),
        onSubmit: async ({ value }) => {
            if (localBusy.current || oidcBusy.current) return
            localBusy.current = true
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {
            } finally {
                localBusy.current = false
            }
        },
    })
    /** Submits local credentials only while no other sign-in exchange owns the form. */
    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        event.stopPropagation()
        if (
            formBusy.current ||
            localBusy.current ||
            oidcBusy.current ||
            mutation.isPending ||
            passkeyMutation.isPending
        )
            return
        formBusy.current = true
        void form
            .handleSubmit()
            .catch(() => {
                toast.error(t('Authentication service temporarily unavailable.'), {
                    title: t('toast.titles.error'),
                })
            })
            .finally(() => {
                formBusy.current = false
            })
    }

    /** Starts the passkey ceremony only when local and provider sign-in are idle. */
    async function handlePasskeyLogin(): Promise<void> {
        if (
            formBusy.current ||
            localBusy.current ||
            oidcBusy.current ||
            mutation.isPending ||
            passkeyMutation.isPending
        )
            return
        localBusy.current = true
        passkeyMutation.reset()
        try {
            await passkeyMutation.mutateAsync()
        } catch {
        } finally {
            localBusy.current = false
        }
    }

    /** Allows one native provider navigation until restoration or bounded cancellation recovery. */
    function handleOidcSubmit(event: FormEvent<HTMLFormElement>): void {
        if (
            formBusy.current ||
            localBusy.current ||
            oidcBusy.current ||
            mutation.isPending ||
            passkeyMutation.isPending
        ) {
            event.preventDefault()
            return
        }
        oidcBusy.current = true
        oidcGeneration.current += 1
        setOidcAttempt(oidcGeneration.current)
        setOidcFeedback(null)
        setIsOidcPending(true)
    }

    /** Selects a known public provider while preserving native POST and its synchronous guard. */
    function handleAlternativeSignIn(id: string): void {
        if (
            formBusy.current ||
            localBusy.current ||
            oidcBusy.current ||
            mutation.isPending ||
            passkeyMutation.isPending
        )
            return
        if (id === 'passkey') {
            void handlePasskeyLogin()
            return
        }
        if (providers.isError || !providers.data?.some((provider) => provider.id === id)) return
        if (!oidcForm.current || !oidcProviderId.current) return
        oidcProviderId.current.value = id
        try {
            oidcForm.current.requestSubmit()
        } catch {
            oidcGeneration.current += 1
            oidcBusy.current = false
            setIsOidcPending(false)
            setOidcFeedback('auth.oidc.failed')
        }
    }

    const alternativeSignInItems: readonly AlternativeSignInOption[] = [
        { id: 'passkey', label: t('Sign in with passkey') },
        ...(providers.isError ? [] : (providers.data ?? [])).map((provider) => ({
            id: provider.id,
            label: t('auth.oidc.signInWith', {
                provider: provider.name,
                defaultValue: 'Sign in with {{provider}}',
            }),
        })),
    ]
    return {
        form,
        state: {
            isPending: mutation.isPending || isOidcPending,
            isPasskeyPending: passkeyMutation.isPending,
            isOidcPending,
            isProviderCatalogPending: providers.isPending,
            isProviderCatalogUnavailable: providers.isError,
            oidcFeedback,
            alternativeSignInItems,
            validationEpochs: feedback.state.validationEpochs,
        },
        handler: {
            handleSubmit,
            validateEmail: ({ value }) => getValidationMessage(emailSchema, value),
            validatePassword: ({ value }) => getValidationMessage(credentialPasswordSchema, value),

            handlePasskeyLogin,
            handleOidcSubmit,
            handleAlternativeSignIn,
            handleRefreshProviders: () => {
                if (!oidcBusy.current) void providers.refetch()
            },
            handleCancelOidc: () => {
                if (
                    !oidcBusy.current ||
                    cancelBusy.current ||
                    oidcAttempt !== oidcGeneration.current
                )
                    return
                cancelBusy.current = true
                try {
                    // Stop this native response before another authentication attempt can start.
                    window.stop()
                    oidcGeneration.current += 1
                    oidcBusy.current = false
                    setIsOidcPending(false)
                } finally {
                    cancelBusy.current = false
                }
            },
        },
        refs: { oidcForm, oidcProviderId },
    } satisfies LoginLogicResult<typeof form>
}
