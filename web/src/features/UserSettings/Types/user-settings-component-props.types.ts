import type { AuthenticatedUser } from '../../../shared/Types/auth.types'
import type useChangePasswordLogic from '../Hooks/useChangePasswordLogic'
import type useProfileImageLogic from '../Hooks/useProfileImageLogic'
import type { UserSettingsSection } from './user-settings-section.types'

export interface AccountIdentityProps {
    readonly user: AuthenticatedUser
}

export interface UserSettingsPageProps extends AccountIdentityProps {
    readonly activeSection: UserSettingsSection
}

export interface ProfileImagePanelProps extends AccountIdentityProps {
    readonly canUpdateProfileImage: boolean
}

export interface ProfileImageCropDialogProps {
    readonly logic: ReturnType<typeof useProfileImageLogic>
}

export interface ChangePasswordFormProps {
    readonly state: ReturnType<typeof useChangePasswordLogic>['state']
}
