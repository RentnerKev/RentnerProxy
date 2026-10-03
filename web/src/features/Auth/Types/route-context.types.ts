import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export interface PermissionRouteContext {
    readonly context: {
        readonly user: AuthenticatedUser
    }
}
