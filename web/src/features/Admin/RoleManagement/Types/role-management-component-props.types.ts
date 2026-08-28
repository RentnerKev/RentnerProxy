import type { RoleSummary } from '../../../../shared/Types/auth.types'

export interface RoleManagementPageProps {
    readonly permissions: readonly string[]
}

export interface PermissionCheckboxesProps {
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

export interface RoleEditorProps {
    readonly canAssignPermissions: boolean
    readonly onClose: () => void
    readonly role: RoleSummary | null
}

export interface RolesTableProps {
    readonly roles: RoleSummary[]
    readonly canDelete: boolean
    readonly canUpdate: boolean
    readonly isDeleting: boolean
    readonly onDelete: (role: RoleSummary) => void
    readonly onEdit: (role: RoleSummary) => void
}
