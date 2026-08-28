import { useForm } from '@tanstack/react-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import useFragmentToken from '../../Shared/Hooks/useFragmentToken'
import { acceptInviteHandler } from '../server'
import { acceptInviteFormSchema } from '../validation'
import type { AcceptInviteFormValues } from '../Types/accept-invite-form.types'

export default function useAcceptInviteLogic() {
    const token = useFragmentToken()
    const navigate = useNavigate()
    const router = useRouter()
    const mutation = useMutation({
        mutationFn: (values: AcceptInviteFormValues) =>
            acceptInviteHandler({ data: { ...values, token: token ?? '' } }),
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
            password: '',
            confirmPassword: '',
        } satisfies AcceptInviteFormValues,
        validators: { onSubmit: acceptInviteFormSchema },
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
