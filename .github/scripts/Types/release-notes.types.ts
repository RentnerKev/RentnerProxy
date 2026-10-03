export type ReleaseChannel = 'alpha' | 'beta' | 'stable'

export interface ReleaseCategory {
    title: string
    labels: readonly string[]
}

export interface ReleaseNotesConfig {
    excludedLabels: readonly string[]
    highlightLabels: readonly string[]
    categories: readonly ReleaseCategory[]
}

export interface GitHubRelease {
    id: number
    tag_name: string
    published_at: string | null
    prerelease: boolean
    draft: boolean
}

export interface GitHubMilestone {
    number: number
    title: string
}

export interface GitHubIssue {
    number: number
    title: string
    closed_at: string | null
    state_reason?: string | null
    labels: readonly (string | { name?: string | null })[]
    pull_request?: unknown
    user?: {
        login: string
        type?: string
    } | null
}

export interface CurrentRelease {
    id: number
    tagName: string
    prerelease: boolean
    publishedAt: string
}

export interface IssueWindow {
    publishedAt: string
    previousPublishedAt?: string
}

export interface ReleaseNotesDocumentInput {
    repository: string
    tagName: string
    channel: ReleaseChannel
    publishedAt: string
    image: string
    bannerAssetName: string
    issues: readonly GitHubIssue[]
    config: ReleaseNotesConfig
    previousTag?: string
    initialRelease: boolean
}

export interface RenderedReleaseNotes {
    body: string
    changelog: string
}

export interface ParsedReleaseTag {
    channel: ReleaseChannel
    prereleasePart?: string
}
