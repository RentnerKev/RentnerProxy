import type { ReleaseChannel } from '../../../features/ApplicationVersion/Types/application-update.types.ts'

export interface CompatibilityProfile {
    readonly generation: string
    readonly major: string
    readonly sourceChannels: readonly ReleaseChannel[]
    readonly targetChannels: readonly ReleaseChannel[]
    readonly minimumSourceVersion: string
    readonly minimumTargetVersion: string
    readonly backup: {
        readonly writtenVersion: number
        readonly acceptedVersions: readonly number[]
    }
}
