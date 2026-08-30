import { PERMISSIONS } from '../../../config/permissions.config'
import type { AuthenticatedUser } from '../../../shared/Types/auth.types'

export function getUserSettingsPageViewModel(user: AuthenticatedUser) {
    return {
        canUpdateProfileImage: user.permissions.includes(PERMISSIONS.ACCOUNT_UPDATE),
    }
}
