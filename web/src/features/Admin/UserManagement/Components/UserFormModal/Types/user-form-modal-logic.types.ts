import type { UserFormModalProps } from '../../../Types/user-management-component-props.types.ts'

export type UseUserFormLogicParams = Pick<
    UserFormModalProps,
    | 'canAssignRoles'
    | 'currentUserId'
    | 'mode'
    | 'onCurrentUserChanged'
    | 'onSuccess'
    | 'roles'
    | 'user'
>
