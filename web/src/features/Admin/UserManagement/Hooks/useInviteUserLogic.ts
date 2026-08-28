import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { userManagementQueryKeys } from '../queryKeys'
import { createUserHandler } from '../server'
import type { InviteUserFormValues } from '../Types/user-management-form.types'
import { inviteUserFormSchema } from '../validation'

export default function useInviteUserLogic() {
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: (values: InviteUserFormValues) =>
            createUserHandler({
                data: {
                    ...(values.displayName.trim() ? { displayName: values.displayName } : {}),
                    email: values.email,
                    roleKeys: values.roleKeys,
                },
            }),
        onSuccess: async (result) => {
            if (result.success) {
                await queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all })
            }
        },
    })
    const form = useForm({
        defaultValues: {
            displayName: '',
            email: '',
            roleKeys: ['viewer'],
        } satisfies InviteUserFormValues,
        validators: { onSubmit: inviteUserFormSchema },
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
            isError: mutation.isError,
            isPending: mutation.isPending,
            result: mutation.data,
        },
    }
}
