import { useCallback, useState } from 'react'

export default function useUserAvatarLogic(src: string | null) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null)

    const handleError = useCallback(() => {
        setFailedSrc(src)
    }, [src])

    return {
        showImage: src !== null && src !== failedSrc,
        handleError,
    }
}
