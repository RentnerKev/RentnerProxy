import type { ReleaseChannel } from '@/features/ApplicationVersion/Types/application-update.types.ts'
import type { RELEASE_IMAGE } from '../../../config/compatibility.config.ts'
import type { LEGACY_UPGRADE_CONTRACT } from '../legacyUpgradeContract.ts'

export interface ReleaseReadiness {
    readonly schemaVersion: typeof LEGACY_UPGRADE_CONTRACT.schemaVersion
    readonly releaseId: number
    readonly tag: string
    readonly channel: ReleaseChannel
    readonly publishedAt: string
    readonly revision: string
    readonly image: {
        readonly repository: typeof RELEASE_IMAGE
        readonly digest: string
        readonly platforms: readonly string[]
    }
    readonly upgrade: {
        readonly policy: typeof LEGACY_UPGRADE_CONTRACT.policy | 'manual-review'
        readonly minimumVersion: typeof LEGACY_UPGRADE_CONTRACT.profile.minimumSourceVersion | null
    }
}
