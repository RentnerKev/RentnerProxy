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
    parsePullRequestLifecycle,
    parsePositiveInteger,
    parsePullRequestNumberProof,
    parsePreviewArtifactMetadata,
    parsePreviewComment,
    parseTestedShaProof,
    renderPreviewComment,
    selectPreviewComment,
    validateFullSha,
} from '../../../../../.github/scripts/deploy/pr-preview.ts'
import type {
    PreviewArtifactMetadata,
    WorkflowRun,
    PullRequestSnapshot,
} from '../../../../../.github/scripts/deploy/Types/pr-preview.types.ts'
import { GitHubApi } from '../../../../../.github/scripts/deploy/pr-preview/github-api.ts'
import {
    resolveWorkflowPullRequest,
    previewBuildHasArtifact,
    resolvePreviewSource,
} from '../../../../../.github/scripts/deploy/pr-preview/workflow.ts'
import {
    previewGateLifecycle,
    verifyGate,
} from '../../../../../.github/scripts/deploy/pr-preview/gate.ts'
import { previewLifecycle } from '../../../../../.github/scripts/deploy/pr-preview/checks.ts'

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

function rawPullRequest(changes: Partial<PullRequestSnapshot> = {}) {
    const value = { ...currentPullRequest(), ...changes }
    return {
        number: value.number,
        state: value.state,
        draft: value.draft,
        base: { ref: value.baseRef, sha: value.baseSha, repo: { full_name: value.baseRepository } },
        head: {
            sha: value.headSha,
            repo: value.headRepository ? { full_name: value.headRepository } : null,
        },
        mergeable: value.mergeable,
        merge_commit_sha: value.mergeCommitSha,
    }
}

function fixtureApi(respond: (path: string) => unknown) {
    const api = new GitHubApi(expectedPullRequest.baseRepository, 'synthetic-fixture-token')
    api.request = async (path) => respond(path)
    return api
}

const triggerRun: WorkflowRun = {
    id: 101,
    workflowId: 202,
    runAttempt: 3,
    name: 'PR Preview Source',
    path: '.github/workflows/pr-preview-source.yml',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    repository: expectedPullRequest.baseRepository,
    headRepository: expectedPullRequest.headRepository,
    headSha,
    pullRequests: [{ ...expectedPullRequest }],
}

describe('canonical tested source proof', () => {
    const proof = { pullRequestNumber: 42, testedSha }
    const metadata: PreviewArtifactMetadata = {
        artifactName: 'pr-preview-image',
        schemaVersion: 1,
        repository: expectedPullRequest.baseRepository,
        baseSha,
        headRepository: expectedPullRequest.headRepository,
        headSha,
        testedSha,
        pullRequestNumber: 42,
        triggerRunId: triggerRun.id,
        runId: 303,
        runAttempt: 1,
        createdAt: '2026-10-29T00:00:00Z',
        ociSha256: 'a'.repeat(64),
        platform: 'linux/amd64',
    }

    function sourceApi(
        options: {
            snapshot?: Partial<PullRequestSnapshot>
            commit?: unknown
            changedWorkflow?: boolean
            mainReference?: unknown
            comparison?: unknown
            onRequest?: (path: string) => void
        } = {},
    ) {
        return fixtureApi((path) => {
            options.onRequest?.(path)
            if (path.endsWith('/git/ref/heads/main'))
                return options.mainReference === undefined
                    ? { ref: 'refs/heads/main', object: { type: 'commit', sha: baseSha } }
                    : options.mainReference
            if (path.includes('/git/commits/'))
                return (
                    options.commit ?? {
                        sha: testedSha,
                        parents: [{ sha: baseSha }, { sha: headSha }],
                    }
                )
            if (path.includes('/contents/'))
                return {
                    type: 'file',
                    sha:
                        options.changedWorkflow && path.endsWith(testedSha)
                            ? 'b'.repeat(40)
                            : 'a'.repeat(40),
                }
            if (path.includes('/compare/'))
                return (
                    options.comparison ?? {
                        status: 'ahead',
                        behind_by: 0,
                        merge_base_commit: { sha: baseSha },
                    }
                )
            if (path.includes('/commits/')) return [rawPullRequest(options.snapshot)]
            if (path.endsWith('/pulls/42')) return rawPullRequest(options.snapshot)
            throw new Error('Unexpected source proof fixture request: ' + path)
        })
    }

    test('uses the historical tested merge base for a fork run without PR metadata', async () => {
        const { pullRequest, expected } = await resolvePreviewSource(
            sourceApi({
                snapshot: { baseSha: '4'.repeat(40), mergeCommitSha: '5'.repeat(40) },
            }),
            { ...triggerRun, pullRequests: [] },
            proof,
        )
        expect(expected).toEqual(expectedPullRequest)
        expect(previewLifecycle(pullRequest, expected)).toBe('stale')
    })

    test('uses authoritative main rather than the stale PR snapshot base for source ancestry', async () => {
        const main = 'e6f6569d50136a9eac0435fadda525fc69d09ca4'
        const actualProof = { ...proof, testedSha: 'e06e07c77d825c101833f4d943d1aa55eb590f9b' }
        const current = {
            ...currentPullRequest(),
            headSha: '5b91d517f5e14da6b089292da419fbc768a1c2cc',
            baseSha: 'c1da7ff827617ba5fb423dcd05a1184415ac2afc',
        }
        const run = {
            ...triggerRun,
            headSha: current.headSha,
            pullRequests: [
                {
                    ...triggerRun.pullRequests[0]!,
                    headSha: current.headSha,
                    baseSha: current.baseSha,
                },
            ],
        }
        const requests: string[] = []
        const resolved = await resolvePreviewSource(
            sourceApi({
                snapshot: current,
                commit: {
                    sha: actualProof.testedSha,
                    parents: [{ sha: main }, { sha: current.headSha }],
                },
                mainReference: { ref: 'refs/heads/main', object: { type: 'commit', sha: main } },
                onRequest: (path) => {
                    requests.push(path)
                },
            }),
            run,
            actualProof,
            {
                ...metadata,
                headSha: current.headSha,
                baseSha: main,
                testedSha: actualProof.testedSha,
            },
        )
        expect(resolved.expected.baseSha).toBe(main)
        expect(requests).toContain('/repos/rentnerkev/rentnerproxy/git/ref/heads/main')
        expect(requests.some((path) => path.includes('/compare/'))).toBe(false)
        expect(previewLifecycle(resolved.pullRequest, resolved.expected)).toBe('stale')
    })

    test('requires the canonical base to belong to authoritative main history', async () => {
        const main = 'e6f6569d50136a9eac0435fadda525fc69d09ca4'
        const requests: string[] = []
        const options = {
            mainReference: { ref: 'refs/heads/main', object: { type: 'commit', sha: main } },
            onRequest: (path: string) => {
                requests.push(path)
            },
        }
        expect(
            (await resolvePreviewSource(sourceApi(options), triggerRun, proof)).expected.baseSha,
        ).toBe(baseSha)
        expect(requests).toContain(`/repos/rentnerkev/rentnerproxy/compare/${baseSha}...${main}`)
        await expect(
            resolvePreviewSource(
                sourceApi({
                    ...options,
                    comparison: {
                        status: 'diverged',
                        behind_by: 1,
                        merge_base_commit: { sha: '4'.repeat(40) },
                    },
                }),
                triggerRun,
                proof,
            ),
        ).rejects.toThrow('not up to date')
    })

    test('rejects malformed or incorrectly identified authoritative main references', async () => {
        await Promise.all(
            [
                null,
                {},
                { ref: 'refs/heads/feature', object: { type: 'commit', sha: baseSha } },
                { ref: 'refs/heads/main', object: { type: 'tag', sha: baseSha } },
                { ref: 'refs/heads/main', object: { type: 'commit', sha: 'invalid' } },
            ].map(async (mainReference) => {
                await expect(
                    resolvePreviewSource(sourceApi({ mainReference }), triggerRun, proof),
                ).rejects.toThrow()
            }),
        )
    })

    test('accepts live source-run PR links while retaining the immutable old head and merge proof', async () => {
        const oldHead = 'aedaa80f0b0b81e16550236a3ab29322fcbca90f'
        const current = {
            ...currentPullRequest(),
            headSha: '977f2eb4d7302baa40cf1fd33cd97011d24bcee3',
            baseSha: 'c1da7ff827617ba5fb423dcd05a1184415ac2afc',
            mergeCommitSha: '6'.repeat(40),
        }
        const run = {
            ...triggerRun,
            headSha: oldHead,
            pullRequests: [
                {
                    number: current.number,
                    baseRepository: current.baseRepository,
                    baseRef: current.baseRef,
                    baseSha: current.baseSha,
                    headRepository: current.headRepository,
                    headSha: current.headSha,
                },
            ],
        }
        const options = {
            snapshot: current,
            commit: { sha: testedSha, parents: [{ sha: baseSha }, { sha: oldHead }] },
        }
        const canonicalMetadata = { ...metadata, headSha: oldHead }
        const resolved = await resolvePreviewSource(
            sourceApi(options),
            run,
            proof,
            canonicalMetadata,
        )
        expect(resolved.expected).toEqual({ ...expectedPullRequest, headSha: oldHead })
        expect(previewLifecycle(resolved.pullRequest, resolved.expected)).toBe('stale')
        await expect(
            resolvePreviewSource(sourceApi(options), run, proof, {
                ...canonicalMetadata,
                headSha: current.headSha,
                baseSha: current.baseSha,
            }),
        ).rejects.toThrow('artifact source does not match')
        await Promise.all(
            [
                { headSha: '7'.repeat(40) },
                { baseSha: '7'.repeat(40) },
                { headSha: oldHead, baseSha: current.baseSha },
                { headSha: current.headSha, baseSha },
            ].map(async (change) => {
                await expect(
                    resolvePreviewSource(
                        sourceApi(options),
                        {
                            ...run,
                            pullRequests: [{ ...run.pullRequests[0]!, ...change }],
                        },
                        proof,
                        canonicalMetadata,
                    ),
                ).rejects.toThrow()
            }),
        )
    })

    test('rejects well-formed altered artifact identities before a closed or superseded skip', async () => {
        await Promise.all(
            (['open', 'closed'] as const).map(async (state) => {
                const options = { snapshot: { state, headSha: '4'.repeat(40) } }
                const verified = await resolvePreviewSource(
                    sourceApi(options),
                    triggerRun,
                    proof,
                    metadata,
                )
                expect(previewLifecycle(verified.pullRequest, verified.expected)).not.toBe('open')
                await Promise.all(
                    [
                        { baseSha: '5'.repeat(40) },
                        { headSha: '5'.repeat(40) },
                        { testedSha: '5'.repeat(40) },
                        { headRepository: 'other/repository' },
                        { repository: 'other/repository' },
                        { pullRequestNumber: 43 },
                        { triggerRunId: 102 },
                    ].map(async (change) => {
                        await expect(
                            resolvePreviewSource(sourceApi(options), triggerRun, proof, {
                                ...metadata,
                                ...change,
                            }),
                        ).rejects.toThrow('artifact source does not match')
                    }),
                )
            }),
        )
    })

    test('rejects mismatched merge SHA, parent identities, cardinality and source run base', async () => {
        await Promise.all(
            [
                { sha: '4'.repeat(40), parents: [{ sha: baseSha }, { sha: headSha }] },
                { sha: testedSha, parents: [] },
                { sha: testedSha, parents: [{ sha: headSha }] },
                {
                    sha: testedSha,
                    parents: [{ sha: baseSha }, { sha: headSha }, { sha: '4'.repeat(40) }],
                },
                { sha: testedSha, parents: [{ sha: headSha }, { sha: baseSha }] },
                { sha: testedSha, parents: [{ sha: baseSha }, { sha: '4'.repeat(40) }] },
                { sha: testedSha, parents: [{ sha: headSha }, { sha: headSha }] },
                { sha: testedSha, parents: [{ sha: '4'.repeat(40) }, { sha: headSha }] },
            ].map(async (commit) => {
                await expect(
                    resolvePreviewSource(
                        sourceApi({ snapshot: { state: 'closed' }, commit }),
                        triggerRun,
                        proof,
                    ),
                ).rejects.toThrow()
            }),
        )
    })

    test('never skips the unchanged producer workflow check for obsolete PRs', async () => {
        await expect(
            resolvePreviewSource(
                sourceApi({
                    snapshot: { state: 'closed' },
                    changedWorkflow: true,
                }),
                triggerRun,
                proof,
            ),
        ).rejects.toThrow('Required workflow was changed')
    })
})

describe('obsolete preview lifecycle', () => {
    test('resolves closed and superseded PRs only with the original source run association', async () => {
        await Promise.all(
            (['open', 'closed'] as const).map(async (state) => {
                const api = fixtureApi(() => rawPullRequest({ state, headSha: '4'.repeat(40) }))
                const resolved = await resolveWorkflowPullRequest(api, triggerRun, 42)
                expect(previewLifecycle(resolved, expectedPullRequest)).toBe(
                    state === 'closed' ? 'closed' : 'stale',
                )
                await expect(
                    resolveWorkflowPullRequest(
                        api,
                        {
                            ...triggerRun,
                            pullRequests: [{ ...triggerRun.pullRequests[0]!, number: 43 }],
                        },
                        42,
                    ),
                ).rejects.toThrow('proof does not match')
            }),
        )
    })

    test('requires a historical commit association when fork run PR metadata is absent', async () => {
        const historical = rawPullRequest({ headSha: '4'.repeat(40) })
        const run = { ...triggerRun, pullRequests: [] }
        const api = fixtureApi((path) => (path.includes('/commits/') ? [historical] : historical))
        expect((await resolveWorkflowPullRequest(api, run, 42)).headSha).toBe('4'.repeat(40))
        const unrelated = fixtureApi((path) =>
            path.includes('/commits/') ? [rawPullRequest({ number: 43 })] : historical,
        )
        await expect(resolveWorkflowPullRequest(unrelated, run, 42)).rejects.toThrow(
            'proof does not match',
        )
        const wrongRepository = fixtureApi(() =>
            rawPullRequest({ state: 'closed', headRepository: 'unrelated/repository' }),
        )
        await expect(resolveWorkflowPullRequest(wrongRepository, run, 42)).rejects.toThrow(
            'Could not resolve',
        )
    })

    test('skips obsolete verification but keeps publication revalidation strict', async () => {
        await Promise.all(
            [
                { state: 'closed' as const },
                { headSha: '4'.repeat(40) },
                { baseSha: '4'.repeat(40) },
            ].map(async (change) => {
                const api = fixtureApi((path) => {
                    if (path.endsWith('/git/ref/heads/main'))
                        return { ref: 'refs/heads/main', object: { type: 'commit', sha: baseSha } }
                    expect(path).toBe('/repos/rentnerkev/rentnerproxy/pulls/42')
                    return rawPullRequest(change)
                })
                expect(
                    previewLifecycle(
                        await verifyGate(api, expectedPullRequest, true),
                        expectedPullRequest,
                    ),
                ).not.toBe('open')
                await expect(verifyGate(api, expectedPullRequest, false)).rejects.toThrow(
                    'refusing to revalidate publication',
                )
            }),
        )
    })

    test('current failed checks still fail the gate', async () => {
        const api = fixtureApi((path) => {
            if (path.endsWith('/git/ref/heads/main'))
                return { ref: 'refs/heads/main', object: { type: 'commit', sha: baseSha } }
            if (path.endsWith('/pulls/42')) return rawPullRequest()
            if (path.includes('/compare/'))
                return {
                    status: 'ahead',
                    ahead_by: 1,
                    behind_by: 0,
                    base_commit: { sha: baseSha },
                    merge_base_commit: { sha: baseSha },
                }
            if (path.includes('/rules/'))
                return [
                    {
                        type: 'required_status_checks',
                        parameters: {
                            strict_required_status_checks_policy: true,
                            required_status_checks: [{ context: 'CI', integration_id: 123 }],
                        },
                    },
                ]
            if (path.includes('/check-runs?'))
                return {
                    check_runs: [
                        {
                            id: 1,
                            name: 'CI',
                            status: 'completed',
                            conclusion: 'failure',
                            app: { id: 123 },
                            details_url:
                                'https://github.com/rentnerkev/rentnerproxy/actions/runs/1/job/2',
                        },
                    ],
                }
            throw new Error('Unexpected fixture request')
        })
        await expect(verifyGate(api, expectedPullRequest, true)).rejects.toThrow(
            'Required check failed: CI',
        )
        await expect(previewGateLifecycle(api, expectedPullRequest)).rejects.toThrow(
            'Required check failed: CI',
        )
    })
})

describe('preview branch freshness lifecycle', () => {
    function comparisonApi(comparison: unknown) {
        return fixtureApi((path) => {
            if (path.endsWith('/git/ref/heads/main'))
                return { ref: 'refs/heads/main', object: { type: 'commit', sha: baseSha } }
            if (path.endsWith('/pulls/42')) return rawPullRequest()
            if (path.includes('/compare/')) {
                if (comparison instanceof Error) throw comparison
                return comparison
            }
            throw new Error('Unexpected branch freshness fixture request: ' + path)
        })
    }

    const behind = {
        status: 'behind',
        ahead_by: 0,
        behind_by: 2,
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: headSha },
    }
    const diverged = {
        status: 'diverged',
        ahead_by: 1,
        behind_by: 2,
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: '4'.repeat(40) },
    }

    test('rejects advanced authoritative main even when cached PR base and merge proof still match', async () => {
        const cachedBase = 'c1da7ff827617ba5fb423dcd05a1184415ac2afc'
        const main = 'e6f6569d50136a9eac0435fadda525fc69d09ca4'
        const expected = { ...expectedPullRequest, baseSha: cachedBase }
        await Promise.all(
            [testedSha, '4'.repeat(40)].map(async (mergeCommitSha) => {
                const api = fixtureApi((path) => {
                    if (path.endsWith('/pulls/42'))
                        return rawPullRequest({ baseSha: cachedBase, mergeCommitSha })
                    if (path.endsWith('/git/ref/heads/main'))
                        return { ref: 'refs/heads/main', object: { type: 'commit', sha: main } }
                    throw new Error('Unexpected stale main fixture request: ' + path)
                })
                expect(await previewGateLifecycle(api, expected)).toBe('stale')
                await expect(verifyGate(api, expected, false)).rejects.toThrow(
                    'Main advanced beyond the tested base',
                )
            }),
        )
        const unrelated = fixtureApi(() =>
            rawPullRequest({ baseSha: cachedBase, headRepository: 'unrelated/repository' }),
        )
        await expect(previewGateLifecycle(unrelated, expected)).rejects.toThrow(
            'identity does not match',
        )
    })

    test('rechecks authoritative main after successful required checks before returning', async () => {
        function finishingApi() {
            let references = 0
            return fixtureApi((path) => {
                if (path.endsWith('/pulls/42')) return rawPullRequest()
                if (path.endsWith('/git/ref/heads/main'))
                    return {
                        ref: 'refs/heads/main',
                        object: {
                            type: 'commit',
                            sha: ++references >= 3 ? '4'.repeat(40) : baseSha,
                        },
                    }
                if (path.includes('/compare/'))
                    return {
                        status: 'ahead',
                        ahead_by: 1,
                        behind_by: 0,
                        base_commit: { sha: baseSha },
                        merge_base_commit: { sha: baseSha },
                    }
                if (path.includes('/rules/'))
                    return [
                        {
                            type: 'required_status_checks',
                            parameters: {
                                strict_required_status_checks_policy: true,
                                required_status_checks: [{ context: 'CI', integration_id: 123 }],
                            },
                        },
                    ]
                if (path.includes('/check-runs?'))
                    return {
                        check_runs: [
                            {
                                id: 12,
                                name: 'CI',
                                status: 'completed',
                                conclusion: 'success',
                                app: { id: 123 },
                                details_url:
                                    'https://github.com/rentnerkev/rentnerproxy/actions/runs/11/job/12',
                            },
                        ],
                    }
                if (path.endsWith('/actions/runs/11'))
                    return {
                        id: 11,
                        workflow_id: 22,
                        run_attempt: 1,
                        event: 'pull_request',
                        name: 'CI',
                        path: '.github/workflows/ci.yml',
                        status: 'completed',
                        conclusion: 'success',
                        head_sha: headSha,
                        repository: { full_name: expectedPullRequest.baseRepository },
                        head_repository: { full_name: expectedPullRequest.headRepository },
                        pull_requests: [],
                    }
                if (path.endsWith('/actions/workflows/22'))
                    return { id: 22, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }
                if (path.includes('/contents/')) return { type: 'file', sha: 'a'.repeat(40) }
                throw new Error('Unexpected final-main fixture request: ' + path)
            })
        }
        expect(await previewGateLifecycle(finishingApi(), expectedPullRequest)).toBe('stale')
        await expect(verifyGate(finishingApi(), expectedPullRequest, false)).rejects.toThrow(
            'Main advanced beyond the tested base',
        )
    })

    test('never skips malformed main references or reference API failures', async () => {
        await Promise.all(
            [
                null,
                {},
                { ref: 'refs/heads/feature', object: { type: 'commit', sha: baseSha } },
                { ref: 'refs/heads/main', object: { type: 'blob', sha: baseSha } },
                { ref: 'refs/heads/main', object: { type: 'commit', sha: 'bad' } },
                new Error('reference unavailable'),
            ].map(async (reference) => {
                const api = fixtureApi((path) => {
                    if (path.endsWith('/pulls/42')) return rawPullRequest()
                    if (path.endsWith('/git/ref/heads/main')) {
                        if (reference instanceof Error) throw reference
                        return reference
                    }
                    throw new Error('Unexpected malformed-ref fixture request')
                })
                await expect(previewGateLifecycle(api, expectedPullRequest)).rejects.toThrow()
            }),
        )
    })

    test('marks verified behind and diverged branches stale only for preview gating', async () => {
        await Promise.all(
            [behind, diverged].map(async (comparison) => {
                const api = comparisonApi(comparison)
                expect(await previewGateLifecycle(api, expectedPullRequest)).toBe('stale')
                await expect(verifyGate(api, expectedPullRequest, false)).rejects.toThrow(
                    'branch is behind its base',
                )
                await expect(verifyGate(api, expectedPullRequest, true)).rejects.toThrow(
                    'branch is behind its base',
                )
                expect(() => assertPullRequestBranchUpToDate(comparison, baseSha)).toThrow(
                    'not up to date',
                )
            }),
        )
    })

    test('never turns malformed, inconsistent or unrelated comparisons into a skip', async () => {
        await Promise.all(
            [
                null,
                {},
                { ...behind, ahead_by: undefined },
                { ...behind, behind_by: undefined },
                { ...behind, ahead_by: -1 },
                { ...behind, behind_by: -1 },
                { ...behind, ahead_by: 1 },
                { ...behind, behind_by: 0 },
                { ...behind, status: 'unknown' },
                { ...behind, status: 'ahead' },
                { ...behind, base_commit: { sha: '4'.repeat(40) } },
                { ...behind, base_commit: { sha: 'invalid' } },
                { ...behind, merge_base_commit: { sha: baseSha } },
                { ...behind, merge_base_commit: { sha: '4'.repeat(40) } },
                { ...diverged, ahead_by: 0 },
                { ...diverged, merge_base_commit: { sha: headSha } },
                { ...diverged, merge_base_commit: { sha: baseSha } },
                {
                    status: 'identical',
                    ahead_by: 0,
                    behind_by: 0,
                    base_commit: { sha: baseSha },
                    merge_base_commit: { sha: baseSha },
                },
            ].map(async (comparison) => {
                await expect(
                    previewGateLifecycle(comparisonApi(comparison), expectedPullRequest),
                ).rejects.toThrow()
            }),
        )
    })

    test('propagates API errors even if their text resembles a branch-behind result', async () => {
        const failure = new Error(
            'Pull request branch is behind its base; skipping preview publication.',
        )
        await expect(
            previewGateLifecycle(comparisonApi(failure), expectedPullRequest),
        ).rejects.toBe(failure)
    })
})

function skippedBuildFixture(
    options: {
        jobs?: unknown[]
        artifacts?: unknown[]
        totalCount?: number
        changedAttempt?: boolean
        runChanges?: Record<string, unknown>
    } = {},
) {
    let reads = 0
    const jobs = options.jobs ?? [
        {
            id: 1,
            run_id: 101,
            head_sha: headSha,
            name: 'PR Preview / Verify checks',
            status: 'completed',
            conclusion: 'success',
        },
        {
            id: 2,
            run_id: 101,
            head_sha: headSha,
            name: 'PR Preview / Build image',
            status: 'completed',
            conclusion: 'skipped',
        },
    ]
    return fixtureApi((path) => {
        if (path.endsWith('/actions/runs/101'))
            return {
                id: 101,
                workflow_id: 202,
                run_attempt: options.changedAttempt && reads++ > 0 ? 4 : 3,
                name: 'PR Preview Build',
                path: '.github/workflows/pr-preview-build.yml',
                event: 'workflow_run',
                status: 'completed',
                conclusion: 'success',
                repository: { full_name: expectedPullRequest.baseRepository },
                head_repository: { full_name: expectedPullRequest.baseRepository },
                head_sha: headSha,
                pull_requests: [],
                ...options.runChanges,
            }
        if (path.endsWith('/actions/workflows/202'))
            return {
                id: 202,
                name: 'PR Preview Build',
                path: '.github/workflows/pr-preview-build.yml',
                state: 'active',
            }
        if (path.includes('/artifacts?')) return { artifacts: options.artifacts ?? [] }
        if (path.includes('/attempts/3/jobs?'))
            return { total_count: options.totalCount ?? jobs.length, jobs }
        throw new Error('Unexpected fixture request: ' + path)
    })
}

describe('skipped build publisher preflight', () => {
    test('accepts no artifact only for the verified completed attempt with verify success and build skipped', async () => {
        expect(await previewBuildHasArtifact(skippedBuildFixture(), 101)).toBe(false)
        await expect(
            previewBuildHasArtifact(skippedBuildFixture({ changedAttempt: true }), 101),
        ).rejects.toThrow('attempt changed')
        await Promise.all(
            [
                { status: 'in_progress' },
                { conclusion: 'failure' },
                { id: 102 },
                { repository: { full_name: 'other/repository' } },
                { head_repository: null },
                { head_repository: { full_name: 'other/repository' } },
            ].map(async (change) => {
                await expect(
                    previewBuildHasArtifact(skippedBuildFixture({ runChanges: change }), 101),
                ).rejects.toThrow()
            }),
        )
    })

    test('rejects missing, duplicate, failed, cancelled, foreign and unknown jobs or a build that really ran', async () => {
        const verify = {
            id: 1,
            run_id: 101,
            head_sha: headSha,
            name: 'PR Preview / Verify checks',
            status: 'completed',
            conclusion: 'success',
        }
        const build = { ...verify, id: 2, name: 'PR Preview / Build image', conclusion: 'skipped' }
        await Promise.all(
            [
                [],
                [verify],
                [verify, verify],
                [build, build],
                [verify, { ...build, conclusion: 'success' }],
                [verify, { ...build, conclusion: 'failure' }],
                [verify, { ...build, conclusion: 'cancelled' }],
                [{ ...verify, conclusion: 'failure' }, build],
                [verify, { ...build, run_id: 102 }],
                [verify, { ...build, head_sha: '4'.repeat(40) }],
                [verify, { ...build, name: 'Unknown job' }],
                [verify, { ...build, status: 'queued' }],
            ].map(async (jobs) => {
                await expect(
                    previewBuildHasArtifact(skippedBuildFixture({ jobs }), 101),
                ).rejects.toThrow()
            }),
        )
    })

    test('still validates any supplied artifact envelope instead of treating tampering as a skip', async () => {
        const artifact = {
            name: 'pr-preview-image',
            digest: 'sha256:' + 'a'.repeat(64),
            expired: false,
            size_in_bytes: 123,
            workflow_run: { id: 101 },
        }
        expect(
            await previewBuildHasArtifact(skippedBuildFixture({ artifacts: [artifact] }), 101),
        ).toBe(true)
        await Promise.all(
            [
                { name: 'wrong' },
                { expired: true },
                { size_in_bytes: 0 },
                { digest: 'invalid' },
                { workflow_run: { id: 102 } },
            ].map(async (change) => {
                await expect(
                    previewBuildHasArtifact(
                        skippedBuildFixture({ artifacts: [{ ...artifact, ...change }] }),
                        101,
                    ),
                ).rejects.toThrow()
            }),
        )
        await expect(
            previewBuildHasArtifact(skippedBuildFixture({ artifacts: [artifact, artifact] }), 101),
        ).rejects.toThrow()
    })
})

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

    test('classifies a closed PR for a harmless publication skip', () => {
        expect(
            evaluatePullRequest({ ...currentPullRequest(), state: 'closed' }, expectedPullRequest),
        ).toEqual({
            reason: 'Pull request is closed; skipping preview publication.',
            state: 'closed',
        })
        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), state: 'closed', baseSha: '4'.repeat(40) },
                expectedPullRequest,
            ).state,
        ).toBe('closed')
        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), state: 'closed', headSha: '4'.repeat(40) },
                expectedPullRequest,
            ).state,
        ).toBe('closed')
    })

    test('classifies superseded source state without authorizing publication', () => {
        for (const change of [{ headSha: '4'.repeat(40) }, { baseSha: '4'.repeat(40) }]) {
            const snapshot = { ...currentPullRequest(), ...change }
            expect(evaluatePullRequest(snapshot, expectedPullRequest).state).toBe('stale')
            expect(previewLifecycle(snapshot, expectedPullRequest)).toBe('stale')
        }
    })

    test('rejects drafts, invalid lifecycle values, and mismatched tested commit identities', () => {
        const changes = [
            { draft: true },
            { headRepository: null },
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

        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), state: 'closed', headRepository: 'other/repository' },
                expectedPullRequest,
            ).state,
        ).toBe('failed')
        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), state: 'closed', baseRef: 'release' },
                expectedPullRequest,
            ).state,
        ).toBe('failed')
        expect(
            evaluatePullRequest(
                { ...currentPullRequest(), state: 'merged' as never },
                expectedPullRequest,
            ).state,
        ).toBe('failed')
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

describe('pull request lifecycle parsing', () => {
    test('accepts only the two GitHub pull request lifecycle states', () => {
        expect(parsePullRequestLifecycle('open')).toBe('open')
        expect(parsePullRequestLifecycle('closed')).toBe('closed')
        for (const value of ['', 'merged', 'reopened', null, 42, false]) {
            expect(() => parsePullRequestLifecycle(value)).toThrow('Pull request state is invalid.')
        }
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

    test('parses multiline API comments and selects only the latest trusted preview', () => {
        const identity = createPreviewIdentity('RentnerKev/RentnerProxy', 42, testedSha)
        const body = renderPreviewComment(identity, headSha, `sha256:${'5'.repeat(64)}`)
        const comments = [
            {
                body: 'Review summary\n\nNo changes requested.',
                id: 1,
                user: { login: 'coderabbitai[bot]', type: 'Bot' },
            },
            { body, id: 2, user: { login: 'github-actions[bot]', type: 'Bot' } },
            {
                body: body.replaceAll('\n', '\r\n'),
                id: 3,
                user: { login: 'github-actions[bot]', type: 'Bot' },
            },
            { body, id: 4, user: { login: 'contributor', type: 'User' } },
            { body, id: 5, user: { login: 'other[bot]', type: 'Bot' } },
            { body, id: 6, user: { login: 'github-actions[bot]', type: 'User' } },
            { body: `prefix ${body}`, id: 7, user: { login: 'github-actions[bot]', type: 'Bot' } },
        ].map(parsePreviewComment)

        expect(selectPreviewComment(comments)?.id).toBe(3)
        expect(comments[1]?.body).toBe(body)
        expect(selectPreviewComment(comments.slice(0, 1))).toBeNull()
    })

    test('accepts empty or hidden comment bodies while rejecting malformed API metadata', () => {
        const comment = { body: '', id: 1, user: { login: 'github-actions[bot]', type: 'Bot' } }
        for (const body of ['', null]) {
            expect(selectPreviewComment([parsePreviewComment({ ...comment, body })])).toBeNull()
        }
        for (const body of [undefined, 42, false, {}, [], 'invalid\0body']) {
            expect(() => parsePreviewComment({ ...comment, body })).toThrow(
                'Pull request comment body is invalid.',
            )
        }
        for (const change of [
            { id: 0 },
            { user: { login: 'github-actions[bot]\ncontributor', type: 'Bot' } },
            { user: { login: 'github-actions[bot]', type: 'Bot\nUser' } },
        ]) {
            expect(() =>
                parsePreviewComment({ ...comment, body: 'Valid\nMarkdown', ...change }),
            ).toThrow()
        }
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
