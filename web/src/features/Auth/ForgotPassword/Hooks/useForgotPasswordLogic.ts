import { emailSchema, getValidationMessage } from '@/lib/Auth/validation.ts'
import type { ForgotPasswordLogicResult } from '../Types/forgot-password-logic.types.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { requestPasswordResetHandler } from '../middleware.ts'
import { forgotPasswordInputSchema } from '../validation.ts'
import type { ForgotPasswordFormValues } from '../Types/forgot-password-form.types.ts'

export default function useForgotPasswordLogic() {
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: ForgotPasswordFormValues) =>
            requestPasswordResetHandler({ data: values }),
        onSuccess: (result) => {
            if (result.success) {
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
        defaultValues: { email: '' } satisfies ForgotPasswordFormValues,
        validators: { onSubmit: forgotPasswordInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {}
        },
    })

    return {
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
            validateEmail: ({ value }) => getValidationMessage(emailSchema, value),
        },
        form,
        state: {
            isPending: mutation.isPending,
        },
    } satisfies ForgotPasswordLogicResult<typeof form>
}
