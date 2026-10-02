import type { FormEventHandler } from 'react'

import type { RoleSummary, UserSummary } from '@/shared/Types/auth.types.ts'
import type useUserFormModalLogic from '../Hooks/useUserFormModalLogic.ts'
import type { UserFormModalProps } from '../../../Types/user-management-component-props.types.ts'

export type UserFormInstance = ReturnType<typeof useUserFormModalLogic>['form']

export interface UserFormModalState {
    readonly canEditRoles: boolean
    readonly description: string
    readonly form: UserFormInstance
    readonly formId: string
    readonly isCreate: boolean
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly status: UserSummary['status']
    readonly submitLabel: string
    readonly title: string
}

export interface UserFormModalHandler {
    readonly handleSubmit: FormEventHandler<HTMLFormElement>
}

export type UserFormFieldsProps = Pick<
    UserFormModalState,
    'canEditRoles' | 'form' | 'formId' | 'isCreate' | 'status'
> & {
    readonly roles: readonly RoleSummary[]
    readonly user?: UserSummary | undefined
}

export type UserFormModalFooterProps = Pick<
    UserFormModalState,
    'form' | 'formId' | 'isPending' | 'pendingSubmitLabel' | 'submitLabel'
> &
    Pick<UserFormModalProps, 'onOpenChange'>
