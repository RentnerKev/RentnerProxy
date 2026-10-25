import type { ReleaseChannel } from '../../../features/ApplicationVersion/Types/application-update.types.ts'

export interface ParsedReleaseVersion {
    readonly version: string
    readonly channel: ReleaseChannel
    readonly major: string
    readonly minor: string
    readonly patch: string
    readonly prerelease: readonly string[]
}
