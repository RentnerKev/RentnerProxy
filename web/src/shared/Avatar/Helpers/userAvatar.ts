import { PROFILE_IMAGE_VERSION_QUERY_KEY } from '../../../config/profile-image.config'

export function getUserAvatarUrl(
    userId: string,
    profileImageVersion: number | null,
): string | null {
    if (
        !userId ||
        profileImageVersion === null ||
        !Number.isSafeInteger(profileImageVersion) ||
        profileImageVersion < 1
    ) {
        return null
    }

    return `/media/avatars/${encodeURIComponent(userId)}?${PROFILE_IMAGE_VERSION_QUERY_KEY}=${profileImageVersion}`
}
