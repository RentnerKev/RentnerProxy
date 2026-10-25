import type { ReleaseReadiness } from '../../../../web/src/lib/ApplicationVersion/Types/release-readiness.types.ts'

export interface ReleaseReadinessInput {
    readonly repository: string
    readonly releaseId: string
    readonly tag: string
    readonly channel: string
    readonly prerelease: string
    readonly publishedAt: string
    readonly revision: string
    readonly image: string
    readonly digest: string
    readonly platforms: string
}

export interface ValidatedReleaseReadinessInput {
    readonly releaseId: number
    readonly tag: string
    readonly channel: ReleaseReadiness['channel']
    readonly publishedAt: string
    readonly revision: string
    readonly digest: string
}
