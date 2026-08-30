import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { changePasswordHandler } from '../server'
import useToast from '../../../shared/Toast/Hooks/useToast'
import { changePasswordInputSchema } from '../validation'
import type { ChangePasswordFormValues } from '../Types/change-password-form.types'

export default function useChangePasswordLogic() {
    const toast = useToast()
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
                    toast.success(result.message)
                } else {
                    toast.error(result.message)
                }
            } catch {
                toast.error('account.password.error.update')
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
