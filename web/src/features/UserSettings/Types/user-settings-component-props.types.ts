import type { AuthenticatedUser } from '../../../shared/Types/auth.types'
import type useChangePasswordLogic from '../Hooks/useChangePasswordLogic'
import type useProfileImageLogic from '../Hooks/useProfileImageLogic'

export interface UserSettingsPageProps {
    readonly user: AuthenticatedUser
}

export type AccountIdentityProps = UserSettingsPageProps

export interface ProfileImagePanelProps extends UserSettingsPageProps {
    readonly canUpdateProfileImage: boolean
}

export interface ProfileImageCropDialogProps {
    readonly logic: ReturnType<typeof useProfileImageLogic>
}

export interface ChangePasswordFormProps {
    readonly state: ReturnType<typeof useChangePasswordLogic>['state']
}
