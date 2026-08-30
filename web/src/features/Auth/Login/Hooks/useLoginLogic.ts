import { startAuthentication } from '@simplewebauthn/browser'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import { beginPasskeyLoginHandler, finishPasskeyLoginHandler, loginHandler } from '../server'
import { loginInputSchema } from '../validation'
import type { LoginFormValues } from '../Types/login-form.types'
export default function useLoginLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const toast = useToast()
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
                toast.info(result.message)
                return
            }

            toast.error(result.message)
        },
        onError: () => toast.error('Authentication service temporarily unavailable.'),
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

            toast.error(result.message)
        },
        onError: () => toast.error('Authentication service temporarily unavailable.'),
    })
    const form = useForm({
        defaultValues: { email: '', password: '' } satisfies LoginFormValues,
        validators: { onSubmit: loginInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {
                // The mutation callback reports transport failures.
            }
        },
    })
    return {
        state: {
            form,
            isPending: mutation.isPending,
            isPasskeyPending: passkeyMutation.isPending,
        },
        handler: {
            handlePasskeyLogin: async () => {
                passkeyMutation.reset()

                try {
                    await passkeyMutation.mutateAsync()
                } catch {
                    // The mutation callback reports transport failures.
                }
            },
        },
    }
}
