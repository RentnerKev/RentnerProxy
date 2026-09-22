import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { changePasswordHandler } from '../server'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../language/useTranslationStore'
import { changePasswordInputSchema } from '../validation'
import type { ChangePasswordFormValues } from '../Types/change-password-form.types'

export default function useChangePasswordLogic() {
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: (values: ChangePasswordFormValues) => changePasswordHandler({ data: values }),
    })
    const form = useForm({
        defaultValues: {
            currentPassword: '',
            password: '',
            confirmPassword: '',
        } satisfies ChangePasswordFormValues,
        validators: { onSubmit: changePasswordInputSchema },
        onSubmit: async ({ value, formApi }) => {
            mutation.reset()
            try {
                const result = await mutation.mutateAsync(value)
                if (result.success) {
                    formApi.reset()
                    toast.success(t(result.message), { title: t('toast.titles.success') })
                } else {
                    toast.error(t(result.message), { title: t('toast.titles.error') })
                }
            } catch {
                toast.error(t('account.password.error.update'), { title: t('toast.titles.error') })
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
