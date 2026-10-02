import type { AuthenticatedUser } from '@/shared/Types/auth.types.ts'

export interface ProfileImagePanelProps {
    readonly user: AuthenticatedUser
    readonly canUpdateProfileImage: boolean
}
