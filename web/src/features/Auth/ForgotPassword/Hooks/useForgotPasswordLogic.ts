import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import { requestPasswordResetHandler } from '../server'
import { forgotPasswordInputSchema } from '../validation'
import type { ForgotPasswordFormValues } from '../Types/forgot-password-form.types'

export default function useForgotPasswordLogic() {
    const mutation = useMutation({
        mutationFn: (values: ForgotPasswordFormValues) =>
            requestPasswordResetHandler({ data: values }),
    })
    const form = useForm({
        defaultValues: { email: '' } satisfies ForgotPasswordFormValues,
        validators: { onSubmit: forgotPasswordInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()
            await mutation.mutateAsync(value)
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
