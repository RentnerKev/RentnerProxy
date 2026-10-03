import type { PermissionKey } from '../../../config/Types/permissions-config.types.ts'
import type { USER_STATUSES } from '@/config/auth.config.ts'
import type { UserThemeMode } from '../../../config/Types/theme-config.types.ts'
import type { NavigationGroupPreferences } from '../../../config/Types/navigation-config.types.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'

export type UserStatus = (typeof USER_STATUSES)[number]

export interface AuthenticatedUser {
    readonly displayName: string
    readonly id: string
    readonly email: string
    readonly profileImageVersion: number | null
    readonly roles: ReadonlyArray<string>
    readonly permissions: ReadonlyArray<PermissionKey>
    readonly language: AppLanguage
    readonly themeMode: UserThemeMode
    readonly navigationGroupPreferences?: NavigationGroupPreferences
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
