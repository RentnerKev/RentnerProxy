import { useCallback, useId } from 'react'

import type { UserFormModalProps } from '../Types/user-management-component-props.types'
import type { UserFormModalHandler, UserFormModalState } from '../Types/user-form-modal.types'
import useUserFormLogic from './useUserFormLogic'

export default function useUserFormModal({
    canAssignRoles,
    mode,
    roles,
    user,
    ...props
}: UserFormModalProps): {
    readonly state: UserFormModalState
    readonly handler: UserFormModalHandler
} {
    const formId = useId()
    const isCreate = mode === 'create'
    const canEditRoles =
        canAssignRoles &&
        (isCreate || Boolean(user?.roleKeys.every((key) => roles.some((role) => role.key === key))))
    const { state: formState } = useUserFormLogic({
        ...props,
        canAssignRoles: canEditRoles,
        mode,
        roles,
        user,
    })
    const handleSubmit = useCallback<UserFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void formState.form.handleSubmit()
        },
        [formState.form],
    )

    return {
        state: {
            canEditRoles,
            description: isCreate
                ? 'Create the account, assign its initial access, and send an invitation.'
                : 'Update account information and assigned roles.',
            errorMessage: formState.errorMessage,
            form: formState.form,
            formId,
            isCreate,
            isPending: formState.isPending,
            pendingSubmitLabel: isCreate ? 'Creating user…' : 'Saving user…',
            status: isCreate ? 'pending' : (user?.status ?? 'pending'),
            submitLabel: isCreate ? 'Create user' : 'Save changes',
            title: isCreate ? 'Add user' : `Edit ${user?.displayName ?? 'user'}`,
        },
        handler: { handleSubmit },
    }
}
