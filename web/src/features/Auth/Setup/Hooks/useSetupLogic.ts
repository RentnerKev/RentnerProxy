import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { setupOwnerHandler } from '../server'
import { setupInputSchema } from '../validation'
import type { SetupFormValues } from '../Types/setup-form.types'

export default function useSetupLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const mutation = useMutation({
        mutationFn: (values: SetupFormValues) => setupOwnerHandler({ data: values }),
        onSuccess: async (result) => {
            if (result.success) {
                await router.invalidate()
                await navigate({ to: '/', replace: true })
            }
        },
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
