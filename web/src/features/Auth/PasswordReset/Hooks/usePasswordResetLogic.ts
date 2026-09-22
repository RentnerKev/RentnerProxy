import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import useFragmentToken from '../../Shared/Hooks/useFragmentToken'
import { resetPasswordHandler } from '../server'
import { passwordConfirmationInputSchema } from '../validation'
import type { PasswordResetFormValues } from '../Types/password-reset-form.types'

export default function usePasswordResetLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: PasswordResetFormValues) =>
            resetPasswordHandler({ data: { ...values, token: token ?? '' } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await navigate({ to: '/login', replace: true })
            toast.success(t(result.message), { title: t('toast.titles.success') })
        },
        onError: () =>
            toast.error(t('Authentication service temporarily unavailable.'), {
                title: t('toast.titles.error'),
            }),
    })
    const form = useForm({
        defaultValues: {
            password: '',
            confirmPassword: '',
        } satisfies PasswordResetFormValues,
        validators: { onSubmit: passwordConfirmationInputSchema },
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
            token,
            isPending: mutation.isPending,
        },
    }
}
