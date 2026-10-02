import type { AuthenticatedUser } from '@/shared/Types/auth.types.ts'

export interface AuthenticatedRouteLayoutProps {
    readonly user: AuthenticatedUser
}
