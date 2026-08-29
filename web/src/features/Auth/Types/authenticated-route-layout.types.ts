import type { AuthenticatedUser } from '../../../shared/Types/auth.types'

export interface AuthenticatedRouteLayoutProps {
    readonly user: AuthenticatedUser
}

export interface PermissionRouteContext {
    readonly context: {
        readonly user: AuthenticatedUser
    }
}
