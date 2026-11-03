import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    DEFAULT_USER_SETTINGS_SECTION,
    USER_SETTINGS_SECTIONS,
} from '@/config/user-settings.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { UserSettingsSection } from '@/features/UserSettings/Types/user-settings-section.types.ts'
import { oidcFeedbackCodeSchema } from '@/lib/Auth/Oidc/validation.ts'
import type { OidcFeedbackCode } from '@/lib/Auth/Oidc/Types/oidc-feedback.types.ts'

export function getUserSettingsSearch(search: Record<string, unknown>): {
    section: UserSettingsSection
    oidcResult?: 'linked'
    oidcError?: OidcFeedbackCode
} {
    const parsedError = oidcFeedbackCodeSchema.safeParse(search.oidcError)
    const oidcError = parsedError.success ? parsedError.data : undefined
    return {
        section:
            USER_SETTINGS_SECTIONS.find((section) => section === search.section) ??
            DEFAULT_USER_SETTINGS_SECTION,
        ...(search.oidcResult === 'linked' ? { oidcResult: 'linked' as const } : {}),
        ...(oidcError ? { oidcError } : {}),
    }
}

export function getUserSettingsPageViewModel(user: AuthenticatedUser) {
    return {
        canUpdateProfileImage: user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE),
        canUpdateConnections: user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE),
    }
}
