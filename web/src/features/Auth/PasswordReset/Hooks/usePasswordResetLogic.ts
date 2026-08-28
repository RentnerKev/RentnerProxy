import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import useFragmentToken from '../../Shared/Hooks/useFragmentToken'
import { resetPasswordHandler } from '../server'
import { passwordConfirmationInputSchema } from '../validation'
import type { PasswordResetFormValues } from '../Types/password-reset-form.types'

export default function usePasswordResetLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const mutation = useMutation({
        mutationFn: (values: PasswordResetFormValues) =>
            resetPasswordHandler({ data: { ...values, token: token ?? '' } }),
        onSuccess: async (result) => {
            if (result.success) {
                await navigate({ to: '/login', replace: true })
            }
        },
    })
    const form = useForm({
        defaultValues: {
            password: '',
            confirmPassword: '',
        } satisfies PasswordResetFormValues,
        validators: { onSubmit: passwordConfirmationInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()
            await mutation.mutateAsync(value)
        },
    })

    return {
        state: {
            form,
            token,
            result: mutation.data,
            isError: mutation.isError,
            isPending: mutation.isPending,
        },
    }
}
