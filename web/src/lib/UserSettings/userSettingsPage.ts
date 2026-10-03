import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    DEFAULT_USER_SETTINGS_SECTION,
    USER_SETTINGS_SECTIONS,
} from '@/config/user-settings.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export function getUserSettingsSearch(search: Record<string, unknown>) {
    return {
        section:
            USER_SETTINGS_SECTIONS.find((section) => section === search.section) ??
            DEFAULT_USER_SETTINGS_SECTION,
    }
}

export function getUserSettingsPageViewModel(user: AuthenticatedUser) {
    return {
        canUpdateProfileImage: user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE),
    }
}
