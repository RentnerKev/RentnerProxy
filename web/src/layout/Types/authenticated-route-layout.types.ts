import type { AuthenticatedUser } from '../../shared/Types/auth.types'

export interface AuthenticatedRouteLayoutProps {
    readonly user: AuthenticatedUser
}
