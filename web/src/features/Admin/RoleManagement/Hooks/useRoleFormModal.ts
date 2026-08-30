import { useCallback, useId } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'

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
    const { t } = useTranslationStore()
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
                ? t('admin.roles.form.createDescription')
                : t('admin.roles.form.editDescription'),
            errorMessage: formState.errorMessage,
            form: formState.form,
            formId,
            isCreate,
            isPending: formState.isPending,
            pendingSubmitLabel: isCreate ? t('admin.roles.form.creating') : t('common.saving'),
            submitLabel: isCreate ? t('admin.roles.actions.create') : t('common.save'),
            title: isCreate
                ? t('admin.roles.actions.add')
                : t('admin.roles.form.editTitle', { name: role?.name ?? t('admin.roles.item') }),
        },
        handler: { handleSubmit },
    }
}
