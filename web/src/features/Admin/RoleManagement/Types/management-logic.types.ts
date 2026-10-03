import type { RoleManagementSummary } from '@/lib/Auth/Types/auth.types.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'

export interface RoleManagementLogicResult {
    readonly state: {
        readonly assignablePermissionKeys: readonly PermissionKey[]
        readonly canAssignPermissions: boolean
        readonly canCreate: boolean
        readonly canDelete: boolean
        readonly canUpdate: boolean
        readonly deleteTarget: RoleManagementSummary | null
        readonly isDeleting: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly roles: RoleManagementSummary[]
        readonly selectedRole: RoleManagementSummary | null
        readonly showCreate: boolean
    }
    readonly handler: {
        readonly confirmDelete: () => Promise<void>
        readonly handleFormSuccess: () => void
        readonly openCreate: () => void
        readonly openDelete: (value: RoleManagementSummary) => void
        readonly openEditor: (value: RoleManagementSummary) => void
        readonly refreshCurrentUser: () => Promise<void>
        readonly retry: () => void
        readonly setCreateOpen: (open: boolean) => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly setEditorOpen: (open: boolean) => void
    }
}
