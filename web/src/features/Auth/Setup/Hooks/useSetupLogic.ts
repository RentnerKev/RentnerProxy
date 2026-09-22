import { useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import { setupOwnerHandler } from '../server'
import { setupInputSchema } from '../validation'
import type { SetupFormValues } from '../Types/setup-form.types'

export default function useSetupLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const { t } = useTranslationStore()
    const submitInFlight = useRef(false)
    const mutation = useMutation({
        mutationFn: (values: SetupFormValues) => setupOwnerHandler({ data: values }),
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
        defaultValues: {
            displayName: '',
            email: '',
            password: '',
            confirmPassword: '',
        } satisfies SetupFormValues,
        validators: { onSubmit: setupInputSchema },
        onSubmit: async ({ value }) => {
            if (submitInFlight.current) return

            submitInFlight.current = true
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {
            } finally {
                submitInFlight.current = false
            }
        },
    })

    return {
        state: {
            form,
            isPending: mutation.isPending,
        },
    }
}
