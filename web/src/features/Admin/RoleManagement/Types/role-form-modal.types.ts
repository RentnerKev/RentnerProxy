import type { FormEventHandler } from 'react'

import type { PermissionKey } from '../../../../config/permissions.config'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import type useRoleFormLogic from '../Hooks/useRoleFormLogic'
import type { RoleFormModalProps } from './role-management-component-props.types'

export type RoleFormInstance = ReturnType<typeof useRoleFormLogic>['state']['form']

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
