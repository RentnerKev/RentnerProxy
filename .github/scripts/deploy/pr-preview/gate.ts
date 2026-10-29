import type {
    RequiredCheck,
    CheckRun,
    CheckEvaluation,
    PullRequestSnapshot,
    ExpectedPullRequest,
    WorkflowRun,
    WorkflowRunPullRequest,
    WorkflowRunExpectation,
} from '../Types/pr-preview.types.ts'
import { setTimeout as delay } from 'node:timers/promises'
import {
    asRecord,
    asArray,
    stringValue,
    parsePositiveInteger,
    parseNonNegativeInteger,
    validateFullSha,
    normalizeRepository,
    normalizeWorkflowPath,
} from './validation.ts'
import {
    SELF_CHECK_PREFIX,
    requiredCheckKey,
    evaluateRequiredChecks,
    evaluatePullRequest,
    previewLifecycle,
    assertPullRequestBranchUpToDate,
    latestRequiredCheckRuns,
} from './checks.ts'
import {
    MAX_PAGES,
    GitHubApi,
    parseCheckRun,
    parseWorkflowRun,
    fetchPullRequest,
    fetchBranchHeadSha,
} from './github-api.ts'
import { environmentPositiveInteger } from './runtime.ts'

const DEFAULT_GATE_TIMEOUT_SECONDS = 25 * 60

const DEFAULT_POLL_INTERVAL_SECONDS = 20

class PreviewSourceStaleError extends Error {
    constructor(reason: 'branch_behind' | 'base_advanced') {
        super(
            reason === 'branch_behind'
                ? 'Pull request branch is behind its base; skipping preview publication.'
                : 'Main advanced beyond the tested base; skipping preview publication.',
        )
        this.name = 'PreviewSourceStaleError'
    }
}

async function fetchRequiredChecks(
    api: GitHubApi,
    baseRef: string,
): Promise<readonly RequiredCheck[]> {
    const rules = await api.arrayPages(
        `/repos/${api.repository}/rules/branches/${encodeURIComponent(baseRef)}`,
    )
    const checks: RequiredCheck[] = []
    let requiredStatusRuleCount = 0

    for (const value of rules) {
        const rule = asRecord(value, 'Branch rule')
        if (rule.type !== 'required_status_checks') continue
        requiredStatusRuleCount += 1
        const parameters = asRecord(rule.parameters, 'Required status check parameters')
        if (parameters.strict_required_status_checks_policy !== true) {
            throw new Error(
                'Required status checks must require the pull request branch to be up to date.',
            )
        }
        for (const checkValue of asArray(
            parameters.required_status_checks,
            'Required status checks',
        )) {
            const check = asRecord(checkValue, 'Required status check')
            const context = stringValue(check.context, 'Required check context')
            const integrationId =
                check.integration_id === null || check.integration_id === undefined
                    ? null
                    : parsePositiveInteger(check.integration_id, 'Required check integration ID')
            checks.push({ context, integrationId })
        }
    }

    const unique = new Map(checks.map((check) => [requiredCheckKey(check), check]))
    const result = [...unique.values()]
    if (
        requiredStatusRuleCount === 0 ||
        result.filter((check) => !check.context.startsWith(SELF_CHECK_PREFIX)).length === 0
    ) {
        throw new Error('No non-preview required checks were returned by the active branch rules.')
    }
    return result
}

async function fetchCheckRuns(api: GitHubApi, headSha: string): Promise<readonly CheckRun[]> {
    const checkRuns: CheckRun[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = asRecord(
            // eslint-disable-next-line no-await-in-loop -- check-run pagination is deliberately sequential
            await api.request(
                `/repos/${api.repository}/commits/${headSha}/check-runs?filter=all&per_page=100&page=${page}`,
            ),
            'Check run response',
        )
        const pageRuns = asArray(response.check_runs, 'Check runs').map(parseCheckRun)
        checkRuns.push(...pageRuns)
        if (pageRuns.length < 100) return checkRuns
    }
    throw new Error('Check run pagination limit exceeded.')
}

export function actionsRunIdFromDetailsUrl(value: unknown, repositoryValue: unknown): number {
    const detailsUrl = stringValue(value, 'Check run details URL')
    const repository = normalizeRepository(repositoryValue)
    let url: URL
    try {
        url = new URL(detailsUrl)
    } catch {
        throw new Error('Check run details URL is invalid.')
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search || url.hash) {
        throw new Error('Check run details URL is not a GitHub Actions job.')
    }
    const match = /^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]+)\/job\/[1-9][0-9]*\/?$/u.exec(
        url.pathname,
    )
    if (!match || normalizeRepository(match[1]) !== repository) {
        throw new Error('Check run details URL is not a GitHub Actions job.')
    }
    return parsePositiveInteger(match[2], 'Actions run ID')
}

export async function verifyWorkflowRunIdentity(
    api: GitHubApi,
    workflowRun: WorkflowRun,
    expectation: WorkflowRunExpectation,
): Promise<string> {
    const path = normalizeWorkflowPath(workflowRun.path)
    if (
        workflowRun.repository !== api.repository ||
        workflowRun.event !== expectation.event ||
        workflowRun.status !== 'completed' ||
        workflowRun.conclusion !== 'success' ||
        (expectation.name !== undefined && workflowRun.name !== expectation.name) ||
        (expectation.path !== undefined && path !== expectation.path) ||
        (expectation.headRepository !== undefined &&
            workflowRun.headRepository !== expectation.headRepository) ||
        (expectation.headSha !== undefined && workflowRun.headSha !== expectation.headSha)
    ) {
        throw new Error('Workflow run identity or result is invalid.')
    }

    const definition = asRecord(
        await api.request(`/repos/${api.repository}/actions/workflows/${workflowRun.workflowId}`),
        'Workflow definition',
    )
    if (
        parsePositiveInteger(definition.id, 'Workflow definition ID') !== workflowRun.workflowId ||
        stringValue(definition.name, 'Workflow definition name') !== workflowRun.name ||
        normalizeWorkflowPath(definition.path) !== path ||
        stringValue(definition.state, 'Workflow definition state') !== 'active'
    ) {
        throw new Error('Workflow definition does not match the completed run.')
    }
    return path
}

export function assertWorkflowRunPullRequest(
    pullRequests: readonly WorkflowRunPullRequest[],
    expected: ExpectedPullRequest,
): void {
    if (pullRequests.length === 0) return
    const matches = pullRequests.filter(
        (pullRequest) =>
            pullRequest.number === expected.number &&
            pullRequest.baseRef === expected.baseRef &&
            pullRequest.baseRepository === expected.baseRepository &&
            pullRequest.baseSha === expected.baseSha &&
            pullRequest.headRepository === expected.headRepository &&
            pullRequest.headSha === expected.headSha,
    )
    if (matches.length !== 1) {
        throw new Error(
            'Required check workflow run is not bound to the current pull request state.',
        )
    }
}

async function verifyPullRequestBranchUpToDate(
    api: GitHubApi,
    expected: ExpectedPullRequest,
): Promise<void> {
    const value = await api.request(
        `/repos/${api.repository}/compare/${encodeURIComponent(expected.baseSha)}...${encodeURIComponent(expected.headSha)}`,
    )
    const comparison = asRecord(value, 'Pull request branch comparison')
    const status = stringValue(comparison.status, 'Pull request branch comparison status')
    const ahead = parseNonNegativeInteger(comparison.ahead_by, 'Pull request branch ahead count')
    const behind = parseNonNegativeInteger(comparison.behind_by, 'Pull request branch behind count')
    const base = validateFullSha(
        asRecord(comparison.base_commit, 'Pull request comparison base').sha,
        'Pull request comparison base SHA',
    )
    const mergeBase = validateFullSha(
        asRecord(comparison.merge_base_commit, 'Pull request merge base').sha,
        'Pull request merge base SHA',
    )
    if (base !== expected.baseSha)
        throw new Error('Pull request branch comparison base does not match.')
    if (
        expected.headSha !== expected.baseSha &&
        behind > 0 &&
        ((status === 'behind' && ahead === 0 && mergeBase === expected.headSha) ||
            (status === 'diverged' &&
                ahead > 0 &&
                mergeBase !== expected.headSha &&
                mergeBase !== expected.baseSha))
    )
        throw new PreviewSourceStaleError('branch_behind')
    if (!(
        (status === 'ahead' && ahead > 0 && behind === 0 && mergeBase === expected.baseSha) ||
        (status === 'identical' &&
            ahead === 0 &&
            behind === 0 &&
            expected.headSha === expected.baseSha &&
            mergeBase === expected.baseSha)
    )) {
        throw new Error('Pull request branch comparison is inconsistent.')
    }
    assertPullRequestBranchUpToDate(comparison, expected.baseSha)
}

async function workflowFileBlobSha(api: GitHubApi, path: string, ref: string): Promise<string> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const content = asRecord(
        await api.request(
            `/repos/${api.repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        ),
        'Workflow file',
    )
    if (content.type !== 'file') throw new Error('Workflow source is not a file.')
    return validateFullSha(content.sha, 'Workflow source blob SHA')
}

export async function verifyWorkflowFileUnchanged(
    api: GitHubApi,
    path: string,
    expected: ExpectedPullRequest,
): Promise<void> {
    const [baseBlobSha, testedBlobSha] = await Promise.all([
        workflowFileBlobSha(api, path, expected.baseSha),
        workflowFileBlobSha(api, path, expected.testedSha),
    ])
    if (baseBlobSha !== testedBlobSha) {
        throw new Error(`Required workflow was changed by the pull request: ${path}.`)
    }
}

async function verifyRequiredCheckProvenance(
    api: GitHubApi,
    requiredChecks: readonly RequiredCheck[],
    checkRuns: readonly CheckRun[],
    expected: ExpectedPullRequest,
): Promise<void> {
    const selected = latestRequiredCheckRuns(requiredChecks, checkRuns)
    const runIds = [
        ...new Set(
            selected.map((run) => actionsRunIdFromDetailsUrl(run.detailsUrl, api.repository)),
        ),
    ]
    const workflowRuns = await Promise.all(
        runIds.map(async (runId) =>
            parseWorkflowRun(await api.request(`/repos/${api.repository}/actions/runs/${runId}`)),
        ),
    )
    const paths = new Set(
        await Promise.all(
            workflowRuns.map(async (workflowRun) => {
                const path = await verifyWorkflowRunIdentity(api, workflowRun, {
                    event: 'pull_request',
                    headRepository: expected.headRepository,
                    headSha: expected.headSha,
                })
                assertWorkflowRunPullRequest(workflowRun.pullRequests, expected)
                return path
            }),
        ),
    )
    await Promise.all([...paths].map((path) => verifyWorkflowFileUnchanged(api, path, expected)))
}

function checkSummary(evaluation: CheckEvaluation): string {
    return JSON.stringify({
        failed: evaluation.failed,
        ignored: evaluation.ignored,
        missing: evaluation.missing,
        pending: evaluation.pending,
        state: evaluation.state,
    })
}

async function verifyCurrentMain(api: GitHubApi, expected: ExpectedPullRequest): Promise<void> {
    if ((await fetchBranchHeadSha(api, 'main')) !== expected.baseSha) {
        throw new PreviewSourceStaleError('base_advanced')
    }
}

function assertGatePullRequestIdentity(
    pullRequest: PullRequestSnapshot,
    expected: ExpectedPullRequest,
): void {
    if (
        pullRequest.number !== expected.number ||
        pullRequest.baseRepository !== expected.baseRepository ||
        pullRequest.baseRef !== expected.baseRef ||
        pullRequest.headRepository !== expected.headRepository
    ) {
        throw new Error('Pull request identity does not match the expected preview source.')
    }
}

export async function previewGateLifecycle(
    api: GitHubApi,
    expected: ExpectedPullRequest,
): Promise<'open' | 'closed' | 'stale'> {
    try {
        return previewLifecycle(await verifyGate(api, expected, true), expected)
    } catch (error) {
        if (!(error instanceof PreviewSourceStaleError)) throw error
        console.log(error.message)
        return 'stale'
    }
}

export async function verifyGate(
    api: GitHubApi,
    expected: ExpectedPullRequest,
    waitForChecks: boolean,
): Promise<PullRequestSnapshot> {
    const timeoutSeconds = environmentPositiveInteger(
        'GATE_TIMEOUT_SECONDS',
        DEFAULT_GATE_TIMEOUT_SECONDS,
    )
    const pollIntervalSeconds = environmentPositiveInteger(
        'POLL_INTERVAL_SECONDS',
        DEFAULT_POLL_INTERVAL_SECONDS,
    )
    const deadline = Date.now() + timeoutSeconds * 1_000
    const initialPullRequest = await fetchPullRequest(api, expected.number)
    assertGatePullRequestIdentity(initialPullRequest, expected)
    await verifyCurrentMain(api, expected)
    const initialEvaluation = evaluatePullRequest(initialPullRequest, expected)
    if (initialEvaluation.state === 'failed') {
        throw new Error(initialEvaluation.reason)
    }
    if (initialEvaluation.state === 'closed' || initialEvaluation.state === 'stale') {
        if (waitForChecks) return initialPullRequest
        throw new Error('Pull request is closed or stale; refusing to revalidate publication.')
    }
    await verifyPullRequestBranchUpToDate(api, expected)
    const requiredChecks = await fetchRequiredChecks(api, expected.baseRef)
    let previousSummary = ''

    while (true) {
        // eslint-disable-next-line no-await-in-loop -- the gate intentionally polls current PR state
        const pullRequest = await fetchPullRequest(api, expected.number)
        assertGatePullRequestIdentity(pullRequest, expected)
        // oxlint-disable-next-line no-await-in-loop -- Refresh the authoritative base before every poll.
        await verifyCurrentMain(api, expected)
        const pullRequestEvaluation = evaluatePullRequest(pullRequest, expected)
        if (pullRequestEvaluation.state === 'failed') {
            throw new Error(pullRequestEvaluation.reason)
        }
        if (pullRequestEvaluation.state === 'closed' || pullRequestEvaluation.state === 'stale') {
            if (waitForChecks) return pullRequest
            throw new Error('Pull request is closed or stale; refusing to revalidate publication.')
        }

        if (pullRequestEvaluation.state === 'success') {
            // eslint-disable-next-line no-await-in-loop -- checks must be refreshed for every poll
            const checkRuns = await fetchCheckRuns(api, expected.headSha)
            const checkEvaluation = evaluateRequiredChecks(requiredChecks, checkRuns)
            const summary = checkSummary(checkEvaluation)
            if (summary !== previousSummary) {
                console.log(`Required check state: ${summary}`)
                previousSummary = summary
            }
            if (checkEvaluation.state === 'success') {
                // eslint-disable-next-line no-await-in-loop -- provenance is checked only after every required check succeeds
                await verifyRequiredCheckProvenance(api, requiredChecks, checkRuns, expected)

                // eslint-disable-next-line no-await-in-loop -- the lifecycle must be current before returning a successful gate
                const currentPullRequest = await fetchPullRequest(api, expected.number)
                assertGatePullRequestIdentity(currentPullRequest, expected)
                // oxlint-disable-next-line no-await-in-loop -- Recheck the authoritative base immediately before approval.
                await verifyCurrentMain(api, expected)
                const currentEvaluation = evaluatePullRequest(currentPullRequest, expected)
                if (currentEvaluation.state === 'failed') throw new Error(currentEvaluation.reason)
                if (currentEvaluation.state === 'closed' || currentEvaluation.state === 'stale') {
                    if (waitForChecks) return currentPullRequest
                    throw new Error(
                        'Pull request is closed or stale; refusing to revalidate publication.',
                    )
                }
                if (currentEvaluation.state !== 'success') {
                    throw new Error(currentEvaluation.reason)
                }
                return currentPullRequest
            }
            if (checkEvaluation.state === 'failed') {
                throw new Error(`Required check failed: ${checkEvaluation.failed.join(', ')}`)
            }
            if (!waitForChecks) {
                throw new Error(`Required checks are not complete: ${summary}`)
            }
        } else if (!waitForChecks) {
            throw new Error(pullRequestEvaluation.reason)
        }

        if (Date.now() >= deadline) throw new Error('Required check timed out.')
        // eslint-disable-next-line no-await-in-loop -- bounded polling requires a delay between API requests
        await delay(pollIntervalSeconds * 1_000)
    }
}
