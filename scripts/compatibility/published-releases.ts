import type { PublishedRelease, PublishedReleaseKey } from './Types/published-releases.types.ts'

const image = 'ghcr.io/rentnerkev/rentnerproxy'

export const PUBLISHED_RELEASES = {
    'beta.1': {
        version: 'v1.0.0-beta.1',
        digest: 'sha256:f50faba7ab60c4020790576032cc46350778b8cee1eda5cb8efbfa00333c5d9e',
        revision: '9efb498bac2cc12fef4823ee7ac9b31444a5ab54',
    },
} as const satisfies Record<string, Omit<PublishedRelease, 'image'>>

export function publishedRelease(key: PublishedReleaseKey): PublishedRelease {
    const release = PUBLISHED_RELEASES[key]
    return { ...release, image: image + ':' + release.version + '@' + release.digest }
}
