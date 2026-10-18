import type { PUBLISHED_RELEASES } from '../published-releases.ts'

export interface PublishedRelease {
    readonly version: string
    readonly image: string
    readonly digest: string
    readonly revision: string
}

export type PublishedReleaseKey = keyof typeof PUBLISHED_RELEASES
