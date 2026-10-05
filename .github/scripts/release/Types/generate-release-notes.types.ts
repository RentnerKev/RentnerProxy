import type {
    RenderedReleaseNotes,
    GitHubIssue,
    CurrentRelease,
    ReleaseChannel,
    ReleaseNotesConfig,
} from '../../lib/Types/release-notes.types.ts'

export type FetchImplementation = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>

export interface GeneratedReleaseNotes extends RenderedReleaseNotes {
    issues: readonly GitHubIssue[]
    previousTag?: string
    milestoneNumber?: number
    selectionMode: 'milestone' | 'release-window'
}

export interface GenerateReleaseNotesInput {
    repository: string
    release: CurrentRelease
    channel: ReleaseChannel
    image: string
    bannerAssetName: string
    config: ReleaseNotesConfig
}
