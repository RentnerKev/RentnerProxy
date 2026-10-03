import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export interface AuthenticatedRouteLayoutProps {
    readonly user: AuthenticatedUser
}
