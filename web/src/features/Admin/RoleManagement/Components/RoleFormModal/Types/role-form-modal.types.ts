import type { FormEventHandler } from 'react'

import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { RoleManagementSummary } from '@/lib/Auth/Types/auth.types.ts'
import type useRoleFormModalLogic from '../Hooks/useRoleFormModalLogic.ts'
import type { RoleFormModalProps } from '../../../Types/role-management-component-props.types.ts'

type RoleFormInstance = ReturnType<typeof useRoleFormModalLogic>['form']

export interface RoleFormModalState {
    readonly canEditPermissions: boolean
    readonly description: string
    readonly form: RoleFormInstance
    readonly formId: string
    readonly isCreate: boolean
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
    readonly title: string
}

export interface RoleFormModalHandler {
    readonly handleSubmit: FormEventHandler<HTMLFormElement>
}

export type RoleFormFieldsProps = Pick<
    RoleFormModalState,
    'canEditPermissions' | 'form' | 'formId' | 'isCreate'
> & {
    readonly assignablePermissionKeys: readonly PermissionKey[]
    readonly role?: RoleManagementSummary | undefined
}

export type RoleFormModalFooterProps = Pick<
    RoleFormModalState,
    'form' | 'formId' | 'isPending' | 'pendingSubmitLabel' | 'submitLabel'
> &
    Pick<RoleFormModalProps, 'onOpenChange'>
