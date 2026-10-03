import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

export interface ProfileImagePanelProps {
    readonly user: AuthenticatedUser
    readonly canUpdateProfileImage: boolean
}
