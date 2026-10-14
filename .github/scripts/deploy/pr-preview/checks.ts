import type {
    RequiredCheck,
    CheckRun,
    CheckEvaluation,
    PullRequestSnapshot,
    ExpectedPullRequest,
    PullRequestEvaluation,
} from '../Types/pr-preview.types.ts'
import { asRecord, stringValue, parseNonNegativeInteger, validateFullSha } from './validation.ts'

export const SELF_CHECK_PREFIX = 'PR Preview /'

export function requiredCheckKey(check: RequiredCheck): string {
    return `${check.context}\0${check.integrationId ?? 'any'}`
}

export function evaluateRequiredChecks(
    requiredChecks: readonly RequiredCheck[],
    checkRuns: readonly CheckRun[],
): CheckEvaluation {
    const failed: string[] = []
    const ignored: string[] = []
    const missing: string[] = []
    const pending: string[] = []
    const seen = new Set<string>()

    for (const required of requiredChecks) {
        if (required.context.startsWith(SELF_CHECK_PREFIX)) {
            ignored.push(required.context)
            continue
        }
        const key = requiredCheckKey(required)
        if (seen.has(key)) continue
        seen.add(key)

        const latest = checkRuns
            .filter(
                (run) =>
                    run.name === required.context &&
                    (required.integrationId === null || run.appId === required.integrationId),
            )
            .toSorted((left, right) => right.id - left.id)[0]

        if (!latest) {
            missing.push(required.context)
            continue
        }
        if (latest.status !== 'completed') {
            if (
                ['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(latest.status)
            ) {
                pending.push(required.context)
            } else {
                failed.push(`${required.context} (${latest.status})`)
            }
            continue
        }
        if (latest.conclusion !== 'success') {
            failed.push(`${required.context} (${latest.conclusion ?? 'no conclusion'})`)
        }
    }

    const state =
        failed.length > 0
            ? 'failed'
            : missing.length > 0
              ? 'missing'
              : pending.length > 0
                ? 'pending'
                : 'success'
    return { failed, ignored, missing, pending, state }
}

export function evaluatePullRequest(
    pullRequest: PullRequestSnapshot,
    expected: ExpectedPullRequest,
): PullRequestEvaluation {
    if (pullRequest.number !== expected.number) {
        return { reason: 'Could not resolve pull request.', state: 'failed' }
    }
    if (pullRequest.baseRepository !== expected.baseRepository) {
        return { reason: 'Pull request base changed.', state: 'failed' }
    }
    if (pullRequest.baseRef !== expected.baseRef) {
        return { reason: 'Pull request base changed.', state: 'failed' }
    }
    if (
        pullRequest.headRepository === null ||
        pullRequest.headRepository !== expected.headRepository
    ) {
        return { reason: 'Pull request head repository is unavailable.', state: 'failed' }
    }
    if (pullRequest.headSha !== expected.headSha) {
        return { reason: 'Pull request is stale.', state: 'failed' }
    }
    if (pullRequest.state === 'closed') {
        return { reason: 'Pull request is closed; skipping preview publication.', state: 'closed' }
    }
    if (pullRequest.state !== 'open') {
        return { reason: 'Pull request state is invalid.', state: 'failed' }
    }
    if (pullRequest.draft) {
        return { reason: 'Draft pull requests do not publish previews.', state: 'failed' }
    }
    if (pullRequest.baseSha !== expected.baseSha) {
        return { reason: 'Pull request is stale.', state: 'failed' }
    }
    if (pullRequest.mergeable === null || pullRequest.mergeCommitSha === null) {
        return { reason: 'Pull request mergeability is still being computed.', state: 'pending' }
    }
    if (!pullRequest.mergeable) {
        return { reason: 'Pull request is not mergeable.', state: 'failed' }
    }
    if (pullRequest.mergeCommitSha !== expected.testedSha) {
        return { reason: 'Pull request is stale.', state: 'failed' }
    }
    return { reason: 'Pull request is current.', state: 'success' }
}

export function assertPullRequestBranchUpToDate(
    value: unknown,
    expectedBaseShaValue: unknown,
): void {
    const expectedBaseSha = validateFullSha(expectedBaseShaValue, 'Expected base SHA')
    const comparison = asRecord(value, 'Pull request branch comparison')
    const mergeBase = asRecord(comparison.merge_base_commit, 'Pull request merge base')
    const status = stringValue(comparison.status, 'Pull request branch comparison status')
    const behindBy = parseNonNegativeInteger(
        comparison.behind_by,
        'Pull request branch behind count',
    )
    const mergeBaseSha = validateFullSha(mergeBase.sha, 'Pull request merge base SHA')
    if (
        behindBy !== 0 ||
        !['ahead', 'identical'].includes(status) ||
        mergeBaseSha !== expectedBaseSha
    ) {
        throw new Error('Pull request branch is not up to date with its base.')
    }
}

export function latestRequiredCheckRuns(
    requiredChecks: readonly RequiredCheck[],
    checkRuns: readonly CheckRun[],
): readonly CheckRun[] {
    const selected = new Map<string, CheckRun>()
    for (const required of requiredChecks) {
        if (required.context.startsWith(SELF_CHECK_PREFIX)) continue
        const key = requiredCheckKey(required)
        if (selected.has(key)) continue
        const latest = checkRuns
            .filter(
                (run) =>
                    run.name === required.context &&
                    (required.integrationId === null || run.appId === required.integrationId),
            )
            .toSorted((left, right) => right.id - left.id)[0]
        if (latest) selected.set(key, latest)
    }
    return [...selected.values()]
}
