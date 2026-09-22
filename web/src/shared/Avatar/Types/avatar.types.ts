export type UserAvatarSize = 'sm' | 'md' | 'lg'

export interface UserAvatarProps {
    readonly profileImageVersion: number | null
    readonly size?: UserAvatarSize
    readonly userId: string
}
