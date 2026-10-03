import type { RoleFormModalProps } from '../../../Types/role-management-component-props.types.ts'

export type UseRoleFormLogicParams = Pick<
    RoleFormModalProps,
    | 'assignablePermissionKeys'
    | 'canAssignPermissions'
    | 'currentUserRoleKeys'
    | 'mode'
    | 'onCurrentUserChanged'
    | 'onSuccess'
    | 'role'
>
