export type UserAvatarSize = 'sm' | 'md' | 'lg'

export interface UserAvatarProps {
    readonly displayName: string
    readonly profileImageVersion: number | null
    readonly size?: UserAvatarSize
    readonly userId: string
}
