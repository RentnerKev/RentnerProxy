import { useCallback, useId } from 'react'
import type { RoleFormModalHandler, RoleFormModalState } from '../Types/role-form-modal.types.ts'

import { invalidateRoleManagementCache } from '@/lib/Admin/RoleManagement/roleManagementCache.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createRoleHandler, updateRoleHandler } from '../../../middleware.ts'
import type { RoleFormModalProps } from '../../../Types/role-management-component-props.types.ts'
import type { RoleEditorFormValues } from '../Types/role-management-form.types.ts'
import { createRoleInputSchema } from '../../../validation.ts'

type UseRoleFormLogicParams = Pick<
    RoleFormModalProps,
    | 'assignablePermissionKeys'
    | 'canAssignPermissions'
    | 'currentUserRoleKeys'
    | 'mode'
    | 'onCurrentUserChanged'
    | 'onSuccess'
    | 'role'
>

export default function useRoleFormModalLogic({
    canAssignPermissions: requestedCanAssignPermissions,
    assignablePermissionKeys,
    currentUserRoleKeys,
    mode,
    onCurrentUserChanged,
    onSuccess,
    role,
}: UseRoleFormLogicParams) {
    const { t } = useTranslationStore()
    const formId = useId()
    const isCreate = mode === 'create'
    const canAssignPermissions =
        requestedCanAssignPermissions &&
        (isCreate ||
            Boolean(
                role?.permissionKeys.every((permission) =>
                    assignablePermissionKeys.includes(permission),
                ),
            ))
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: (values: RoleEditorFormValues) => {
            if (mode === 'create') {
                return createRoleHandler({ data: values })
            }

            if (!role) {
                throw new Error('admin.roles.errors.editableRequired')
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
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await invalidateRoleManagementCache(queryClient)

            if (mode === 'edit' && role && currentUserRoleKeys.includes(role.key)) {
                await onCurrentUserChanged()
            }

            toast.success(t(result.message), { title: t('toast.titles.success') })
            onSuccess()
        },
        onError: () =>
            toast.error(t('admin.roles.errors.saveFailed'), { title: t('toast.titles.error') }),
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
            } catch {}
        },
    })

    const handleSubmit = useCallback<RoleFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
        },
        [form],
    )

    return {
        form,
        state: {
            canEditPermissions: canAssignPermissions,
            description: isCreate
                ? t('admin.roles.form.createDescription')
                : t('admin.roles.form.editDescription'),
            formId,
            isCreate,
            isPending: mutation.isPending,
            pendingSubmitLabel: isCreate ? t('admin.roles.form.creating') : t('common.saving'),
            submitLabel: isCreate ? t('admin.roles.actions.create') : t('common.save'),
            title: isCreate
                ? t('admin.roles.actions.add')
                : t('admin.roles.form.editTitle', { name: role?.name ?? t('admin.roles.item') }),
        } satisfies Omit<RoleFormModalState, 'form'>,
        handler: { handleSubmit } satisfies RoleFormModalHandler,
    }
}
