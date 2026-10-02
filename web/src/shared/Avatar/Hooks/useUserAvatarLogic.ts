import { useCallback, useState } from 'react'
import { getUserAvatarUrl } from '@/lib/Avatar/userAvatar.ts'
import type { UserAvatarProps, UserAvatarLogicResult } from '../Types/avatar.types.ts'
export default function useUserAvatarLogic({
    userId,
    profileImageVersion,
}: Pick<UserAvatarProps, 'userId' | 'profileImageVersion'>): UserAvatarLogicResult {
    const src = getUserAvatarUrl(userId, profileImageVersion)
    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    const handleError = useCallback(() => {
        setFailedSrc(src)
    }, [src])
    return {
        state: { src, showImage: src !== null && src !== failedSrc },
        handler: { handleError },
    }
}
