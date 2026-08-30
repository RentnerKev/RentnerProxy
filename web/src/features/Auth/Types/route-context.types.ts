import type { AuthenticatedUser } from '../../../shared/Types/auth.types'

export interface PermissionRouteContext {
    readonly context: {
        readonly user: AuthenticatedUser
    }
}
