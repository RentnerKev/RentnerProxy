import type { UserSummary } from '@/shared/Types/auth.types.ts'
import type { RoleSummary } from '@/shared/Types/auth.types.ts'

export interface UserManagementLogicResult {
    readonly state: {
        readonly actorIsOwner: boolean
        readonly assignableRoles: readonly RoleSummary[]
        readonly canAssignRoles: boolean
        readonly canCreate: boolean
        readonly canDisable: boolean
        readonly canEnable: boolean
        readonly canUpdate: boolean
        readonly disableTarget: UserSummary | null
        readonly enablingUserId: string | null
        readonly isDisabling: boolean
        readonly isLoadingUsers: boolean
        readonly isRolesError: boolean
        readonly isRolesPending: boolean
        readonly isUsersError: boolean
        readonly selectedUser: UserSummary | null
        readonly showCreate: boolean
        readonly users: UserSummary[]
    }
    readonly handler: {
        readonly confirmDisable: () => Promise<void>
        readonly enableUser: (value: UserSummary) => void
        readonly handleFormSuccess: () => void
        readonly openCreate: () => void
        readonly openDisable: (value: UserSummary) => void
        readonly openEditor: (value: UserSummary) => void
        readonly refreshCurrentUser: () => Promise<void>
        readonly retryRoles: () => void
        readonly retryUsers: () => void
        readonly setCreateOpen: (open: boolean) => void
        readonly setDisableOpen: (open: boolean) => void
        readonly setEditorOpen: (open: boolean) => void
    }
}
