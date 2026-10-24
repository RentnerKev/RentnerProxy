import type { ReleaseChannel } from '@/features/ApplicationVersion/Types/application-update.types.ts'

export function isReleaseMetadataCompatible(channel: ReleaseChannel, prerelease: boolean): boolean {
    // Beta releases may use either GitHub presentation flag, as Beta 1 already does.
    return channel === 'beta' || prerelease === (channel === 'alpha')
}
