import type useRoleManagementLogic from '../Hooks/useRoleManagementLogic'

export interface RoleManagementPageViewProps {
    readonly currentUserRoleKeys: readonly string[]
    readonly logic: ReturnType<typeof useRoleManagementLogic>
}
