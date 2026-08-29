import { useCallback, useId } from 'react'

import type { RoleFormModalProps } from '../Types/role-management-component-props.types'
import type { RoleFormModalHandler, RoleFormModalState } from '../Types/role-form-modal.types'
import useRoleFormLogic from './useRoleFormLogic'

export default function useRoleFormModal({
    assignablePermissionKeys,
    canAssignPermissions,
    mode,
    role,
    ...props
}: RoleFormModalProps): {
    readonly state: RoleFormModalState
    readonly handler: RoleFormModalHandler
} {
    const formId = useId()
    const isCreate = mode === 'create'
    const canEditPermissions =
        canAssignPermissions &&
        (isCreate ||
            Boolean(
                role?.permissionKeys.every((permission) =>
                    assignablePermissionKeys.includes(permission),
                ),
            ))
    const { state: formState } = useRoleFormLogic({
        ...props,
        canAssignPermissions: canEditPermissions,
        mode,
        role,
    })
    const handleSubmit = useCallback<RoleFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void formState.form.handleSubmit()
        },
        [formState.form],
    )

    return {
        state: {
            canEditPermissions,
            description: isCreate
                ? 'Create a reusable role and choose the permissions it grants.'
                : 'Update the custom role definition and its permission set.',
            errorMessage: formState.errorMessage,
            form: formState.form,
            formId,
            isCreate,
            isPending: formState.isPending,
            pendingSubmitLabel: isCreate ? 'Creating role…' : 'Saving role…',
            submitLabel: isCreate ? 'Create role' : 'Save changes',
            title: isCreate ? 'Add role' : `Edit ${role?.name ?? 'role'}`,
        },
        handler: { handleSubmit },
    }
}
