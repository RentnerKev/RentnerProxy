import type { PermissionKey } from '../../config/permissions.config'
import type { USER_STATUSES } from '../../config/auth.config'
import type { UserThemeMode } from '../../config/theme.config'

export type UserStatus = (typeof USER_STATUSES)[number]

export interface AuthenticatedUser {
    readonly displayName: string
    readonly id: string
    readonly email: string
    readonly profileImageVersion: number | null
    readonly roles: ReadonlyArray<string>
    readonly permissions: ReadonlyArray<PermissionKey>
    readonly themeMode: UserThemeMode
}

export interface UserSummary {
    readonly displayName: string
    readonly id: string
    readonly email: string
    readonly profileImageVersion: number | null
    readonly status: UserStatus
    readonly roleKeys: ReadonlyArray<string>
    readonly createdAt: Date
    readonly updatedAt: Date
}

export interface RoleSummary {
    readonly id: string
    readonly key: string
    readonly name: string
    readonly description: string
    readonly isSystem: boolean
    readonly permissionKeys: ReadonlyArray<PermissionKey>
    readonly createdAt: Date
    readonly updatedAt: Date
}

export interface RoleManagementSummary extends RoleSummary {
    readonly userCount: number
}
