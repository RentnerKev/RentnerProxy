import type { PermissionKey } from '../../../../config/permissions.config'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'

export interface RoleManagementPageProps {
    readonly currentUserRoleKeys: readonly string[]
    readonly permissions: readonly PermissionKey[]
}

export interface PermissionCheckboxesProps {
    readonly availablePermissionKeys: readonly PermissionKey[]
    readonly disabled: boolean
    readonly field: {
        readonly name: string
        readonly state: {
            readonly value: string[]
            readonly meta: { readonly errors: unknown[] }
        }
        readonly handleChange: (value: string[]) => void
    }
}

export interface RoleFormModalProps {
    readonly assignablePermissionKeys: readonly PermissionKey[]
    readonly canAssignPermissions: boolean
    readonly currentUserRoleKeys: readonly string[]
    readonly mode: 'create' | 'edit'
    readonly onCurrentUserChanged: () => Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: (message: string) => void
    readonly open: boolean
    readonly role?: RoleManagementSummary | undefined
}

export interface RolesTableProps {
    readonly canCreate: boolean
    readonly canDelete: boolean
    readonly canUpdate: boolean
    readonly isLoading: boolean
    readonly onCreate: () => void
    readonly onDelete: (role: RoleManagementSummary) => void
    readonly onEdit: (role: RoleManagementSummary) => void
    readonly roles: RoleManagementSummary[]
}

export type RoleTableActionProps = Pick<
    RolesTableProps,
    'canDelete' | 'canUpdate' | 'onDelete' | 'onEdit'
>

export interface RoleTableActionsProps extends RoleTableActionProps {
    readonly role: RoleManagementSummary
}
