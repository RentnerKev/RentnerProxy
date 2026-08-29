import type { AuthenticatedUser } from '../../../../shared/Types/auth.types'
import type useAccountLogic from '../Hooks/useAccountLogic'
import type useProfileImageLogic from '../Hooks/useProfileImageLogic'

export interface AccountPageProps {
    readonly user: AuthenticatedUser
}

export type AccountIdentityProps = AccountPageProps

export interface ProfileImagePanelProps extends AccountPageProps {
    readonly canUpdateProfileImage: boolean
}

export interface ProfileImageCropDialogProps {
    readonly logic: ReturnType<typeof useProfileImageLogic>
}

export interface ChangePasswordFormProps {
    readonly state: ReturnType<typeof useAccountLogic>['state']
}
