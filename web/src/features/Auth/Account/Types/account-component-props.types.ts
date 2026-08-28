import type { AuthenticatedUser } from '../../../../shared/Types/auth.types'

export interface AccountPageProps {
    readonly user: AuthenticatedUser
}

export type AccountIdentityProps = AccountPageProps
