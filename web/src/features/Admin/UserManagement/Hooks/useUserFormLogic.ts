import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { SYSTEM_ROLES } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { roleManagementQueryKeys } from '../../RoleManagement/queryKeys'
import { userManagementQueryKeys } from '../queryKeys'
import { createUserHandler, updateUserHandler } from '../server'
import type { UserFormModalProps } from '../Types/user-management-component-props.types'
import type { UserFormValues } from '../Types/user-management-form.types'
import { inviteUserFormSchema, updateUserFormSchema } from '../validation'

type UseUserFormLogicParams = Pick<
    UserFormModalProps,
    | 'canAssignRoles'
    | 'currentUserId'
    | 'mode'
    | 'onCurrentUserChanged'
    | 'onSuccess'
    | 'roles'
    | 'user'
>

export default function useUserFormLogic({
    canAssignRoles,
    currentUserId,
    mode,
    onCurrentUserChanged,
    onSuccess,
    roles,
    user,
}: UseUserFormLogicParams) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: (values: UserFormValues) => {
            if (mode === 'create') {
                return createUserHandler({
                    data: {
                        ...(values.displayName.trim() ? { displayName: values.displayName } : {}),
                        email: values.email,
                        roleKeys: values.roleKeys,
                    },
                })
            }

            if (!user) {
                throw new Error('admin.users.errors.editableRequired')
            }

            return updateUserHandler({
                data: {
                    displayName: values.displayName,
                    email: values.email,
                    userId: user.id,
                    ...(canAssignRoles ? { roleKeys: values.roleKeys } : {}),
                },
            })
        },
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            const invalidations = [
                queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all }),
            ]

            if (mode === 'create' || canAssignRoles) {
                invalidations.push(
                    queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all }),
                )
            }

            await Promise.all(invalidations)

            if (mode === 'edit' && user?.id === currentUserId) {
                await onCurrentUserChanged()
            }

            toast.success(result.message)
            onSuccess()
        },
        onError: () => toast.error('admin.users.errors.saveFailed'),
    })
    const defaultRoleKey =
        roles.find((role) => role.key === SYSTEM_ROLES.VIEWER)?.key ?? roles.at(0)?.key ?? ''
    const form = useForm({
        defaultValues: {
            displayName: user?.displayName ?? '',
            email: user?.email ?? '',
            roleKeys: user ? [...user.roleKeys] : defaultRoleKey ? [defaultRoleKey] : [],
        } satisfies UserFormValues,
        validators: {
            onSubmit: mode === 'create' ? inviteUserFormSchema : updateUserFormSchema,
        },
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
        },
    }
}
