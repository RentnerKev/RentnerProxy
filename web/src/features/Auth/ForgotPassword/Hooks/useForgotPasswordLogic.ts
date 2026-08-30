import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import { requestPasswordResetHandler } from '../server'
import { forgotPasswordInputSchema } from '../validation'
import type { ForgotPasswordFormValues } from '../Types/forgot-password-form.types'

export default function useForgotPasswordLogic() {
    const toast = useToast()
    const mutation = useMutation({
        mutationFn: (values: ForgotPasswordFormValues) =>
            requestPasswordResetHandler({ data: values }),
        onSuccess: (result) => {
            if (result.success) {
                toast.success(result.message)
                return
            }

            toast.error(result.message)
        },
        onError: () => toast.error('Authentication service temporarily unavailable.'),
    })
    const form = useForm({
        defaultValues: { email: '' } satisfies ForgotPasswordFormValues,
        validators: { onSubmit: forgotPasswordInputSchema },
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
            isPending: mutation.isPending,
        },
    }
}
