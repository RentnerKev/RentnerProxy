export type JsonRecord = Record<string, unknown>

export interface PreviewIdentity {
    readonly image: string
    readonly immutableReference: string
    readonly immutableTag: string
    readonly movingReference: string
    readonly movingTag: string
    readonly pullRequestNumber: number
    readonly repository: string
    readonly shortTestedSha: string
    readonly testedSha: string
}

export interface RequiredCheck {
    readonly context: string
    readonly integrationId: number | null
}

export interface CheckRun {
    readonly appId: number | null
    readonly conclusion: string | null
    readonly detailsUrl: string
    readonly id: number
    readonly name: string
    readonly status: string
}

export interface CheckEvaluation {
    readonly failed: readonly string[]
    readonly ignored: readonly string[]
    readonly missing: readonly string[]
    readonly pending: readonly string[]
    readonly state: 'failed' | 'missing' | 'pending' | 'success'
}

export interface PullRequestSnapshot {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly draft: boolean
    readonly headRepository: string | null
    readonly headSha: string
    readonly mergeable: boolean | null
    readonly mergeCommitSha: string | null
    readonly number: number
    readonly state: PullRequestLifecycle
}

export type PullRequestLifecycle = 'closed' | 'open'

export interface ExpectedPullRequest {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly headRepository: string
    readonly headSha: string
    readonly number: number
    readonly testedSha: string
}

export interface PullRequestEvaluation {
    readonly reason: string
    readonly state: 'closed' | 'failed' | 'pending' | 'success'
}

export interface PreviewComment {
    readonly body: string | null
    readonly id: number
    readonly userLogin: string
    readonly userType: string
}

export interface PreviewArtifactMetadata {
    readonly artifactName: string
    readonly baseSha: string
    readonly createdAt: string
    readonly headRepository: string
    readonly headSha: string
    readonly ociSha256: string
    readonly platform: string
    readonly pullRequestNumber: number
    readonly repository: string
    readonly runAttempt: number
    readonly runId: number
    readonly schemaVersion: 1
    readonly testedSha: string
    readonly triggerRunId: number
}

export interface ArtifactExpectation extends ExpectedPullRequest {
    readonly artifactDirectory: string
    readonly runAttempt: number
    readonly runId: number
    readonly triggerRunId: number
}

export interface WorkflowRun {
    readonly conclusion: string
    readonly event: string
    readonly headRepository: string | null
    readonly headSha: string
    readonly id: number
    readonly name: string
    readonly path: string
    readonly pullRequests: readonly WorkflowRunPullRequest[]
    readonly repository: string
    readonly runAttempt: number
    readonly status: string
    readonly workflowId: number
}

export interface TriggerProof {
    readonly pullRequestNumber: number
    readonly testedSha: string
}

export interface WorkflowRunPullRequest {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly headRepository: string
    readonly headSha: string
    readonly number: number
}

export interface WorkflowArtifact {
    readonly digest: string
    readonly expired: boolean
    readonly name: string
    readonly sizeInBytes: number
    readonly workflowRunId: number
}

export interface WorkflowRunExpectation {
    readonly event: string
    readonly headRepository?: string
    readonly headSha?: string
    readonly name?: string
    readonly path?: string
}
