import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { roleManagementQueryKeys } from '../queryKeys'
import { createRoleHandler, updateRoleHandler } from '../server'
import type { RoleFormModalProps } from '../Types/role-management-component-props.types'
import type { RoleEditorFormValues } from '../Types/role-management-form.types'
import { createRoleInputSchema } from '../validation'

type UseRoleFormLogicParams = Pick<
    RoleFormModalProps,
    | 'canAssignPermissions'
    | 'currentUserRoleKeys'
    | 'mode'
    | 'onCurrentUserChanged'
    | 'onSuccess'
    | 'role'
>

export default function useRoleFormLogic({
    canAssignPermissions,
    currentUserRoleKeys,
    mode,
    onCurrentUserChanged,
    onSuccess,
    role,
}: UseRoleFormLogicParams) {
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: (values: RoleEditorFormValues) => {
            if (mode === 'create') {
                return createRoleHandler({ data: values })
            }

            if (!role) {
                throw new Error('An editable role is required.')
            }

            return updateRoleHandler({
                data: {
                    roleId: role.id,
                    name: values.name,
                    description: values.description,
                    ...(canAssignPermissions ? { permissionKeys: values.permissionKeys } : {}),
                },
            })
        },
        onSuccess: async (result) => {
            if (!result.success) {
                return
            }

            await queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })

            if (mode === 'edit' && role && currentUserRoleKeys.includes(role.key)) {
                await onCurrentUserChanged()
            }

            onSuccess(result.message)
        },
    })
    const defaultValues: RoleEditorFormValues = {
        key: role?.key ?? '',
        name: role?.name ?? '',
        description: role?.description ?? '',
        permissionKeys: role ? [...role.permissionKeys] : [],
    }
    const form = useForm({
        defaultValues,
        validators: { onSubmit: createRoleInputSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            try {
                await mutation.mutateAsync(value)
            } catch {
                // The mutation state keeps the modal open and exposes the transport failure.
            }
        },
    })

    return {
        state: {
            form,
            isPending: mutation.isPending,
            errorMessage:
                mutation.data && !mutation.data.success
                    ? mutation.data.message
                    : mutation.isError
                      ? 'The role could not be saved.'
                      : null,
        },
    }
}
