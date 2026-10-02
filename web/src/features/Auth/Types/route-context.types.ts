import type { AuthenticatedUser } from '@/shared/Types/auth.types.ts'

export interface PermissionRouteContext {
    readonly context: {
        readonly user: AuthenticatedUser
    }
}
