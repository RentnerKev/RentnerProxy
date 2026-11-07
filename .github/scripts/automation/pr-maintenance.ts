import { appendFile } from 'node:fs/promises'
import { evaluateDependabotEligibility } from './dependabot-policy.ts'
import {
    arrayPages,
    commitSha,
    createGitHubRequest,
    GitHubRequestError,
    record,
    repositoryName,
} from './github.ts'
import type {
    GitHubRequest,
    MaintenanceOptions,
    MaintenanceResult,
} from './Types/pr-maintenance.types.ts'

const CI_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid baseRefOid state isDraft reviewDecision
      reviewThreads(first: 100) {
        nodes { isResolved }
        pageInfo { hasNextPage }
      }
      commits(last: 1) {
        nodes { commit { oid statusCheckRollup { state } } }
      }
    }
  }
}`

async function successfulChecks(
    request: GitHubRequest,
    repository: string,
    number: number,
    headSha: string,
    baseSha: string,
): Promise<boolean> {
    const [owner, name] = repository.split('/')
    const response = record(
        await request('POST', '/graphql', {
            query: CI_QUERY,
            variables: { owner, name, number },
        }),
    )
    if (response.errors !== undefined) throw new Error('GitHub CI query failed')
    const pull = record(record(record(response.data).repository).pullRequest)
    if (
        pull.headRefOid !== headSha ||
        pull.baseRefOid !== baseSha ||
        pull.state !== 'OPEN' ||
        pull.isDraft !== false ||
        pull.reviewDecision === 'CHANGES_REQUESTED'
    ) {
        return false
    }
    const threads = record(pull.reviewThreads)
    if (
        record(threads.pageInfo).hasNextPage !== false ||
        !Array.isArray(threads.nodes) ||
        threads.nodes.some((thread: unknown) => record(thread).isResolved !== true)
    ) {
        return false
    }
    const nodes = record(pull.commits).nodes
    if (!Array.isArray(nodes) || nodes.length !== 1) return false
    const commit = record(record(nodes[0]).commit)
    return (
        commit.oid === headSha &&
        commit.statusCheckRollup !== null &&
        record(commit.statusCheckRollup).state === 'SUCCESS'
    )
}

async function maintainPullRequest(
    request: GitHubRequest,
    options: MaintenanceOptions,
    number: number,
): Promise<MaintenanceResult> {
    const prefix = `/repos/${options.repository}`
    const path = `${prefix}/pulls/${number}`
    const skipped = (reason: string): MaintenanceResult => ({ number, action: 'skipped', reason })
    const pull = record(await request('GET', path))
    const base = record(pull.base)
    const head = record(pull.head)
    if (
        pull.state !== 'open' ||
        base.ref !== 'main' ||
        record(base.repo).full_name?.toString().toLowerCase() !== options.repository ||
        head.repo === null
    ) {
        return skipped('Pull request is no longer open against this repository’s main branch')
    }
    if (pull.mergeable === false) return skipped('Merge conflict requires manual resolution')

    const headSha = commitSha(head.sha)
    const main = record(await request('GET', `${prefix}/git/ref/heads/main`))
    const baseSha = commitSha(record(main.object).sha)
    const comparison = record(await request('GET', `${prefix}/compare/${headSha}...${baseSha}`))
    if (!Number.isSafeInteger(comparison.ahead_by) || Number(comparison.ahead_by) < 0) {
        throw new Error('Invalid branch comparison')
    }
    if (Number(comparison.ahead_by) > 0) {
        if (
            record(head.repo).full_name?.toString().toLowerCase() !== options.repository &&
            pull.maintainer_can_modify !== true
        ) {
            return skipped('Fork owner has not allowed maintainer branch updates')
        }
        if (!options.dryRun) {
            await request('PUT', `${path}/update-branch`, { expected_head_sha: headSha })
        }
        return {
            number,
            action: options.dryRun ? 'would-update' : 'update-requested',
            reason: 'Requested branch update; GitHub completes the merge asynchronously',
        }
    }

    if (pull.draft !== false || record(pull.user).login !== 'dependabot[bot]') {
        return skipped('Branch is current; automatic merging is limited to Dependabot updates')
    }
    if (pull.mergeable !== true) return skipped('GitHub is still calculating mergeability')
    const [commits, files] = await Promise.all([
        arrayPages(request, `${path}/commits`),
        arrayPages(request, `${path}/files`),
    ])
    const eligibility = evaluateDependabotEligibility({
        repository: options.repository,
        trustedMergeBotLogin: options.trustedMergeBotLogin ?? '',
        pullRequest: pull,
        commits,
        files,
    })
    if (!eligibility.eligible) return skipped(eligibility.reason)
    if (!(await successfulChecks(request, options.repository, number, headSha, baseSha))) {
        return skipped('Waiting for current successful checks and resolution of review objections')
    }

    const latest = record(await request('GET', path))
    if (
        record(latest.head).sha !== headSha ||
        record(latest.base).sha !== baseSha ||
        latest.mergeable !== true
    ) {
        return skipped('Pull request changed during validation; retry on the next event')
    }
    const currentEligibility = evaluateDependabotEligibility({
        repository: options.repository,
        trustedMergeBotLogin: options.trustedMergeBotLogin ?? '',
        pullRequest: latest,
        commits,
        files,
    })
    if (!currentEligibility.eligible) return skipped(currentEligibility.reason)
    if (options.dryRun) {
        return { number, action: 'would-merge', reason: eligibility.reason }
    }

    // Only the review ruleset exempts this App; GitHub enforces strict CI and main protections.
    const merged = record(
        await request('PUT', `${path}/merge`, { sha: headSha, merge_method: 'squash' }),
    )
    return merged.merged === true
        ? { number, action: 'merged', reason: 'Verified Dependabot update passed current CI' }
        : skipped('GitHub declined the merge; required rules remain enforced')
}

export async function maintainPullRequests(
    request: GitHubRequest,
    options: MaintenanceOptions,
): Promise<MaintenanceResult[]> {
    const repository = repositoryName(options.repository)
    const pulls = await arrayPages(request, `/repos/${repository}/pulls?state=open&base=main`)
    const results: MaintenanceResult[] = []
    for (const entry of pulls) {
        const number = record(entry).number
        if (!Number.isSafeInteger(number) || Number(number) <= 0) {
            throw new Error('Invalid pull request number')
        }
        try {
            // eslint-disable-next-line no-await-in-loop -- each merge changes main for subsequent PRs
            const result = await maintainPullRequest(
                request,
                { ...options, repository },
                Number(number),
            )
            results.push(result)
        } catch (error) {
            const expected =
                error instanceof GitHubRequestError &&
                [403, 404, 405, 409, 422].includes(error.status)
            results.push({
                number: Number(number),
                action: expected ? 'skipped' : 'failed',
                reason:
                    error instanceof GitHubRequestError
                        ? `GitHub HTTP ${error.status}; no update or merge was forced`
                        : 'Validation or GitHub request failed; no merge was attempted',
            })
        }
    }
    return results
}

if (import.meta.main) {
    const repository = process.env.GITHUB_REPOSITORY ?? ''
    const dryRun = process.env.DRY_RUN !== 'false'
    const request = createGitHubRequest(repository, process.env.GH_TOKEN ?? '')
    const results = await maintainPullRequests(request, {
        repository,
        dryRun,
        trustedMergeBotLogin: process.env.TRUSTED_MERGE_BOT_LOGIN ?? '',
    })
    const summary = [
        `## PR maintenance${dryRun ? ' (dry run)' : ''}`,
        '',
        '| PR | Result | Reason |',
        '| --- | --- | --- |',
        ...results.map((result) => `| #${result.number} | ${result.action} | ${result.reason} |`),
        ...(results.length === 0 ? ['No open pull requests against main.'] : []),
        '',
    ].join('\n')
    console.log(summary)
    if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
    }
    if (results.some((result) => result.action === 'failed')) process.exitCode = 1
}
