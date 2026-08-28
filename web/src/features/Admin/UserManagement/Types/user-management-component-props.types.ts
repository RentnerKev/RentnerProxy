import type { RoleSummary, UserSummary } from '../../../../shared/Types/auth.types'

export interface UserManagementPageProps {
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

export interface InviteUserPanelProps {
    readonly canAssignRoles: boolean
    readonly onClose: () => void
    readonly roles: readonly RoleSummary[]
}

export interface EditUserPanelProps extends InviteUserPanelProps {
    readonly user: UserSummary
}

export interface UsersTableProps {
    readonly users: UserSummary[]
    readonly canDisable: boolean
    readonly canUpdate: boolean
    readonly isDisabling: boolean
    readonly onDisable: (user: UserSummary) => void
    readonly onEdit: (user: UserSummary) => void
}
