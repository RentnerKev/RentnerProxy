import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import { setupOwnerHandler } from '../server'
import { setupInputSchema } from '../validation'
import type { SetupFormValues } from '../Types/setup-form.types'

export default function useSetupLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const toast = useToast()
    const mutation = useMutation({
        mutationFn: (values: SetupFormValues) => setupOwnerHandler({ data: values }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
                return
            }

            toast.error(result.message)
        },
        onError: () => toast.error('Authentication service temporarily unavailable.'),
    })
    const form = useForm({
        defaultValues: {
            displayName: '',
            email: '',
            password: '',
            confirmPassword: '',
        } satisfies SetupFormValues,
        validators: { onSubmit: setupInputSchema },
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
