import type {
    PullRequestSnapshot,
    WorkflowRun,
    WorkflowArtifact,
} from '../Types/pr-preview.types.ts'
import { asRecord, asArray } from './validation.ts'
import {
    MAX_PAGES,
    GitHubApi,
    parseWorkflowRun,
    parseWorkflowArtifact,
    fetchPullRequest,
} from './github-api.ts'
import { verifyWorkflowRunIdentity } from './gate.ts'
import { PREVIEW_ARTIFACT_NAME, MAX_PREVIEW_ARTIFACT_BYTES } from './artifacts.ts'

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
    if (pullRequest.headSha !== workflowRun.headSha) throw new Error('Pull request is stale.')
    if (
        pullRequest.baseRepository !== api.repository ||
        pullRequest.headRepository !== workflowRun.headRepository
    ) {
        throw new Error('Could not resolve pull request.')
    }
    return pullRequest
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
