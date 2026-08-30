import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { changePasswordHandler } from '../server'
import { changePasswordInputSchema } from '../validation'
import type { ChangePasswordFormValues } from '../Types/change-password-form.types'

export default function useChangePasswordLogic() {
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
            const result = await mutation.mutateAsync(value)

            if (result.success) {
                formApi.reset()
            }
        },
    })

    return {
        state: {
            form,
            result: mutation.data,
            isError: mutation.isError,
            isPending: mutation.isPending,
        },
    }
}
