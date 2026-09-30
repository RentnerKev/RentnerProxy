import { PERMISSIONS } from '../../../config/permissions.config'
import {
    DEFAULT_USER_SETTINGS_SECTION,
    USER_SETTINGS_SECTIONS,
} from '../../../config/user-settings.config'
import type { AuthenticatedUser } from '../../../shared/Types/auth.types'

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
        canUpdateSystemAppearance: user.permissions.includes(PERMISSIONS.SYSTEM_APPEARANCE_UPDATE),
    }
}
