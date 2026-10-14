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
    validateFullSha,
    normalizeRepository,
    normalizeWorkflowPath,
} from './validation.ts'
import {
    SELF_CHECK_PREFIX,
    requiredCheckKey,
    evaluateRequiredChecks,
    evaluatePullRequest,
    assertPullRequestBranchUpToDate,
    latestRequiredCheckRuns,
} from './checks.ts'
import {
    MAX_PAGES,
    GitHubApi,
    parseCheckRun,
    parseWorkflowRun,
    fetchPullRequest,
} from './github-api.ts'
import { environmentPositiveInteger } from './runtime.ts'

const DEFAULT_GATE_TIMEOUT_SECONDS = 25 * 60

const DEFAULT_POLL_INTERVAL_SECONDS = 20

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
    const comparison = await api.request(
        `/repos/${api.repository}/compare/${encodeURIComponent(expected.baseSha)}...${encodeURIComponent(expected.headSha)}`,
    )
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
    const initialEvaluation = evaluatePullRequest(initialPullRequest, expected)
    if (initialEvaluation.state === 'closed') {
        if (waitForChecks) return initialPullRequest
        throw new Error('Pull request is closed; refusing to revalidate publication.')
    }
    if (initialEvaluation.state === 'failed') {
        throw new Error(initialEvaluation.reason)
    }
    await verifyPullRequestBranchUpToDate(api, expected)
    const requiredChecks = await fetchRequiredChecks(api, expected.baseRef)
    let previousSummary = ''

    while (true) {
        // eslint-disable-next-line no-await-in-loop -- the gate intentionally polls current PR state
        const pullRequest = await fetchPullRequest(api, expected.number)
        const pullRequestEvaluation = evaluatePullRequest(pullRequest, expected)
        if (pullRequestEvaluation.state === 'closed') {
            if (waitForChecks) return pullRequest
            throw new Error('Pull request is closed; refusing to revalidate publication.')
        }
        if (pullRequestEvaluation.state === 'failed') {
            throw new Error(pullRequestEvaluation.reason)
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
                const currentEvaluation = evaluatePullRequest(currentPullRequest, expected)
                if (currentEvaluation.state === 'closed') {
                    if (waitForChecks) return currentPullRequest
                    throw new Error('Pull request is closed; refusing to revalidate publication.')
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
