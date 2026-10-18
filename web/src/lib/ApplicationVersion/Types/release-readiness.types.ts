import type { ReleaseChannel } from '@/features/ApplicationVersion/Types/application-update.types.ts'

export interface ReleaseReadiness {
    readonly schemaVersion: 1
    readonly releaseId: number
    readonly tag: string
    readonly channel: ReleaseChannel
    readonly publishedAt: string
    readonly revision: string
    readonly image: {
        readonly repository: 'ghcr.io/rentnerkev/rentnerproxy'
        readonly digest: string
        readonly platforms: readonly string[]
    }
    readonly upgrade: {
        readonly policy: 'beta1-appliance-v1' | 'manual-review'
        readonly minimumVersion: 'v1.0.0-beta.1' | null
    }
}
