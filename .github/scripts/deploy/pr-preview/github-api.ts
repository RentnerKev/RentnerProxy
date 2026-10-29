import type {
    CheckRun,
    PullRequestSnapshot,
    WorkflowRun,
    WorkflowArtifact,
} from '../Types/pr-preview.types.ts'
import {
    asRecord,
    asArray,
    stringValue,
    nullableString,
    booleanValue,
    nullableBoolean,
    parsePositiveInteger,
    parseNonNegativeInteger,
    validateFullSha,
    parsePullRequestLifecycle,
    validateSha256Digest,
    normalizeRepository,
    validateRef,
} from './validation.ts'

const API_VERSION = '2022-11-28'

export const MAX_PAGES = 100

export class GitHubApi {
    readonly #repository: string
    readonly #token: string

    constructor(repository: string, token: string) {
        this.#repository = normalizeRepository(repository)
        this.#token = stringValue(token, 'GitHub token')
    }

    get repository(): string {
        return this.#repository
    }

    async request(
        path: string,
        options: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' } = {},
    ) {
        const response = await fetch(`https://api.github.com${path}`, {
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${this.#token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': API_VERSION,
            },
            method: options.method ?? 'GET',
            signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) {
            throw new Error(`GitHub API request failed with status ${response.status}.`)
        }
        if (response.status === 204) return null
        return response.json() as Promise<unknown>
    }

    async arrayPages(path: string): Promise<readonly unknown[]> {
        const values: unknown[] = []
        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const separator = path.includes('?') ? '&' : '?'
            const result = asArray(
                // eslint-disable-next-line no-await-in-loop -- each page determines whether another request is needed
                await this.request(`${path}${separator}per_page=100&page=${page}`),
                'GitHub API page',
            )
            values.push(...result)
            if (result.length < 100) return values
        }
        throw new Error('GitHub API pagination limit exceeded.')
    }
}

function parsePullRequest(value: unknown): PullRequestSnapshot {
    const pullRequest = asRecord(value, 'Pull request')
    const base = asRecord(pullRequest.base, 'Pull request base')
    const head = asRecord(pullRequest.head, 'Pull request head')
    const baseRepository = asRecord(base.repo, 'Pull request base repository')
    const headRepository =
        head.repo === null ? null : asRecord(head.repo, 'Pull request head repository')

    return {
        baseRef: validateRef(base.ref, 'Pull request base ref'),
        baseRepository: normalizeRepository(baseRepository.full_name),
        baseSha: validateFullSha(base.sha, 'Pull request base SHA'),
        draft: booleanValue(pullRequest.draft, 'Pull request draft state'),
        headRepository:
            headRepository === null ? null : normalizeRepository(headRepository.full_name),
        headSha: validateFullSha(head.sha, 'Pull request head SHA'),
        mergeable: nullableBoolean(pullRequest.mergeable, 'Pull request mergeability'),
        mergeCommitSha:
            pullRequest.merge_commit_sha === null
                ? null
                : validateFullSha(pullRequest.merge_commit_sha, 'Pull request merge SHA'),
        number: parsePositiveInteger(pullRequest.number, 'Pull request number'),
        state: parsePullRequestLifecycle(pullRequest.state),
    }
}

export function parseCheckRun(value: unknown): CheckRun {
    const checkRun = asRecord(value, 'Check run')
    const app = checkRun.app === null ? null : asRecord(checkRun.app, 'Check run app')
    return {
        appId: app === null ? null : parsePositiveInteger(app.id, 'Check run app ID'),
        conclusion: nullableString(checkRun.conclusion, 'Check run conclusion'),
        detailsUrl: stringValue(checkRun.details_url, 'Check run details URL'),
        id: parsePositiveInteger(checkRun.id, 'Check run ID'),
        name: stringValue(checkRun.name, 'Check run name'),
        status: stringValue(checkRun.status, 'Check run status'),
    }
}

function repositoryFromApiUrl(value: unknown, label: string): string {
    const rawUrl = stringValue(value, label)
    let url: URL
    try {
        url = new URL(rawUrl)
    } catch {
        throw new Error(`${label} is invalid.`)
    }
    const match = /^\/repos\/([^/]+\/[^/]+)\/?$/u.exec(url.pathname)
    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'api.github.com' ||
        url.search ||
        url.hash ||
        !match
    ) {
        throw new Error(`${label} is invalid.`)
    }
    return normalizeRepository(match[1])
}

export function parseWorkflowRun(value: unknown): WorkflowRun {
    const workflowRun = asRecord(value, 'Workflow run')
    const repository = asRecord(workflowRun.repository, 'Workflow run repository')
    const headRepository =
        workflowRun.head_repository === null
            ? null
            : asRecord(workflowRun.head_repository, 'Workflow run head repository')
    const pullRequests = asArray(workflowRun.pull_requests ?? [], 'Workflow run pull requests').map(
        (entry) => {
            const pullRequest = asRecord(entry, 'Workflow run pull request')
            const base = asRecord(pullRequest.base, 'Workflow run pull request base')
            const head = asRecord(pullRequest.head, 'Workflow run pull request head')
            const baseRepository = asRecord(base.repo, 'Workflow run pull request base repository')
            const pullRequestHeadRepository = asRecord(
                head.repo,
                'Workflow run pull request head repository',
            )
            return {
                baseRef: validateRef(base.ref, 'Workflow run pull request base ref'),
                baseRepository: repositoryFromApiUrl(
                    baseRepository.url,
                    'Workflow run pull request base repository URL',
                ),
                baseSha: validateFullSha(base.sha, 'Workflow run pull request base SHA'),
                headRepository: repositoryFromApiUrl(
                    pullRequestHeadRepository.url,
                    'Workflow run pull request head repository URL',
                ),
                headSha: validateFullSha(head.sha, 'Workflow run pull request head SHA'),
                number: parsePositiveInteger(
                    pullRequest.number,
                    'Workflow run pull request number',
                ),
            }
        },
    )

    return {
        conclusion: stringValue(workflowRun.conclusion, 'Workflow run conclusion'),
        event: stringValue(workflowRun.event, 'Workflow run event'),
        headRepository:
            headRepository === null ? null : normalizeRepository(headRepository.full_name),
        headSha: validateFullSha(workflowRun.head_sha, 'Workflow run head SHA'),
        id: parsePositiveInteger(workflowRun.id, 'Workflow run ID'),
        name: stringValue(workflowRun.name, 'Workflow run name'),
        path: stringValue(workflowRun.path, 'Workflow run path'),
        pullRequests,
        repository: normalizeRepository(repository.full_name),
        runAttempt: parsePositiveInteger(workflowRun.run_attempt, 'Workflow run attempt'),
        status: stringValue(workflowRun.status, 'Workflow run status'),
        workflowId: parsePositiveInteger(workflowRun.workflow_id, 'Workflow ID'),
    }
}

export function parseWorkflowArtifact(value: unknown): WorkflowArtifact {
    const artifact = asRecord(value, 'Workflow artifact')
    const workflowRun = asRecord(artifact.workflow_run, 'Artifact workflow run')
    return {
        digest: validateSha256Digest(artifact.digest, 'Artifact digest'),
        expired: booleanValue(artifact.expired, 'Artifact expiration state'),
        name: stringValue(artifact.name, 'Artifact name'),
        sizeInBytes: parseNonNegativeInteger(artifact.size_in_bytes, 'Artifact size'),
        workflowRunId: parsePositiveInteger(workflowRun.id, 'Artifact workflow run ID'),
    }
}

export async function fetchPullRequest(
    api: GitHubApi,
    number: number,
): Promise<PullRequestSnapshot> {
    return parsePullRequest(await api.request(`/repos/${api.repository}/pulls/${number}`))
}

export async function fetchBranchHeadSha(api: GitHubApi, ref: string): Promise<string> {
    const branch = validateRef(ref, 'Branch ref')
    const path = branch.split('/').map(encodeURIComponent).join('/')
    const reference = asRecord(
        await api.request(`/repos/${api.repository}/git/ref/heads/${path}`),
        'Branch reference',
    )
    const object = asRecord(reference.object, 'Branch reference object')
    if (reference.ref !== `refs/heads/${branch}` || object.type !== 'commit') {
        throw new Error('Branch reference identity is invalid.')
    }
    return validateFullSha(object.sha, 'Branch head SHA')
}
