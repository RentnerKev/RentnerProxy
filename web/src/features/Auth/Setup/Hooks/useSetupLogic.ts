import {
    displayNameSchema,
    emailSchema,
    getPasswordConfirmationMessage,
    getValidationMessage,
    newPasswordSchema,
} from '@/lib/Auth/validation.ts'
import type { SetupLogicResult } from '../Types/setup-logic.types.ts'
import { useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { setupOwnerHandler } from '../middleware.ts'
import { setupInputSchema } from '../validation.ts'
import type { SetupFormValues } from '../Types/setup-form.types.ts'

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
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            validateDisplayName: ({ value }) => getValidationMessage(displayNameSchema, value),
            validateEmail: ({ value }) => getValidationMessage(emailSchema, value),
            validatePassword: ({ value }) => getValidationMessage(newPasswordSchema, value),
            validateConfirmPassword: ({ value }) =>
                getPasswordConfirmationMessage(form.getFieldValue('password'), value),
        },
        form,
        state: {
            isPending: mutation.isPending,
        },
    } satisfies SetupLogicResult<typeof form>
}
