import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const workflowDirectory = resolve(repositoryRoot, '.github/workflows')

async function workflow(name: string): Promise<string> {
    return readFile(resolve(workflowDirectory, name), 'utf8')
}

async function previewHelper(): Promise<string> {
    return readFile(resolve(repositoryRoot, 'scripts/pr-preview.ts'), 'utf8')
}

function externalActionReferences(source: string): readonly string[] {
    return [...source.matchAll(/^\s*uses:\s+([^\s]+)(?:\s+#.*)?$/gmu)]
        .map((match) => match[1])
        .filter((reference): reference is string => reference !== undefined)
}

function runBlocks(source: string): readonly string[] {
    return [...source.matchAll(/^\s+run:\s+\|\r?\n((?:\s{18,}.*(?:\r?\n|$))*)/gmu)].map(
        (match) => match[1] ?? '',
    )
}

describe('trusted PR trigger proof', () => {
    test('captures the PR number and github.sha without executing pull request code', async () => {
        const trigger = await workflow('pr-title.yml')

        expect(trigger).toContain('PR_NUMBER: ${{ github.event.pull_request.number }}')
        expect(trigger).toContain('TESTED_SHA: ${{ github.sha }}')
        expect(trigger).toContain('name: pr-preview-source')
        expect(trigger).toContain('pr-number.txt')
        expect(trigger).toContain('tested-sha.txt')
        expect(trigger).toContain('retention-days: 2')
        expect(trigger).toContain('pull-requests: read')
        expect(trigger).toContain('github.event.pull_request.number || github.ref')
        expect(trigger).toContain('$GITHUB_API_URL/repos/$REPOSITORY/pulls/$pr_number')
        expect(trigger).not.toContain('actions/checkout@')
        expect(trigger).not.toContain('contents: read')
        expect(trigger).not.toContain('secrets.')
        for (const reference of externalActionReferences(trigger)) {
            expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
        }
    })
})

describe('trusted-triggered, read-only PR preview build workflow', () => {
    test('starts from the trusted PR Title workflow and exposes no writes or secrets', async () => {
        const build = await workflow('pr-preview-build.yml')

        expect(build).toContain('name: PR Preview Build')
        expect(build).toContain('workflow_run:')
        expect(build).toContain('- PR Title')
        expect(build).toContain('- completed')
        expect(build).not.toContain('pull_request_target:')
        expect(build).not.toMatch(/^\s+pull_request:\s*$/mu)
        expect(build).not.toContain('packages: write')
        expect(build).not.toContain('pull-requests: write')
        expect(build).not.toContain('issues: write')
        expect(build).not.toContain('contents: write')
        expect(build).not.toContain('id-token: write')
        expect(build).not.toContain('secrets.')
        expect(build).not.toContain('write-all')
        expect(build).toContain('persist-credentials: false')
        expect(build).toContain('ref: ${{ github.workflow_sha }}')
        expect(build).toContain('bun trusted/scripts/pr-preview.ts trigger-preflight')
        expect(build).toContain('bun trusted/scripts/pr-preview.ts gate')
        expect(build).toContain('name: pr-preview-source')
        expect(build).toContain('group: pr-preview-build-${{ github.event.workflow_run.id }}')
        expect(build).not.toContain(
            'group: pr-preview-build-${{ github.event.workflow_run.head_sha }}',
        )
    })

    test('builds the exact tested merge commit into one OCI artifact without publishing', async () => {
        const build = await workflow('pr-preview-build.yml')

        expect(build).toContain('SOURCE_RUN_ID: ${{ github.event.workflow_run.id }}')
        expect(build).toContain('ref: ${{ needs.verify.outputs.tested_sha }}')
        expect(build).toContain('file source/docker/production/Dockerfile')
        expect(build).toContain('--platform "$PREVIEW_PLATFORM"')
        expect(build).toContain('--output "type=oci,dest=$oci_archive"')
        expect(build).toContain('--provenance=false')
        expect(build).toContain('--sbom=false')
        expect(build).toContain('compression-level: 0')
        expect(build).toContain('retention-days: 2')
        expect(build).toContain('triggerRunId: $triggerRunId')
        expect(build).not.toMatch(/(?:docker|buildx)\s+(?:login|push)\b/u)
        expect(build).not.toContain('--push')
        expect(build).not.toContain('type=gha')
        expect(build).not.toContain('docker run')
    })

    test('pins every external action to a full commit SHA', async () => {
        const references = externalActionReferences(await workflow('pr-preview-build.yml'))

        expect(references.length).toBeGreaterThan(0)
        for (const reference of references) expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
    })

    test('binds every successful gate to unchanged base workflows and strict checks', async () => {
        const helper = await previewHelper()

        expect(helper).toContain("PREVIEW_TRIGGER_WORKFLOW_NAME = 'PR Title'")
        expect(helper).toContain("PREVIEW_TRIGGER_WORKFLOW_PATH = '.github/workflows/pr-title.yml'")
        expect(helper).toContain('strict_required_status_checks_policy !== true')
        expect(helper).toContain('verifyRequiredCheckProvenance')
        expect(helper).toContain('verifyWorkflowFileUnchanged')
        expect(helper).toContain('readTriggerProof')
        expect(helper).toContain('Tested SHA proof does not match the preview artifact')
        expect(helper).toContain('Pull request proof does not match the preview artifact')
        expect(helper).toContain(
            'resolveWorkflowPullRequest(api, workflowRun, proof.pullRequestNumber)',
        )
        expect(helper).toContain(
            'resolveWorkflowPullRequest(api, triggerRun, proof.pullRequestNumber)',
        )
        expect(helper).toContain('assertWorkflowRunPullRequest(workflowRun.pullRequests, expected)')
        expect(helper).toContain('assertWorkflowRunPullRequest(triggerRun.pullRequests, expected)')
        expect(helper).not.toContain('associatedPullRequestNumbers')
        expect(helper).toContain('/actions/runs/')
        expect(helper).toContain('Required workflow was changed by the pull request')
    })
})

describe('trusted PR preview publisher workflow', () => {
    test('starts only from the completed preview build and verifies its identity', async () => {
        const publisher = await workflow('pr-preview-publish.yml')

        expect(publisher).toContain('workflow_run:')
        expect(publisher).toContain('- PR Preview Build')
        expect(publisher).toContain('- completed')
        expect(publisher).toContain("github.event.workflow_run.conclusion == 'success'")
        expect(publisher).toContain("github.event.workflow_run.event == 'workflow_run'")
        expect(publisher).not.toContain('pull_request_target:')
        expect(publisher).not.toMatch(/^\s+pull_request:\s*$/mu)
    })

    test('checks out only trusted workflow code and never executes the OCI image', async () => {
        const publisher = await workflow('pr-preview-publish.yml')
        const refs = [...publisher.matchAll(/^\s+ref:\s+(.+)$/gmu)].map((match) => match[1])

        expect(refs).toHaveLength(3)
        expect(refs.every((ref) => ref?.trim() === '${{ github.workflow_sha }}')).toBeTrue()
        expect(publisher).not.toContain('github.event.workflow_run.head_sha')
        expect(publisher).not.toContain('refs/pull/')
        expect(publisher).not.toMatch(/\bdocker (?:run|load)\b/u)
        expect(publisher).not.toMatch(/\bbun run\b/u)
        expect(publisher).not.toMatch(/\b(?:npm|cargo)\s/u)
        expect(publisher).toContain('skopeo copy --preserve-digests')
        expect(publisher).not.toContain('skopeo copy --all')
        expect(publisher).toContain('OCI index must contain exactly one linux/amd64 image')
    })

    test('limits write permissions to package publishing and the separate comment job', async () => {
        const publisher = await workflow('pr-preview-publish.yml')

        expect(publisher.match(/packages: write/gmu)).toHaveLength(1)
        expect(publisher.match(/pull-requests: write/gmu)).toHaveLength(1)
        expect(publisher).not.toContain('contents: write')
        expect(publisher).not.toContain('actions: write')
        expect(publisher).not.toContain('issues: write')
        expect(publisher).not.toContain('id-token: write')
        expect(publisher).not.toContain('write-all')
    })

    test('downloads only the source run artifact and revalidates before moving the tag', async () => {
        const publisher = await workflow('pr-preview-publish.yml')
        const preflight = publisher.indexOf('bun trusted/scripts/pr-preview.ts preflight')
        const download = publisher.indexOf('Download exact handoff artifact for resolution')
        const firstRevalidation = publisher.indexOf('bun trusted/scripts/pr-preview.ts revalidate')
        const movingCopy = publisher.indexOf('"docker://$MOVING_REFERENCE"')

        expect(publisher).toContain('name: pr-preview-image')
        expect(publisher).toContain('name: pr-preview-source')
        expect(publisher).toContain('bun trusted/scripts/pr-preview.ts artifact-identity')
        expect(publisher).toContain('SOURCE_PROOF_DIRECTORY:')
        expect(preflight).toBeGreaterThan(-1)
        expect(download).toBeGreaterThan(preflight)
        expect(publisher).toContain('run-id: ${{ github.event.workflow_run.id }}')
        expect(publisher).toContain(
            'group: pr-preview-publish-${{ needs.resolve.outputs.pr_number }}',
        )
        expect(publisher.match(/bun trusted\/scripts\/pr-preview\.ts revalidate/gmu)).toHaveLength(
            3,
        )
        expect(firstRevalidation).toBeGreaterThan(-1)
        expect(movingCopy).toBeGreaterThan(firstRevalidation)
        expect(publisher).toContain('Moving and immutable preview tags have different digests')
    })

    test('keeps release channels, Git tags, source pushes, and releases out of scope', async () => {
        const publisher = await workflow('pr-preview-publish.yml')

        expect(publisher).not.toMatch(/docker:\/\/[^\s"']+:(?:latest|dev|stable|beta)\b/u)
        expect(publisher).not.toMatch(/docker:\/\/[^\s"']+:v?[0-9]+\.[0-9]+\.[0-9]+/u)
        expect(publisher).not.toMatch(/\bgh release\b/u)
        expect(publisher).not.toMatch(/\bgit push\b/u)
        expect(publisher).not.toMatch(/\bgit tag\b/u)
        expect(publisher).not.toContain('release:')
    })

    test('does not interpolate event or output expressions inside shell programs', async () => {
        const blocks = runBlocks(await workflow('pr-preview-publish.yml'))

        expect(blocks.length).toBeGreaterThan(0)
        for (const block of blocks) expect(block).not.toContain('${{')
    })

    test('pins every external action to a full commit SHA', async () => {
        const references = externalActionReferences(await workflow('pr-preview-publish.yml'))

        expect(references.length).toBeGreaterThan(0)
        for (const reference of references) expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
    })
})
