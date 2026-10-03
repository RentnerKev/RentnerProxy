import type { UseUserFormLogicParams } from '../Types/user-form-modal-logic.types.ts'
import { useCallback, useId } from 'react'
import type { UserFormModalHandler, UserFormModalState } from '../Types/user-form-modal.types.ts'

import { invalidateUserManagementCache } from '@/lib/Admin/UserManagement/userManagementCache.ts'
import { invalidateRoleManagementCache } from '@/lib/Admin/RoleManagement/roleManagementCache.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { createUserHandler, updateUserHandler } from '../../../middleware.ts'

import type { UserFormValues } from '../Types/user-management-form.types.ts'
import { inviteUserFormSchema, updateUserFormSchema } from '../../../validation.ts'

export default function useUserFormModalLogic({
    canAssignRoles: requestedCanAssignRoles,
    currentUserId,
    mode,
    onCurrentUserChanged,
    onSuccess,
    roles,
    user,
}: UseUserFormLogicParams) {
    const { t } = useTranslationStore()
    const formId = useId()
    const isCreate = mode === 'create'
    const canAssignRoles =
        requestedCanAssignRoles &&
        (isCreate || Boolean(user?.roleKeys.every((key) => roles.some((role) => role.key === key))))
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
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            const invalidations = [invalidateUserManagementCache(queryClient)]

            if (mode === 'create' || canAssignRoles) {
                invalidations.push(invalidateRoleManagementCache(queryClient))
            }

            await Promise.all(invalidations)

            if (mode === 'edit' && user?.id === currentUserId) {
                await onCurrentUserChanged()
            }

            toast.success(t(result.message), { title: t('toast.titles.success') })
            onSuccess()
        },
        onError: () =>
            toast.error(t('admin.users.errors.saveFailed'), { title: t('toast.titles.error') }),
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
            } catch {}
        },
    })

    const handleSubmit = useCallback<UserFormModalHandler['handleSubmit']>(
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
            canEditRoles: canAssignRoles,
            description: isCreate
                ? t('admin.users.form.createDescription')
                : t('admin.users.form.editDescription'),
            formId,
            isCreate,
            isPending: mutation.isPending,
            pendingSubmitLabel: isCreate ? t('admin.users.form.creating') : t('common.saving'),
            status: isCreate ? 'pending' : (user?.status ?? 'pending'),
            submitLabel: isCreate ? t('admin.users.actions.create') : t('common.save'),
            title: isCreate
                ? t('admin.users.actions.add')
                : t('admin.users.form.editTitle', {
                      name: user?.displayName ?? t('admin.users.item'),
                  }),
        } satisfies Omit<UserFormModalState, 'form'>,
        handler: { handleSubmit } satisfies UserFormModalHandler,
    }
}
