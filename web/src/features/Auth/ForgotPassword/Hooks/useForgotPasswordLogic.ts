import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import { requestPasswordResetHandler } from '../server'
import { forgotPasswordInputSchema } from '../validation'
import type { ForgotPasswordFormValues } from '../Types/forgot-password-form.types'

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
        state: {
            form,
            isPending: mutation.isPending,
        },
    }
}
