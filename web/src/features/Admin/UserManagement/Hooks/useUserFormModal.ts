import { useCallback, useId } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'

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
    const { t } = useTranslationStore()
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
                ? t('admin.users.form.createDescription')
                : t('admin.users.form.editDescription'),
            form: formState.form,
            formId,
            isCreate,
            isPending: formState.isPending,
            pendingSubmitLabel: isCreate ? t('admin.users.form.creating') : t('common.saving'),
            status: isCreate ? 'pending' : (user?.status ?? 'pending'),
            submitLabel: isCreate ? t('admin.users.actions.create') : t('common.save'),
            title: isCreate
                ? t('admin.users.actions.add')
                : t('admin.users.form.editTitle', {
                      name: user?.displayName ?? t('admin.users.item'),
                  }),
        },
        handler: { handleSubmit },
    }
}
