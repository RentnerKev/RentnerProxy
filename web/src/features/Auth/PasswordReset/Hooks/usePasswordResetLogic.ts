import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import useFragmentToken from '../../Shared/Hooks/useFragmentToken'
import { resetPasswordHandler } from '../server'
import { passwordConfirmationInputSchema } from '../validation'
import type { PasswordResetFormValues } from '../Types/password-reset-form.types'

export default function usePasswordResetLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const toast = useToast()
    const mutation = useMutation({
        mutationFn: (values: PasswordResetFormValues) =>
            resetPasswordHandler({ data: { ...values, token: token ?? '' } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            await navigate({ to: '/login', replace: true })
            toast.success(result.message)
        },
        onError: () => toast.error('Authentication service temporarily unavailable.'),
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
            } catch {
                // The mutation callback reports transport failures.
            }
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
