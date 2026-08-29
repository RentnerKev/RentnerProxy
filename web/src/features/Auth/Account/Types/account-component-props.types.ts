import type { AuthenticatedUser } from '../../../../shared/Types/auth.types'
import type useAccountLogic from '../Hooks/useAccountLogic'

export interface AccountPageProps {
    readonly user: AuthenticatedUser
}

export type AccountIdentityProps = AccountPageProps

export interface ChangePasswordFormProps {
    readonly state: ReturnType<typeof useAccountLogic>['state']
}
