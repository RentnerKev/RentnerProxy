import type { RoleSummary, UserSummary } from '../../../../shared/Types/auth.types'

export interface UserManagementPageProps {
    readonly currentUserId: string
    readonly currentUserRoleKeys: readonly string[]
    readonly permissions: readonly string[]
}

export interface RoleCheckboxesProps {
    readonly disabled: boolean
    readonly field: {
        readonly name: string
        readonly state: {
            readonly value: string[]
            readonly meta: { readonly errors: unknown[] }
        }
        readonly handleChange: (value: string[]) => void
    }
    readonly roles: readonly RoleSummary[]
}

export interface UserFormModalProps {
    readonly canAssignRoles: boolean
    readonly currentUserId: string
    readonly mode: 'create' | 'edit'
    readonly onCurrentUserChanged: () => Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: (message: string) => void
    readonly open: boolean
    readonly roles: readonly RoleSummary[]
    readonly user?: UserSummary | undefined
}

export interface UsersTableProps {
    readonly actorIsOwner: boolean
    readonly canCreate: boolean
    readonly canDisable: boolean
    readonly canUpdate: boolean
    readonly createDisabled: boolean
    readonly currentUserId: string
    readonly isLoading: boolean
    readonly onCreate: () => void
    readonly onDisable: (user: UserSummary) => void
    readonly onEdit: (user: UserSummary) => void
    readonly users: UserSummary[]
}

export type UserTableActionProps = Pick<
    UsersTableProps,
    'actorIsOwner' | 'canDisable' | 'canUpdate' | 'currentUserId' | 'onDisable' | 'onEdit'
>

export interface UserTableActionsProps extends UserTableActionProps {
    readonly user: UserSummary
}
