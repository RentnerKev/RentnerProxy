import type { ExpectedPullRequest } from '../Types/pr-preview.types.ts'
import {
    normalizeRepository,
    createPreviewIdentity,
    assertPreviewPublishPlan,
    assertMatchingPreviewDigests,
} from './validation.ts'
import { evaluatePullRequest } from './checks.ts'
import { GitHubApi } from './github-api.ts'
import { assertWorkflowRunPullRequest, verifyWorkflowFileUnchanged, verifyGate } from './gate.ts'
import {
    PREVIEW_TRIGGER_WORKFLOW_PATH,
    resolveWorkflowPullRequest,
    eligiblePreviewTriggerRun,
    eligiblePreviewBuildRun,
} from './workflow.ts'
import {
    readTriggerProof,
    validateBuildArtifactMetadata,
    readArtifactDirectory,
    validateArtifactDirectory,
} from './artifacts.ts'
import { renderPreviewComment, upsertPreviewComment } from './comments.ts'
import {
    environment,
    environmentPositiveInteger,
    expectedPullRequestFromEnvironment,
    writeOutputs,
    previewOutputs,
} from './runtime.ts'

async function commandGate(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const sourceRunId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    const { workflowRun } = await eligiblePreviewTriggerRun(api, sourceRunId)
    if (workflowRun.headRepository === null)
        throw new Error('Could not resolve pull request trigger.')
    const proof = await readTriggerProof(environment('SOURCE_PROOF_DIRECTORY'))
    const pullRequest = await resolveWorkflowPullRequest(api, workflowRun, proof.pullRequestNumber)
    const expected: ExpectedPullRequest = {
        baseRef: pullRequest.baseRef,
        baseRepository: repository,
        baseSha: pullRequest.baseSha,
        headRepository: workflowRun.headRepository,
        headSha: workflowRun.headSha,
        number: pullRequest.number,
        testedSha: proof.testedSha,
    }
    const identity = createPreviewIdentity(
        expected.baseRepository,
        expected.number,
        expected.testedSha,
    )
    if (pullRequest.state === 'closed') {
        console.log('Pull request is closed; skipping preview publication.')
        await writeOutputs({
            ...previewOutputs(identity, expected),
            lifecycle: 'closed',
            trigger_run_id: workflowRun.id,
        })
        return
    }
    assertWorkflowRunPullRequest(workflowRun.pullRequests, expected)
    await verifyWorkflowFileUnchanged(api, PREVIEW_TRIGGER_WORKFLOW_PATH, expected)
    const gatedPullRequest = await verifyGate(api, expected, true)
    const lifecycle = gatedPullRequest.state
    if (lifecycle === 'closed')
        console.log('Pull request closed during gate; skipping preview publication.')
    await writeOutputs({
        ...previewOutputs(identity, expected),
        lifecycle,
        trigger_run_id: workflowRun.id,
    })
}

async function commandTriggerPreflight(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    await eligiblePreviewTriggerRun(api, runId)
    console.log('Pull request trigger and source-proof artifact envelope are eligible.')
}

async function commandPreflight(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    await eligiblePreviewBuildRun(api, runId)
    console.log('Source workflow and artifact envelope are eligible.')
}

async function commandArtifactIdentity(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    const { workflowRun } = await eligiblePreviewBuildRun(api, runId)
    const metadata = await readArtifactDirectory(environment('ARTIFACT_DIRECTORY'))
    validateBuildArtifactMetadata(metadata, repository, workflowRun)
    await writeOutputs({ trigger_run_id: metadata.triggerRunId })
}

async function commandResolve(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    const { artifact, workflowRun } = await eligiblePreviewBuildRun(api, runId)
    const metadata = await readArtifactDirectory(environment('ARTIFACT_DIRECTORY'))
    validateBuildArtifactMetadata(metadata, repository, workflowRun)
    const expected: ExpectedPullRequest = {
        baseRef: 'main',
        baseRepository: repository,
        baseSha: metadata.baseSha,
        headRepository: metadata.headRepository,
        headSha: metadata.headSha,
        number: metadata.pullRequestNumber,
        testedSha: metadata.testedSha,
    }
    const { workflowRun: triggerRun } = await eligiblePreviewTriggerRun(api, metadata.triggerRunId)
    const proof = await readTriggerProof(environment('SOURCE_PROOF_DIRECTORY'))
    if (proof.testedSha !== metadata.testedSha) {
        throw new Error('Tested SHA proof does not match the preview artifact.')
    }
    if (proof.pullRequestNumber !== metadata.pullRequestNumber) {
        throw new Error('Pull request proof does not match the preview artifact.')
    }
    const pullRequest = await resolveWorkflowPullRequest(api, triggerRun, proof.pullRequestNumber)
    const pullRequestEvaluation = evaluatePullRequest(pullRequest, expected)
    const identity = createPreviewIdentity(repository, expected.number, expected.testedSha)
    if (pullRequestEvaluation.state === 'closed') {
        console.log('Pull request is closed; skipping preview publication.')
        await writeOutputs({
            ...previewOutputs(identity, expected),
            artifact_digest: artifact.digest,
            artifact_size: artifact.sizeInBytes,
            lifecycle: 'closed',
            run_attempt: workflowRun.runAttempt,
            run_id: workflowRun.id,
            trigger_run_id: metadata.triggerRunId,
        })
        return
    }
    if (pullRequestEvaluation.state !== 'success') {
        throw new Error(pullRequestEvaluation.reason)
    }
    assertWorkflowRunPullRequest(triggerRun.pullRequests, expected)
    await verifyWorkflowFileUnchanged(api, PREVIEW_TRIGGER_WORKFLOW_PATH, expected)
    const gatedPullRequest = await verifyGate(api, expected, true)
    const lifecycle = gatedPullRequest.state
    if (lifecycle === 'closed')
        console.log('Pull request closed during gate; skipping preview publication.')

    await writeOutputs({
        ...previewOutputs(identity, expected),
        artifact_digest: artifact.digest,
        artifact_size: artifact.sizeInBytes,
        lifecycle,
        run_attempt: workflowRun.runAttempt,
        run_id: workflowRun.id,
        trigger_run_id: metadata.triggerRunId,
    })
}

async function commandValidateArtifact(): Promise<void> {
    const expected = expectedPullRequestFromEnvironment()
    await validateArtifactDirectory({
        ...expected,
        artifactDirectory: environment('ARTIFACT_DIRECTORY'),
        runAttempt: environmentPositiveInteger('SOURCE_RUN_ATTEMPT'),
        runId: environmentPositiveInteger('SOURCE_RUN_ID'),
        triggerRunId: environmentPositiveInteger('SOURCE_TRIGGER_RUN_ID'),
    })
}

async function commandRevalidate(): Promise<void> {
    const expected = expectedPullRequestFromEnvironment()
    assertPreviewPublishPlan(
        {
            image: environment('IMAGE'),
            immutableReference: environment('IMMUTABLE_REFERENCE'),
            immutableTag: environment('IMMUTABLE_TAG'),
            movingReference: environment('MOVING_REFERENCE'),
            movingTag: environment('MOVING_TAG'),
        },
        expected.baseRepository,
        expected.number,
        expected.testedSha,
    )
    const api = new GitHubApi(expected.baseRepository, environment('GITHUB_TOKEN'))
    await verifyGate(api, expected, false)
}

async function commandValidateDigests(): Promise<void> {
    assertMatchingPreviewDigests(
        environment('SOURCE_IMAGE_DIGEST'),
        environment('IMMUTABLE_IMAGE_DIGEST'),
        process.env.MOVING_IMAGE_DIGEST,
    )
}

async function commandComment(): Promise<void> {
    const expected = expectedPullRequestFromEnvironment()
    const api = new GitHubApi(expected.baseRepository, environment('GITHUB_TOKEN'))
    await verifyGate(api, expected, false)
    const identity = createPreviewIdentity(
        expected.baseRepository,
        expected.number,
        expected.testedSha,
    )
    const body = renderPreviewComment(identity, expected.headSha, environment('IMAGE_DIGEST'))
    await upsertPreviewComment(api, expected.number, body)
}

export async function runCommand(): Promise<void> {
    switch (process.argv[2]) {
        case 'trigger-preflight':
            await commandTriggerPreflight()
            return
        case 'preflight':
            await commandPreflight()
            return
        case 'artifact-identity':
            await commandArtifactIdentity()
            return
        case 'gate':
            await commandGate()
            return
        case 'resolve':
            await commandResolve()
            return
        case 'validate-artifact':
            await commandValidateArtifact()
            return
        case 'revalidate':
            await commandRevalidate()
            return
        case 'validate-digests':
            await commandValidateDigests()
            return
        case 'comment':
            await commandComment()
            return
        default:
            throw new Error('Unknown PR preview command.')
    }
}
