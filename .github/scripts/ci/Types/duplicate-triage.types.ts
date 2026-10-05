export type TriageItemKind = 'issue' | 'pull_request'

export type TriageState = 'open' | 'closed'

export interface TriageItem {
    readonly kind: TriageItemKind
    readonly number: number
    readonly title: string
    readonly body: string
    readonly closedAt: string | null
    readonly labels: readonly string[]
    readonly state: TriageState
    readonly stateReason: string | null
    readonly merged: boolean
    readonly draft: boolean
    readonly updatedAt: string
    readonly revision: string
    readonly files: readonly string[]
    readonly linkedIssues: readonly number[]
}

export interface SimilarityBreakdown {
    readonly score: number
    readonly title: number
    readonly body: number
    readonly labels: number
    readonly fileOverlap: number
    readonly sharedLinkedIssues: readonly number[]
}

export interface CandidateMatch {
    readonly item: TriageItem
    readonly similarity: SimilarityBreakdown
}

export interface ManagedComment {
    readonly id: number
    readonly body: string
}

export interface CommentWriter {
    createComment(body: string): Promise<void>
    updateComment(commentId: number, body: string): Promise<void>
    deleteComment(commentId: number): Promise<void>
}

export interface GitHubLabel {
    readonly name: string
}

export interface GitHubIssue {
    readonly number: number
    readonly title: string
    readonly body: string | null
    readonly state: string
    readonly state_reason?: string | null
    readonly closed_at: string | null
    readonly updated_at: string
    readonly labels: readonly (string | GitHubLabel)[]
    readonly pull_request?: unknown
}

export interface GitHubPullRequest {
    readonly number: number
    readonly title: string
    readonly body: string | null
    readonly state: string
    readonly updated_at: string
    readonly closed_at: string | null
    readonly merged_at: string | null
    readonly draft: boolean
    readonly labels: readonly (string | GitHubLabel)[]
    readonly head: { readonly sha: string }
    readonly base: { readonly sha: string }
}

export interface GitHubPullRequestFile {
    readonly filename: string
}

export interface GitHubIssueComment {
    readonly id: number
    readonly body: string | null
    readonly user: { readonly login: string } | null
}

export interface GitHubTimelineEvent {
    readonly event?: string
    readonly created_at?: string
}

export interface EventPayload {
    readonly action?: unknown
    readonly issue?: { readonly number?: unknown }
    readonly pull_request?: { readonly number?: unknown }
}

export type FetchImplementation = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>
