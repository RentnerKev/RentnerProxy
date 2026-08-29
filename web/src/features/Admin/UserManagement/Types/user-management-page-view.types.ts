import type useUserManagementLogic from '../Hooks/useUserManagementLogic'

export interface UserManagementPageViewProps {
    readonly currentUserId: string
    readonly logic: ReturnType<typeof useUserManagementLogic>
}
