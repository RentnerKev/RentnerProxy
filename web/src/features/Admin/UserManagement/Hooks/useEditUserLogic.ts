import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { UserSummary } from '../../../../shared/Types/auth.types'
import { userManagementQueryKeys } from '../queryKeys'
import { updateUserHandler } from '../server'
import type { UpdateUserFormValues } from '../Types/user-management-form.types'
import { updateUserFormSchema } from '../validation'

export default function useEditUserLogic(user: UserSummary) {
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: (values: UpdateUserFormValues) =>
            updateUserHandler({ data: { ...values, userId: user.id } }),
        onSuccess: async (result) => {
            if (result.success) {
                await queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all })
            }
        },
    })
    const form = useForm({
        defaultValues: {
            displayName: user.displayName,
            email: user.email,
            roleKeys: [...user.roleKeys],
        } satisfies UpdateUserFormValues,
        validators: { onSubmit: updateUserFormSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()
            await mutation.mutateAsync(value)
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
