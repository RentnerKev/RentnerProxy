import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { RoleSummary } from '../../../../shared/Types/auth.types'
import { roleManagementQueryKeys } from '../queryKeys'
import { createRoleHandler, updateRoleHandler } from '../server'
import type { RoleEditorFormValues } from '../Types/role-management-form.types'
import { createRoleInputSchema } from '../validation'

export default function useRoleEditorLogic(role: RoleSummary | null) {
    const queryClient = useQueryClient()
    const defaultValues: RoleEditorFormValues = {
        key: role?.key ?? '',
        name: role?.name ?? '',
        description: role?.description ?? '',
        permissionKeys: role ? [...role.permissionKeys] : [],
    }
    const mutation = useMutation({
        mutationFn: (values: RoleEditorFormValues) =>
            role
                ? updateRoleHandler({
                      data: {
                          roleId: role.id,
                          name: values.name,
                          description: values.description,
                          permissionKeys: values.permissionKeys,
                      },
                  })
                : createRoleHandler({ data: values }),
        onSuccess: async (result) => {
            if (result.success) {
                await queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })
            }
        },
    })
    const form = useForm({
        defaultValues,
        validators: { onSubmit: createRoleInputSchema },
        onSubmit: async ({ value, formApi }) => {
            mutation.reset()
            const result = await mutation.mutateAsync(value)

            if (result.success && !role) {
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
