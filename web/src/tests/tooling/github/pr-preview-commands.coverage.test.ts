import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { GitHubApi } from '../../../../../.github/scripts/deploy/pr-preview/github-api.ts'
import { createPreviewIdentity } from '../../../../../.github/scripts/deploy/pr-preview/validation.ts'
import type {
    PullRequestSnapshot,
    WorkflowRun,
} from '../../../../../.github/scripts/deploy/Types/pr-preview.types.ts'

const expected = {
    baseRef: 'main',
    baseRepository: 'rentnerkev/rentnerproxy',
    baseSha: '2'.repeat(40),
    headRepository: 'contributor/rentnerproxy',
    headSha: '1'.repeat(40),
    number: 42,
    testedSha: '3'.repeat(40),
}
let pullRequest: PullRequestSnapshot = {
    ...expected,
    draft: false,
    mergeable: true,
    mergeCommitSha: expected.testedSha,
    state: 'open',
}
const triggerRun: WorkflowRun = {
    id: 101,
    workflowId: 202,
    runAttempt: 1,
    name: 'PR Preview Source',
    path: '.github/workflows/pr-preview-source.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    repository: expected.baseRepository,
    headRepository: expected.headRepository,
    headSha: expected.headSha,
    pullRequests: [expected],
}
const buildRun = { ...triggerRun, id: 303, runAttempt: 2 }
const artifact = {
    digest: 'sha256:' + 'a'.repeat(64),
    expired: false,
    name: 'pr-preview-image',
    sizeInBytes: 321,
    workflowRunId: 303,
}
const trigger = mock(async (_api: GitHubApi, _id: number) => ({
    artifact,
    workflowRun: triggerRun,
}))
const build = mock(async (_api: GitHubApi, _id: number) => ({ artifact, workflowRun: buildRun }))
const source = mock(async () => ({ pullRequest, expected }))
let eligible = true
const hasArtifact = mock(async (_api: GitHubApi, _id: number) => eligible)
let lifecycle = 'open'
const gate = mock(async () => lifecycle)
const verify = mock(async (..._arguments: unknown[]) => undefined)
mock.module('../../../../../.github/scripts/deploy/pr-preview/workflow.ts', () => ({
    eligiblePreviewTriggerRun: trigger,
    eligiblePreviewBuildRun: build,
    resolvePreviewSource: source,
    previewBuildHasArtifact: hasArtifact,
}))
mock.module('../../../../../.github/scripts/deploy/pr-preview/gate.ts', () => ({
    previewGateLifecycle: gate,
    verifyGate: verify,
}))
const { runCommand } = await import('../../../../../.github/scripts/deploy/pr-preview/commands.ts')

const parent = resolve(import.meta.dir, '../../../../../tmp/preview-command-tests')
let directory = ''
const originalArguments = [...process.argv]
const environment = {
    REPOSITORY: expected.baseRepository,
    GITHUB_TOKEN: 'synthetic-fixture-token',
    SOURCE_RUN_ID: '303',
    SOURCE_RUN_ATTEMPT: '2',
    SOURCE_TRIGGER_RUN_ID: '101',
    PR_NUMBER: '42',
    PR_BASE_REF: 'main',
    PR_BASE_SHA: expected.baseSha,
    PR_HEAD_REPOSITORY: expected.headRepository,
    PR_HEAD_SHA: expected.headSha,
    TESTED_SHA: expected.testedSha,
    GITHUB_RUN_ID: '303',
    GITHUB_RUN_ATTEMPT: '2',
    IMAGE: '',
    IMMUTABLE_REFERENCE: '',
    IMMUTABLE_TAG: '',
    MOVING_REFERENCE: '',
    MOVING_TAG: '',
    SOURCE_IMAGE_DIGEST: artifact.digest,
    IMMUTABLE_IMAGE_DIGEST: artifact.digest,
    MOVING_IMAGE_DIGEST: artifact.digest,
    IMAGE_DIGEST: artifact.digest,
    GITHUB_OUTPUT: '',
    ARTIFACT_DIRECTORY: '',
    SOURCE_PROOF_DIRECTORY: '',
}
const savedEnvironment = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]]),
)
const request = spyOn(GitHubApi.prototype, 'request').mockImplementation(async () => [])
const quiet = spyOn(console, 'log').mockImplementation(() => undefined)

beforeAll(async () => {
    await mkdir(parent, { recursive: true })
    directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected command fixture directory.')
    const identity = createPreviewIdentity(expected.baseRepository, 42, expected.testedSha, 303, 2)
    Object.assign(environment, {
        IMAGE: identity.image,
        IMMUTABLE_REFERENCE: identity.immutableReference,
        IMMUTABLE_TAG: identity.immutableTag,
        MOVING_REFERENCE: identity.movingReference,
        MOVING_TAG: identity.movingTag,
        GITHUB_OUTPUT: join(directory, 'output'),
        ARTIFACT_DIRECTORY: join(directory, 'artifact'),
        SOURCE_PROOF_DIRECTORY: join(directory, 'proof'),
    })
    Object.assign(process.env, environment)
    await mkdir(environment.ARTIFACT_DIRECTORY)
    await mkdir(environment.SOURCE_PROOF_DIRECTORY)
    await writeFile(join(environment.SOURCE_PROOF_DIRECTORY, 'pr-number.txt'), '42\n')
    await writeFile(
        join(environment.SOURCE_PROOF_DIRECTORY, 'tested-sha.txt'),
        expected.testedSha + '\n',
    )
    const archive = Buffer.from('synthetic artifact data')
    await writeFile(join(environment.ARTIFACT_DIRECTORY, 'preview-image.tar'), archive)
    await writeFile(
        join(environment.ARTIFACT_DIRECTORY, 'metadata.json'),
        JSON.stringify({
            artifactName: 'pr-preview-image',
            baseSha: expected.baseSha,
            createdAt: '2026-10-29T00:00:00.000Z',
            headRepository: expected.headRepository,
            headSha: expected.headSha,
            ociSha256: createHash('sha256').update(archive).digest('hex'),
            platform: 'linux/amd64',
            pullRequestNumber: 42,
            repository: expected.baseRepository,
            runAttempt: 2,
            runId: 303,
            schemaVersion: 1,
            testedSha: expected.testedSha,
            triggerRunId: 101,
        }),
    )
})
afterAll(async () => {
    request.mockRestore()
    quiet.mockRestore()
    process.argv = originalArguments
    for (const [name, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
    }
    if (directory) await rm(directory, { recursive: true, force: true })
})
async function invoke(command: string) {
    await writeFile(environment.GITHUB_OUTPUT, '')
    process.argv = [process.execPath, 'pr-preview.ts', command]
    await runCommand()
    return await readFile(environment.GITHUB_OUTPUT, 'utf8')
}

test('command preflights publish identity and eligibility only from the requested verified attempt', async () => {
    expect(await invoke('build-identity')).toContain(
        `immutable_tag=pr-42-${expected.testedSha.slice(0, 12)}-303-2`,
    )
    await invoke('trigger-preflight')
    expect(trigger.mock.calls.at(-1)?.[1]).toBe(303)
    expect(await invoke('preflight')).toBe('eligible=true\n')
    eligible = false
    expect(await invoke('preflight')).toBe('eligible=false\n')
    expect(hasArtifact.mock.calls.at(-1)?.[0].repository).toBe(expected.baseRepository)
    expect(await invoke('artifact-identity')).toBe('trigger_run_id=101\n')
    expect(build.mock.calls.at(-1)?.[1]).toBe(303)
})

test('gate and resolve bind output identity, verified source proof, digest and lifecycle', async () => {
    for (const command of ['gate', 'resolve']) {
        // eslint-disable-next-line no-await-in-loop -- commands share a synthetic output file and lifecycle state
        const output = await invoke(command)
        expect(output).toContain('lifecycle=open\n')
        expect(output).toContain('trigger_run_id=101\n')
        expect(output).toContain('pr_number=42\n')
        expect(output).toContain(`tested_sha=${expected.testedSha}\n`)
        if (command === 'resolve') {
            expect(output).toContain('artifact_digest=' + artifact.digest)
            expect(output).toContain('run_attempt=2\n')
            expect(output).toContain('run_id=303\n')
        }
        lifecycle = 'stale'
        // eslint-disable-next-line no-await-in-loop -- stale lifecycle must be observed before restoring shared state
        expect(await invoke(command)).toContain('lifecycle=stale\n')
        lifecycle = 'open'
    }
    pullRequest = { ...pullRequest, state: 'closed' }
    expect(await invoke('gate')).toContain('lifecycle=closed\n')
    expect(await invoke('resolve')).toContain('lifecycle=closed\n')
    pullRequest = { ...pullRequest, state: 'open', draft: true }
    await expect(invoke('resolve')).rejects.toThrow('Draft')
    pullRequest = { ...pullRequest, draft: false }
    await writeFile(
        join(environment.SOURCE_PROOF_DIRECTORY, 'tested-sha.txt'),
        '4'.repeat(40) + '\n',
    )
    await expect(invoke('resolve')).rejects.toThrow('SHA proof')
    await writeFile(
        join(environment.SOURCE_PROOF_DIRECTORY, 'tested-sha.txt'),
        expected.testedSha + '\n',
    )
    await writeFile(join(environment.SOURCE_PROOF_DIRECTORY, 'pr-number.txt'), '43\n')
    await expect(invoke('resolve')).rejects.toThrow('Pull request proof')
    await writeFile(join(environment.SOURCE_PROOF_DIRECTORY, 'pr-number.txt'), '42\n')
})

test('publication commands validate artifacts, immutable destinations, digest agreement and final gate before comment writes', async () => {
    await invoke('validate-artifact')
    await invoke('revalidate')
    expect(verify.mock.calls.at(-1)?.slice(1)).toEqual([expected, false])
    const reference = process.env.IMMUTABLE_REFERENCE
    process.env.IMMUTABLE_REFERENCE = 'ghcr.io/attacker/repository:latest'
    await expect(invoke('revalidate')).rejects.toThrow()
    process.env.IMMUTABLE_REFERENCE = reference
    await invoke('validate-digests')
    process.env.MOVING_IMAGE_DIGEST = 'sha256:' + 'b'.repeat(64)
    await expect(invoke('validate-digests')).rejects.toThrow('digest')
    process.env.MOVING_IMAGE_DIGEST = artifact.digest
    request.mockClear()
    await invoke('comment')
    expect(request.mock.calls.at(-1)?.[0]).toBe('/repos/rentnerkev/rentnerproxy/issues/42/comments')
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe('POST')
    expect(JSON.stringify(request.mock.calls.at(-1)?.[1]?.body)).toContain(
        environment.IMMUTABLE_REFERENCE,
    )
    verify.mockRejectedValueOnce(new Error('final gate rejected'))
    request.mockClear()
    await expect(invoke('comment')).rejects.toThrow('final gate rejected')
    expect(request).not.toHaveBeenCalled()
    await expect(invoke('unknown-command')).rejects.toThrow('Unknown')
})
