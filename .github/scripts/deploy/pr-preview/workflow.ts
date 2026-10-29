import type {
    PullRequestSnapshot,
    WorkflowRun,
    WorkflowArtifact,
    ExpectedPullRequest,
    TriggerProof,
    PreviewArtifactMetadata,
} from '../Types/pr-preview.types.ts'
import {
    asRecord,
    asArray,
    normalizeRepository,
    parsePositiveInteger,
    stringValue,
    validateFullSha,
} from './validation.ts'
import {
    MAX_PAGES,
    GitHubApi,
    parseWorkflowRun,
    parseWorkflowArtifact,
    fetchPullRequest,
} from './github-api.ts'
import {
    assertWorkflowRunPullRequest,
    verifyWorkflowFileUnchanged,
    verifyWorkflowRunIdentity,
} from './gate.ts'
import { PREVIEW_ARTIFACT_NAME, MAX_PREVIEW_ARTIFACT_BYTES } from './artifacts.ts'
import { assertPullRequestBranchUpToDate } from './checks.ts'

const PREVIEW_SOURCE_ARTIFACT_NAME = 'pr-preview-source'

const PREVIEW_TRIGGER_WORKFLOW_NAME = 'PR Preview Source'

export const PREVIEW_TRIGGER_WORKFLOW_PATH = '.github/workflows/pr-preview-source.yml'

const PREVIEW_WORKFLOW_NAME = 'PR Preview Build'

const PREVIEW_WORKFLOW_PATH = '.github/workflows/pr-preview-build.yml'

const MAX_SOURCE_ARTIFACT_BYTES = 64 * 1024

export async function resolveWorkflowPullRequest(
    api: GitHubApi,
    workflowRun: WorkflowRun,
    pullRequestNumber: number,
): Promise<PullRequestSnapshot> {
    const pullRequest = await fetchPullRequest(api, pullRequestNumber)
    if (pullRequest.number !== pullRequestNumber) {
        throw new Error('Could not resolve pull request.')
    }
    if (
        workflowRun.repository !== api.repository ||
        pullRequest.baseRepository !== api.repository ||
        workflowRun.headRepository === null ||
        pullRequest.headRepository !== workflowRun.headRepository
    ) {
        throw new Error('Could not resolve pull request.')
    }
    if (workflowRun.pullRequests.length > 0) {
        const linked = workflowRun.pullRequests.filter(
            (entry) =>
                entry.number === pullRequestNumber &&
                entry.baseRepository === api.repository &&
                entry.headRepository === workflowRun.headRepository &&
                (entry.headSha === workflowRun.headSha || entry.headSha === pullRequest.headSha),
        )
        if (linked.length !== 1)
            throw new Error('Pull request proof does not match the source run.')
    } else if (pullRequest.headSha !== workflowRun.headSha) {
        const associated = await api.arrayPages(
            `/repos/${api.repository}/commits/${workflowRun.headSha}/pulls`,
        )
        const matches = associated.filter((value) => {
            const entry = asRecord(value, 'Commit pull request')
            const base = asRecord(entry.base, 'Commit pull request base')
            const head = asRecord(entry.head, 'Commit pull request head')
            return (
                parsePositiveInteger(entry.number, 'Commit pull request number') ===
                    pullRequestNumber &&
                normalizeRepository(
                    asRecord(base.repo, 'Commit pull request base repository').full_name,
                ) === api.repository &&
                normalizeRepository(
                    asRecord(head.repo, 'Commit pull request head repository').full_name,
                ) === workflowRun.headRepository
            )
        })
        if (matches.length !== 1)
            throw new Error('Pull request proof does not match the source commit.')
    }
    return pullRequest
}

export async function resolvePreviewSource(
    api: GitHubApi,
    workflowRun: WorkflowRun,
    proof: TriggerProof,
    metadata?: PreviewArtifactMetadata,
): Promise<{ pullRequest: PullRequestSnapshot; expected: ExpectedPullRequest }> {
    const pullRequest = await resolveWorkflowPullRequest(api, workflowRun, proof.pullRequestNumber)
    const testedSha = validateFullSha(proof.testedSha, 'Tested source SHA')
    const commit = asRecord(
        await api.request(`/repos/${api.repository}/git/commits/${testedSha}`),
        'Tested merge commit',
    )
    const parents = asArray(commit.parents, 'Tested merge parents').map((value) =>
        validateFullSha(asRecord(value, 'Tested merge parent').sha, 'Tested merge parent SHA'),
    )
    if (
        validateFullSha(commit.sha, 'Tested merge SHA') !== testedSha ||
        parents.length !== 2 ||
        parents[1] !== workflowRun.headSha ||
        parents[0] === parents[1]
    ) {
        throw new Error('Tested merge commit does not match the source run.')
    }
    if (workflowRun.headRepository === null)
        throw new Error('Could not resolve pull request trigger.')
    const sourcePullRequest = workflowRun.pullRequests.find(
        (entry) => entry.number === pullRequest.number,
    )
    const expected: ExpectedPullRequest = {
        baseRef: sourcePullRequest?.baseRef ?? pullRequest.baseRef,
        baseRepository: api.repository,
        baseSha: parents[0]!,
        headRepository: workflowRun.headRepository,
        headSha: workflowRun.headSha,
        number: pullRequest.number,
        testedSha,
    }
    try {
        assertWorkflowRunPullRequest(workflowRun.pullRequests, expected)
    } catch {
        assertWorkflowRunPullRequest(workflowRun.pullRequests, {
            ...expected,
            baseRef: pullRequest.baseRef,
            baseRepository: pullRequest.baseRepository,
            baseSha: pullRequest.baseSha,
            headSha: pullRequest.headSha,
        })
        if (expected.baseSha !== pullRequest.baseSha) {
            const comparison = await api.request(
                `/repos/${api.repository}/compare/${expected.baseSha}...${pullRequest.baseSha}`,
            )
            assertPullRequestBranchUpToDate(comparison, expected.baseSha)
        }
    }
    if (
        metadata &&
        (metadata.repository !== expected.baseRepository ||
            expected.baseRef !== 'main' ||
            metadata.baseSha !== expected.baseSha ||
            metadata.headRepository !== expected.headRepository ||
            metadata.headSha !== expected.headSha ||
            metadata.pullRequestNumber !== expected.number ||
            metadata.testedSha !== expected.testedSha ||
            metadata.triggerRunId !== workflowRun.id)
    ) {
        throw new Error('Preview artifact source does not match the verified trigger proof.')
    }
    await verifyWorkflowFileUnchanged(api, PREVIEW_TRIGGER_WORKFLOW_PATH, expected)
    return { pullRequest, expected }
}

async function fetchWorkflowArtifacts(
    api: GitHubApi,
    runId: number,
): Promise<readonly WorkflowArtifact[]> {
    const artifacts: WorkflowArtifact[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = asRecord(
            // eslint-disable-next-line no-await-in-loop -- artifact pagination is deliberately sequential
            await api.request(
                `/repos/${api.repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
            ),
            'Workflow artifact response',
        )
        const pageArtifacts = asArray(response.artifacts, 'Workflow artifacts').map(
            parseWorkflowArtifact,
        )
        artifacts.push(...pageArtifacts)
        if (pageArtifacts.length < 100) return artifacts
    }
    throw new Error('Workflow artifact pagination limit exceeded.')
}

async function validateWorkflowArtifact(
    api: GitHubApi,
    runId: number,
    expectedName: string,
    maximumBytes: number,
): Promise<WorkflowArtifact> {
    const artifacts = await fetchWorkflowArtifacts(api, runId)
    return validateWorkflowArtifacts(artifacts, runId, expectedName, maximumBytes)
}

function validateWorkflowArtifacts(
    artifacts: readonly WorkflowArtifact[],
    runId: number,
    expectedName: string,
    maximumBytes: number,
): WorkflowArtifact {
    if (artifacts.length !== 1) throw new Error('Expected exactly one workflow artifact.')
    const artifact = artifacts[0]!
    if (artifact.name !== expectedName) throw new Error('Expected workflow artifact is missing.')
    if (artifact.workflowRunId !== runId) throw new Error('Workflow artifact run does not match.')
    if (artifact.expired) throw new Error('Workflow artifact has expired.')
    if (artifact.sizeInBytes <= 0 || artifact.sizeInBytes > maximumBytes) {
        throw new Error('Workflow artifact size is invalid.')
    }
    return artifact
}

export async function eligiblePreviewTriggerRun(
    api: GitHubApi,
    runId: number,
): Promise<{ readonly artifact: WorkflowArtifact; readonly workflowRun: WorkflowRun }> {
    const workflowRun = parseWorkflowRun(
        await api.request(`/repos/${api.repository}/actions/runs/${runId}`),
    )
    if (workflowRun.id !== runId || workflowRun.headRepository === null) {
        throw new Error('Could not resolve pull request trigger.')
    }
    await verifyWorkflowRunIdentity(api, workflowRun, {
        event: 'pull_request',
        headRepository: workflowRun.headRepository,
        headSha: workflowRun.headSha,
        name: PREVIEW_TRIGGER_WORKFLOW_NAME,
        path: PREVIEW_TRIGGER_WORKFLOW_PATH,
    })
    return {
        artifact: await validateWorkflowArtifact(
            api,
            runId,
            PREVIEW_SOURCE_ARTIFACT_NAME,
            MAX_SOURCE_ARTIFACT_BYTES,
        ),
        workflowRun,
    }
}

export async function eligiblePreviewBuildRun(
    api: GitHubApi,
    runId: number,
): Promise<{ readonly artifact: WorkflowArtifact; readonly workflowRun: WorkflowRun }> {
    const workflowRun = await fetchEligiblePreviewBuildRun(api, runId)
    return {
        artifact: await validateWorkflowArtifact(
            api,
            runId,
            PREVIEW_ARTIFACT_NAME,
            MAX_PREVIEW_ARTIFACT_BYTES,
        ),
        workflowRun,
    }
}

async function fetchEligiblePreviewBuildRun(api: GitHubApi, runId: number): Promise<WorkflowRun> {
    const workflowRun = parseWorkflowRun(
        await api.request(`/repos/${api.repository}/actions/runs/${runId}`),
    )
    if (workflowRun.id !== runId) {
        throw new Error('Source workflow run is not an eligible PR preview build.')
    }
    await verifyWorkflowRunIdentity(api, workflowRun, {
        event: 'workflow_run',
        name: PREVIEW_WORKFLOW_NAME,
        path: PREVIEW_WORKFLOW_PATH,
    })
    return workflowRun
}

export async function previewBuildHasArtifact(api: GitHubApi, runId: number): Promise<boolean> {
    const workflowRun = await fetchEligiblePreviewBuildRun(api, runId)
    const artifacts = await fetchWorkflowArtifacts(api, runId)
    if (artifacts.length > 0) {
        validateWorkflowArtifacts(
            artifacts,
            runId,
            PREVIEW_ARTIFACT_NAME,
            MAX_PREVIEW_ARTIFACT_BYTES,
        )
        return true
    }
    if (workflowRun.headRepository !== api.repository) {
        throw new Error('Skipped preview build head repository is invalid.')
    }
    const response = asRecord(
        await api.request(
            `/repos/${api.repository}/actions/runs/${runId}/attempts/${workflowRun.runAttempt}/jobs?per_page=100&page=1`,
        ),
        'Preview build jobs',
    )
    const jobs = asArray(response.jobs, 'Preview build jobs').map((value) =>
        asRecord(value, 'Preview build job'),
    )
    if (
        parsePositiveInteger(response.total_count, 'Preview build job count') !== 2 ||
        jobs.length !== 2
    ) {
        throw new Error('Missing artifact is not explained by an exact skipped preview build.')
    }
    const expectedJobs = new Map([
        ['PR Preview / Verify checks', 'success'],
        ['PR Preview / Build image', 'skipped'],
    ])
    const ids = new Set<number>()
    for (const job of jobs) {
        const id = parsePositiveInteger(job.id, 'Preview build job ID')
        const name = stringValue(job.name, 'Preview build job name')
        const conclusion = expectedJobs.get(name)
        if (
            ids.has(id) ||
            !conclusion ||
            job.status !== 'completed' ||
            job.conclusion !== conclusion ||
            parsePositiveInteger(job.run_id, 'Preview build job run ID') !== runId ||
            job.head_sha !== workflowRun.headSha
        ) {
            throw new Error('Missing artifact is not explained by an exact skipped preview build.')
        }
        ids.add(id)
        expectedJobs.delete(name)
    }
    const currentRun = await fetchEligiblePreviewBuildRun(api, runId)
    if (
        currentRun.runAttempt !== workflowRun.runAttempt ||
        currentRun.headSha !== workflowRun.headSha
    ) {
        throw new Error('Preview build attempt changed during preflight.')
    }
    return false
}
