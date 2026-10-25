import { CURRENT_COMPATIBILITY_PROFILE } from '../../config/compatibility.config.ts'

export function isSupportedBackupVersion(version: unknown): boolean {
    return (
        typeof version === 'number' &&
        CURRENT_COMPATIBILITY_PROFILE.backup.acceptedVersions.some(
            (accepted) => version === accepted,
        )
    )
}

export function supportedBackupFormatLabel(): string {
    return CURRENT_COMPATIBILITY_PROFILE.backup.acceptedVersions
        .map((version) => `v${version}`)
        .join(', ')
}
