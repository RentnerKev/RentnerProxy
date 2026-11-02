import {
    credentialPasswordSchema,
    emailSchema,
    getValidationMessage,
} from '@/lib/Auth/validation.ts'
import type { LoginLogicResult } from '../Types/login-logic.types.ts'
import type { MenuItem } from '@rentnerkev/menu'
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
/** Coordinates local sign-in and native provider navigation, including restoration after browser Back. */
export default function useLoginLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const search = useSearch({ strict: false })
    const [isOidcPending, setIsOidcPending] = useState(false)
    const oidcForm = useRef<HTMLFormElement>(null)
    const oidcProviderId = useRef<HTMLInputElement>(null)
    const reportedOidcFailure = useRef(false)
    const oidcFailed = !!search && 'oidcError' in search && search.oidcError === 'failed'
    useEffect(() => {
        if (!oidcFailed) {
            reportedOidcFailure.current = false
            return
        }
        if (reportedOidcFailure.current) return
        reportedOidcFailure.current = true
        toast.error(
            t('auth.oidc.failed', {
                defaultValue: 'Sign-in failed. Try again or use your local account.',
            }),
            { title: t('toast.titles.error') },
        )
        // Consume the fixed failure marker so refresh and browser Back do not repeat the notice.
        void navigate({ to: '/login', search: {}, replace: true }).catch(() => {})
    }, [oidcFailed, navigate, t])
    useEffect(() => {
        /** Restores submission after Back returns from the provider through the browser's page cache. */
        const restoreLogin = (event: PageTransitionEvent) => {
            if (event.persisted) setIsOidcPending(false)
        }
        window.addEventListener('pageshow', restoreLogin)
        return () => window.removeEventListener('pageshow', restoreLogin)
    }, [])
    useEffect(() => {
        if (!isOidcPending) return
        // Browser Stop leaves this document mounted without emitting a restoration event.
        const timeout = window.setTimeout(() => setIsOidcPending(false), 15_000)
        return () => window.clearTimeout(timeout)
    }, [isOidcPending])
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
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })
    /** Submits local credentials only while no other sign-in exchange owns the form. */
    function handleSubmit(event: FormEvent<HTMLFormElement>): void {
        event.preventDefault()
        event.stopPropagation()
        if (isOidcPending || mutation.isPending || passkeyMutation.isPending) return
        void form.handleSubmit()
    }

    /** Starts the passkey ceremony only when local and provider sign-in are idle. */
    async function handlePasskeyLogin(): Promise<void> {
        if (isOidcPending || mutation.isPending || passkeyMutation.isPending) return
        passkeyMutation.reset()
        try {
            await passkeyMutation.mutateAsync()
        } catch {}
    }

    /** Allows one native provider navigation until restoration or bounded cancellation recovery. */
    function handleOidcSubmit(event: FormEvent<HTMLFormElement>): void {
        if (isOidcPending || mutation.isPending || passkeyMutation.isPending) {
            event.preventDefault()
            return
        }
        setIsOidcPending(true)
    }

    /** Dispatches menu actions while preserving native same-origin POST and its duplicate guard. */
    function handleAlternativeSignIn(id: string): void {
        if (isOidcPending || mutation.isPending || passkeyMutation.isPending) return
        if (id === 'passkey') {
            void handlePasskeyLogin()
            return
        }
        if (!providers.data?.some((provider) => provider.id === id)) return
        if (!oidcForm.current || !oidcProviderId.current) return
        oidcProviderId.current.value = id
        oidcForm.current.requestSubmit()
    }

    const alternativeSignInItems: readonly MenuItem[] = [
        { id: 'passkey', label: t('Sign in with passkey') },
        ...(providers.data ?? []).map((provider) => ({
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
            alternativeSignInItems,
        },
        handler: {
            handleSubmit,
            validateEmail: ({ value }) => getValidationMessage(emailSchema, value),
            validatePassword: ({ value }) => getValidationMessage(credentialPasswordSchema, value),

            handlePasskeyLogin,
            handleOidcSubmit,
            handleAlternativeSignIn,
        },
        refs: { oidcForm, oidcProviderId },
    } satisfies LoginLogicResult<typeof form>
}
