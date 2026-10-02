export type UserAvatarSize = 'sm' | 'md' | 'lg'

export interface UserAvatarProps {
    readonly profileImageVersion: number | null
    readonly size?: UserAvatarSize
    readonly userId: string
}

export interface UserAvatarLogicResult {
    readonly state: { readonly src: string | null; readonly showImage: boolean }
    readonly handler: { readonly handleError: () => void }
}
