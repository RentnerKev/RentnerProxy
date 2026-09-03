import { describe, expect, test } from 'bun:test'

import {
    PREVIEW_COMMENT_MARKER,
    actionsRunIdFromDetailsUrl,
    assertMatchingPreviewDigests,
    assertPullRequestBranchUpToDate,
    assertPreviewPublishPlan,
    assertWorkflowRunPullRequest,
    assertPreviewTag,
    createPreviewIdentity,
    evaluatePullRequest,
    evaluateRequiredChecks,
    normalizeWorkflowPath,
    parsePositiveInteger,
    parsePullRequestNumberProof,
    parsePreviewArtifactMetadata,
    parseTestedShaProof,
    renderPreviewComment,
    selectPreviewComment,
    validateFullSha,
} from '../../../scripts/pr-preview'
import type { PreviewArtifactMetadata } from '../../../scripts/pr-preview'

const headSha = '1'.repeat(40)
const baseSha = '2'.repeat(40)
const testedSha = '3'.repeat(40)

function currentPullRequest() {
    return {
        baseRef: 'main',
        baseRepository: 'rentnerkev/rentnerproxy',
        baseSha,
        draft: false,
        headRepository: 'contributor/rentnerproxy',
        headSha,
        mergeable: true,
        mergeCommitSha: testedSha,
        number: 42,
        state: 'open',
    } as const
}

const expectedPullRequest = {
    baseRef: 'main',
    baseRepository: 'rentnerkev/rentnerproxy',
    baseSha,
    headRepository: 'contributor/rentnerproxy',
    headSha,
    number: 42,
    testedSha,
} as const

describe('PR preview identity', () => {
    test('generates only moving and immutable PR tags from validated metadata', () => {
        const identity = createPreviewIdentity('RentnerKev/RentnerProxy', 42, testedSha)

        expect(identity).toEqual({
            image: 'ghcr.io/rentnerkev/rentnerproxy',
            immutableReference: `ghcr.io/rentnerkev/rentnerproxy:pr-42-${testedSha.slice(0, 12)}`,
            immutableTag: `pr-42-${testedSha.slice(0, 12)}`,
            movingReference: 'ghcr.io/rentnerkev/rentnerproxy:pr-42',
            movingTag: 'pr-42',
            pullRequestNumber: 42,
            repository: 'rentnerkev/rentnerproxy',
            shortTestedSha: testedSha.slice(0, 12),
            testedSha,
        })
    })

    test('accepts only the two canonical PR preview tag shapes', () => {
        expect(assertPreviewTag('pr-1')).toBe('pr-1')
        expect(assertPreviewTag('pr-142')).toBe('pr-142')
        expect(assertPreviewTag(`pr-142-${'a'.repeat(12)}`)).toBe(`pr-142-${'a'.repeat(12)}`)
    })

    test('accepts only one canonical pull request number proof line', () => {
        expect(parsePullRequestNumberProof('42\n')).toBe(42)

        for (const value of ['0\n', '01\n', '42', '42\r\n', '42\n43\n', 'x\n']) {
            expect(() => parsePullRequestNumberProof(value)).toThrow()
        }
        expect(() => parsePullRequestNumberProof(`${Number.MAX_SAFE_INTEGER + 1}\n`)).toThrow()
    })

    test('rejects invalid PR numbers and full Git SHAs', () => {
        for (const value of [
            0,
            -1,
            1.5,
            '',
            '01',
            '1;echo bad',
            '../1',
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            expect(() => parsePositiveInteger(value, 'PR number')).toThrow()
        }
        for (const value of [
            '',
            'a'.repeat(39),
            'a'.repeat(41),
            'A'.repeat(40),
            'g'.repeat(40),
            `${'a'.repeat(39)};`,
        ]) {
            expect(() => validateFullSha(value)).toThrow()
        }
    })

    test('rejects release and arbitrary image channels', () => {
        for (const tag of [
            'latest',
            'dev',
            'stable',
            'beta',
            'v1.2.3',
            '1.2.3',
            'pr-0',
            'pr-42-main',
            'pr-42-ABCDEF123456',
            'pr-42-12345678901',
            'pr-42-1234567890123',
            'alpha',
            'rc',
            'pr-42\nlatest',
            'pr-42;dev',
        ]) {
            expect(() => assertPreviewTag(tag)).toThrow()
        }
    })

    test('rejects registry, repository, destination, and third-tag overrides', () => {
        const identity = createPreviewIdentity('RentnerKev/RentnerProxy', 42, testedSha)
        const plan = {
            image: identity.image,
            immutableReference: identity.immutableReference,
            immutableTag: identity.immutableTag,
            movingReference: identity.movingReference,
            movingTag: identity.movingTag,
        }

        expect(assertPreviewPublishPlan(plan, 'RentnerKev/RentnerProxy', 42, testedSha)).toEqual(
            identity,
        )
        for (const override of [
            { image: 'ghcr.io/attacker/rentnerproxy' },
            { image: 'registry.example/rentnerkev/rentnerproxy' },
            { immutableReference: 'ghcr.io/rentnerkev/rentnerproxy:latest' },
            { immutableTag: 'v1.2.3' },
            { movingReference: 'ghcr.io/rentnerkev/rentnerproxy:dev' },
            { movingTag: 'latest' },
            { movingTag: 'pr-42\nlatest' },
        ]) {
            expect(() =>
                assertPreviewPublishPlan(
                    { ...plan, ...override },
                    'RentnerKev/RentnerProxy',
                    42,
                    testedSha,
                ),
            ).toThrow()
        }
        expect(() =>
            assertPreviewPublishPlan(
                { ...plan, thirdTag: 'latest' },
                'RentnerKev/RentnerProxy',
                42,
                testedSha,
            ),
        ).toThrow()

        for (const repository of [
            'ghcr.io/rentnerkev/rentnerproxy',
            'rentnerkev/rentnerproxy:latest',
            'rentnerkev/other/rentnerproxy',
            'rentnerkev/rentnerproxy\nattacker/repository',
        ]) {
            expect(() => createPreviewIdentity(repository, 42, testedSha)).toThrow()
        }
    })

    test('requires source, immutable, and moving tags to share one digest', () => {
        const digest = `sha256:${'a'.repeat(64)}`
        const otherDigest = `sha256:${'b'.repeat(64)}`

        expect(assertMatchingPreviewDigests(digest, digest)).toBe(digest)
        expect(assertMatchingPreviewDigests(digest, digest, digest)).toBe(digest)
        expect(() => assertMatchingPreviewDigests(digest, otherDigest)).toThrow()
        expect(() => assertMatchingPreviewDigests(digest, digest, otherDigest)).toThrow()
        expect(() => assertMatchingPreviewDigests('bad', digest, digest)).toThrow()
    })

    test('accepts only exact base-repository GitHub Actions job provenance', () => {
        const detailsUrl =
            'https://github.com/RentnerKev/RentnerProxy/actions/runs/123456/job/789012'

        expect(actionsRunIdFromDetailsUrl(detailsUrl, 'RentnerKev/RentnerProxy')).toBe(123_456)
        expect(normalizeWorkflowPath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
        expect(normalizeWorkflowPath('.github/workflows/ci.yml@refs/pull/42/merge')).toBe(
            '.github/workflows/ci.yml',
        )
        expect(() => actionsRunIdFromDetailsUrl(detailsUrl, 'other/repository')).toThrow()
        expect(() =>
            actionsRunIdFromDetailsUrl(
                'https://evil.example/RentnerKev/RentnerProxy/actions/runs/123456/job/789012',
                'RentnerKev/RentnerProxy',
            ),
        ).toThrow()
        expect(() => normalizeWorkflowPath('.github/workflows/../ci.yml')).toThrow()
        expect(() => normalizeWorkflowPath('.github/workflows/ci.yml@')).toThrow()
    })

    test('binds populated required-check run metadata and permits the fork API omission', () => {
        const workflowPullRequest = {
            baseRef: expectedPullRequest.baseRef,
            baseRepository: expectedPullRequest.baseRepository,
            baseSha: expectedPullRequest.baseSha,
            headRepository: expectedPullRequest.headRepository,
            headSha: expectedPullRequest.headSha,
            number: expectedPullRequest.number,
        }

        expect(() =>
            assertWorkflowRunPullRequest([workflowPullRequest], expectedPullRequest),
        ).not.toThrow()
        for (const change of [
            { baseRef: 'release' },
            { baseRepository: 'other/repository' },
            { baseSha: '4'.repeat(40) },
            { headRepository: 'other/repository' },
            { headSha: '4'.repeat(40) },
        ]) {
            expect(() =>
                assertWorkflowRunPullRequest(
                    [{ ...workflowPullRequest, ...change }],
                    expectedPullRequest,
                ),
            ).toThrow('Required check workflow run is not bound')
        }
        expect(() =>
            assertWorkflowRunPullRequest(
                [{ ...workflowPullRequest, number: 43 }],
                expectedPullRequest,
            ),
        ).toThrow('Required check workflow run is not bound')
        expect(() => assertWorkflowRunPullRequest([], expectedPullRequest)).not.toThrow()
    })

    test('requires the live PR head to contain the exact current base commit', () => {
        const current = {
            ahead_by: 2,
            behind_by: 0,
            merge_base_commit: { sha: baseSha },
            status: 'ahead',
        }
        expect(() => assertPullRequestBranchUpToDate(current, baseSha)).not.toThrow()
        expect(() =>
            assertPullRequestBranchUpToDate(
                { ...current, ahead_by: 0, status: 'identical' },
                baseSha,
            ),
        ).not.toThrow()

        for (const change of [
            { behind_by: 1, status: 'diverged' },
            { behind_by: 0, status: 'behind' },
            { behind_by: 0, status: 'diverged' },
            { merge_base_commit: { sha: '4'.repeat(40) } },
        ]) {
            expect(() =>
                assertPullRequestBranchUpToDate({ ...current, ...change }, baseSha),
            ).toThrow('Pull request branch is not up to date')
        }
    })

    test('accepts only one exact lowercase merge SHA proof line', () => {
        expect(parseTestedShaProof(`${testedSha}\n`)).toBe(testedSha)
        for (const proof of [
            testedSha,
            `${testedSha}\r\n`,
            `${testedSha}\nextra`,
            `${'A'.repeat(40)}\n`,
        ]) {
            expect(() => parseTestedShaProof(proof)).toThrow()
        }
    })
})

describe('required check evaluation', () => {
    const required = [
        { context: 'Format', integrationId: 15_368 },
        { context: 'CodeQL (Rust)', integrationId: 15_368 },
    ] as const
    const successfulRuns = [
        {
            appId: 15_368,
            conclusion: 'success',
            detailsUrl: 'https://github.com/RentnerKev/RentnerProxy/actions/runs/10/job/1',
            id: 1,
            name: 'Format',
            status: 'completed',
        },
        {
            appId: 15_368,
            conclusion: 'success',
            detailsUrl: 'https://github.com/RentnerKev/RentnerProxy/actions/runs/11/job/2',
            id: 2,
            name: 'CodeQL (Rust)',
            status: 'completed',
        },
    ] as const

    test('accepts only completed successful latest runs from the required app', () => {
        expect(evaluateRequiredChecks(required, successfulRuns)).toEqual({
            failed: [],
            ignored: [],
            missing: [],
            pending: [],
            state: 'success',
        })

        const spoofed = successfulRuns.map((run) => ({ ...run, appId: 999 }))
        expect(evaluateRequiredChecks(required, spoofed).state).toBe('missing')
    })

    test('fails closed for missing, pending, failed, skipped, and stale checks', () => {
        expect(evaluateRequiredChecks(required, successfulRuns.slice(0, 1)).state).toBe('missing')

        for (const status of ['queued', 'in_progress', 'pending', 'requested', 'waiting']) {
            const runs = successfulRuns.map((run) =>
                run.name === 'Format' ? { ...run, conclusion: null, status } : run,
            )
            expect(evaluateRequiredChecks(required, runs).state).toBe('pending')
        }

        for (const conclusion of [
            'failure',
            'cancelled',
            'timed_out',
            'action_required',
            'stale',
            'neutral',
            'skipped',
        ]) {
            const runs = successfulRuns.map((run) =>
                run.name === 'Format' ? { ...run, conclusion } : run,
            )
            expect(evaluateRequiredChecks(required, runs).state).toBe('failed')
        }
    })

    test('uses the newest check run instead of an older success', () => {
        const runs = [
            ...successfulRuns,
            {
                appId: 15_368,
                conclusion: 'failure',
                detailsUrl: 'https://github.com/RentnerKev/RentnerProxy/actions/runs/12/job/100',
                id: 100,
                name: 'Format',
                status: 'completed',
            },
        ]

        expect(evaluateRequiredChecks(required, runs).failed).toEqual(['Format (failure)'])
    })

    test('excludes preview checks from their own gate', () => {
        const result = evaluateRequiredChecks(
            [...required, { context: 'PR Preview / Build image', integrationId: 15_368 }],
            successfulRuns,
        )

        expect(result.state).toBe('success')
        expect(result.ignored).toEqual(['PR Preview / Build image'])
    })
})

describe('pull request freshness', () => {
    test('accepts an open non-draft PR at the exact tested merge commit', () => {
        expect(evaluatePullRequest(currentPullRequest(), expectedPullRequest).state).toBe('success')
    })

    test('rejects drafts, closed PRs, missing forks, and stale source state', () => {
        const changes = [
            { draft: true },
            { state: 'closed' },
            { headRepository: null },
            { headSha: '4'.repeat(40) },
            { baseSha: '4'.repeat(40) },
            { mergeCommitSha: '4'.repeat(40) },
            { mergeable: false },
        ] as const

        for (const change of changes) {
            const result = evaluatePullRequest(
                { ...currentPullRequest(), ...change },
                expectedPullRequest,
            )
            expect(result.state).toBe('failed')
        }
    })

    test('treats pending GitHub mergeability as non-publishable', () => {
        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), mergeCommitSha: null, mergeable: null },
                expectedPullRequest,
            ).state,
        ).toBe('pending')
    })
})

describe('artifact metadata and marker comment', () => {
    test('validates the complete metadata schema', () => {
        const metadata: PreviewArtifactMetadata = {
            artifactName: 'pr-preview-image',
            baseSha,
            createdAt: '2026-09-02T12:00:00.000Z',
            headRepository: 'contributor/rentnerproxy',
            headSha,
            ociSha256: '4'.repeat(64),
            platform: 'linux/amd64',
            pullRequestNumber: 42,
            repository: 'rentnerkev/rentnerproxy',
            runAttempt: 1,
            runId: 123,
            schemaVersion: 1,
            testedSha,
            triggerRunId: 122,
        }

        expect(parsePreviewArtifactMetadata(metadata)).toEqual(metadata)
        expect(() => parsePreviewArtifactMetadata({ ...metadata, unexpected: true })).toThrow()
        for (const field of ['registry', 'image', 'destination', 'tag']) {
            expect(() =>
                parsePreviewArtifactMetadata({ ...metadata, [field]: 'attacker' }),
            ).toThrow()
        }
        expect(() =>
            parsePreviewArtifactMetadata({ ...metadata, testedSha: headSha }),
        ).not.toThrow()
        expect(() => parsePreviewArtifactMetadata({ ...metadata, testedSha: 'bad' })).toThrow()
    })

    test('updates only the newest Actions-bot marker comment', () => {
        const comments = [
            {
                body: PREVIEW_COMMENT_MARKER,
                id: 1,
                userLogin: 'contributor',
                userType: 'User',
            },
            {
                body: `prefix ${PREVIEW_COMMENT_MARKER}`,
                id: 2,
                userLogin: 'github-actions[bot]',
                userType: 'Bot',
            },
            {
                body: `${PREVIEW_COMMENT_MARKER}\nold`,
                id: 3,
                userLogin: 'github-actions[bot]',
                userType: 'Bot',
            },
            {
                body: `${PREVIEW_COMMENT_MARKER}\nnew`,
                id: 4,
                userLogin: 'github-actions[bot]',
                userType: 'Bot',
            },
        ]

        expect(selectPreviewComment(comments)?.id).toBe(4)
        expect(selectPreviewComment(comments.slice(0, 2))).toBeNull()
    })

    test('renders reproducible commands and mandatory safety warnings', () => {
        const identity = createPreviewIdentity('RentnerKev/RentnerProxy', 42, testedSha)
        const body = renderPreviewComment(identity, headSha, `sha256:${'5'.repeat(64)}`)

        expect(body).toStartWith(PREVIEW_COMMENT_MARKER)
        expect(body).toContain(identity.movingReference)
        expect(body).toContain(identity.immutableReference)
        expect(body).toContain('Back up PostgreSQL')
        expect(body).toContain('certificates, private keys, ACME state')
        expect(body).toContain('Do not use this PR preview image with production data')
        expect(body).toContain('docker compose --project-name rentnerproxy-pr-42')
        expect(body).toContain('not a production release')
    })
})
