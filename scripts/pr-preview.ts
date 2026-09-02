import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, readFile, readdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export const PREVIEW_ARTIFACT_NAME = 'pr-preview-image'
export const PREVIEW_COMMENT_MARKER = '<!-- rentnerproxy-pr-preview -->'
export const PREVIEW_PLATFORM = 'linux/amd64'
export const PREVIEW_SHORT_SHA_LENGTH = 12
export const PREVIEW_SOURCE_ARTIFACT_NAME = 'pr-preview-source'
export const PREVIEW_TRIGGER_WORKFLOW_NAME = 'PR Title'
export const PREVIEW_TRIGGER_WORKFLOW_PATH = '.github/workflows/pr-title.yml'
export const PREVIEW_WORKFLOW_NAME = 'PR Preview Build'
export const PREVIEW_WORKFLOW_PATH = '.github/workflows/pr-preview-build.yml'
export const MAX_PREVIEW_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024

const API_VERSION = '2022-11-28'
const DEFAULT_GATE_TIMEOUT_SECONDS = 25 * 60
const DEFAULT_POLL_INTERVAL_SECONDS = 20
const MAX_PAGES = 100
const MAX_SOURCE_ARTIFACT_BYTES = 64 * 1024
const SELF_CHECK_PREFIX = 'PR Preview /'

type JsonRecord = Record<string, unknown>

export interface PreviewIdentity {
    readonly image: string
    readonly immutableReference: string
    readonly immutableTag: string
    readonly movingReference: string
    readonly movingTag: string
    readonly pullRequestNumber: number
    readonly repository: string
    readonly shortTestedSha: string
    readonly testedSha: string
}

export interface RequiredCheck {
    readonly context: string
    readonly integrationId: number | null
}

export interface CheckRun {
    readonly appId: number | null
    readonly conclusion: string | null
    readonly detailsUrl: string
    readonly id: number
    readonly name: string
    readonly status: string
}

export interface CheckEvaluation {
    readonly failed: readonly string[]
    readonly ignored: readonly string[]
    readonly missing: readonly string[]
    readonly pending: readonly string[]
    readonly state: 'failed' | 'missing' | 'pending' | 'success'
}

export interface PullRequestSnapshot {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly draft: boolean
    readonly headRepository: string | null
    readonly headSha: string
    readonly mergeable: boolean | null
    readonly mergeCommitSha: string | null
    readonly number: number
    readonly state: string
}

export interface ExpectedPullRequest {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly headRepository: string
    readonly headSha: string
    readonly number: number
    readonly testedSha: string
}

export interface PullRequestEvaluation {
    readonly reason: string
    readonly state: 'failed' | 'pending' | 'success'
}

export interface PreviewComment {
    readonly body: string | null
    readonly id: number
    readonly userLogin: string
    readonly userType: string
}

export interface PreviewArtifactMetadata {
    readonly artifactName: string
    readonly baseSha: string
    readonly createdAt: string
    readonly headRepository: string
    readonly headSha: string
    readonly ociSha256: string
    readonly platform: string
    readonly pullRequestNumber: number
    readonly repository: string
    readonly runAttempt: number
    readonly runId: number
    readonly schemaVersion: 1
    readonly testedSha: string
    readonly triggerRunId: number
}

interface ArtifactExpectation extends ExpectedPullRequest {
    readonly artifactDirectory: string
    readonly runAttempt: number
    readonly runId: number
    readonly triggerRunId: number
}

interface WorkflowRun {
    readonly conclusion: string
    readonly event: string
    readonly headRepository: string | null
    readonly headSha: string
    readonly id: number
    readonly name: string
    readonly path: string
    readonly pullRequests: readonly WorkflowRunPullRequest[]
    readonly repository: string
    readonly runAttempt: number
    readonly status: string
    readonly workflowId: number
}

interface TriggerProof {
    readonly pullRequestNumber: number
    readonly testedSha: string
}

export interface WorkflowRunPullRequest {
    readonly baseRef: string
    readonly baseRepository: string
    readonly baseSha: string
    readonly headRepository: string
    readonly headSha: string
    readonly number: number
}

interface WorkflowArtifact {
    readonly digest: string
    readonly expired: boolean
    readonly name: string
    readonly sizeInBytes: number
    readonly workflowRunId: number
}

function asRecord(value: unknown, label: string): JsonRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} is not an object.`)
    }
    return value as JsonRecord
}

function asArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} is not an array.`)
    return value
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

function nullableString(value: unknown, label: string): string | null {
    if (value === null) return null
    return stringValue(value, label)
}

function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`)
    return value
}

function nullableBoolean(value: unknown, label: string): boolean | null {
    if (value === null) return null
    return booleanValue(value, label)
}

export function parsePositiveInteger(value: unknown, label = 'Positive integer'): number {
    const normalized = typeof value === 'number' ? String(value) : value
    if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/u.test(normalized)) {
        throw new Error(`${label} is invalid.`)
    }
    const parsed = Number(normalized)
    if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid.`)
    return parsed
}

function parseNonNegativeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function validateFullSha(value: unknown, label = 'Git SHA'): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function parseTestedShaProof(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}\n$/u.test(value)) {
        throw new Error('Tested SHA proof file is invalid.')
    }
    return validateFullSha(value.slice(0, 40), 'Proven tested SHA')
}

export function parsePullRequestNumberProof(value: unknown): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*\n$/u.test(value)) {
        throw new Error('Pull request number proof file is invalid.')
    }
    return parsePositiveInteger(value.slice(0, -1), 'Proven pull request number')
}

export function validateSha256Digest(value: unknown, label = 'SHA-256 digest'): string {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

function validateSha256Hex(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function normalizeRepository(value: unknown): string {
    const normalized = stringValue(value, 'Repository').toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/u.test(normalized)) {
        throw new Error('Repository is invalid.')
    }
    return normalized
}

function validateRef(value: unknown, label: string): string {
    const ref = stringValue(value, label)
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(ref) || ref.includes('..')) {
        throw new Error(`${label} is invalid.`)
    }
    return ref
}

export function normalizeWorkflowPath(value: unknown): string {
    const rawPath = stringValue(value, 'Workflow path')
    const separatorIndex = rawPath.indexOf('@')
    const path = separatorIndex === -1 ? rawPath : rawPath.slice(0, separatorIndex)
    if (
        !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._/-]*\.ya?ml$/u.test(path) ||
        path.includes('..') ||
        (separatorIndex !== -1 && rawPath.slice(separatorIndex + 1).length === 0)
    ) {
        throw new Error('Workflow path is invalid.')
    }
    return path
}

export function assertPreviewTag(value: unknown): string {
    const tag = stringValue(value, 'Preview tag')
    if (
        !/^(?:pr-[1-9][0-9]*|pr-[1-9][0-9]*-[0-9a-f]{12})$/u.test(tag) ||
        tag === 'latest' ||
        tag === 'dev' ||
        /^v?[0-9]+\.[0-9]+\.[0-9]+(?:-|$)/u.test(tag)
    ) {
        throw new Error('Preview tag is outside the PR preview channel.')
    }
    return tag
}

export function createPreviewIdentity(
    repositoryValue: unknown,
    pullRequestNumberValue: unknown,
    testedShaValue: unknown,
): PreviewIdentity {
    const repository = normalizeRepository(repositoryValue)
    const pullRequestNumber = parsePositiveInteger(pullRequestNumberValue, 'Pull request number')
    const testedSha = validateFullSha(testedShaValue, 'Tested SHA')
    const shortTestedSha = testedSha.slice(0, PREVIEW_SHORT_SHA_LENGTH)
    const movingTag = assertPreviewTag(`pr-${pullRequestNumber}`)
    const immutableTag = assertPreviewTag(`pr-${pullRequestNumber}-${shortTestedSha}`)
    const image = `ghcr.io/${repository}`

    return {
        image,
        immutableReference: `${image}:${immutableTag}`,
        immutableTag,
        movingReference: `${image}:${movingTag}`,
        movingTag,
        pullRequestNumber,
        repository,
        shortTestedSha,
        testedSha,
    }
}

function requiredCheckKey(check: RequiredCheck): string {
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
    if (pullRequest.state !== 'open') {
        return { reason: 'PR no longer open.', state: 'failed' }
    }
    if (pullRequest.draft) {
        return { reason: 'Draft pull requests do not publish previews.', state: 'failed' }
    }
    if (
        pullRequest.baseRepository !== expected.baseRepository ||
        pullRequest.baseRef !== expected.baseRef
    ) {
        return { reason: 'Pull request base changed.', state: 'failed' }
    }
    if (
        pullRequest.headRepository === null ||
        pullRequest.headRepository !== expected.headRepository
    ) {
        return { reason: 'Pull request head repository is unavailable.', state: 'failed' }
    }
    if (pullRequest.headSha !== expected.headSha || pullRequest.baseSha !== expected.baseSha) {
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

export function selectPreviewComment(comments: readonly PreviewComment[]): PreviewComment | null {
    return (
        comments
            .filter(
                (comment) =>
                    comment.userLogin === 'github-actions[bot]' &&
                    comment.userType === 'Bot' &&
                    comment.body?.trimStart().startsWith(PREVIEW_COMMENT_MARKER) === true,
            )
            .toSorted((left, right) => right.id - left.id)[0] ?? null
    )
}

export function renderPreviewComment(
    identity: PreviewIdentity,
    headShaValue: unknown,
    digestValue: unknown,
): string {
    const headSha = validateFullSha(headShaValue, 'PR head SHA')
    const digest = validateSha256Digest(digestValue, 'Image digest')
    const projectName = `rentnerproxy-pr-${identity.pullRequestNumber}`

    return [
        PREVIEW_COMMENT_MARKER,
        '',
        '## 🐳 RentnerProxy PR Preview',
        '',
        'A test-only image for this pull request has been published successfully.',
        '',
        '### Images',
        '',
        '| Type | Image |',
        '| --- | --- |',
        `| Moving preview for this PR | \`${identity.movingReference}\` |`,
        `| Exact tested build | \`${identity.immutableReference}\` |`,
        '',
        `Image digest: \`${digest}\``,
        '',
        `Tested and built merge commit: \`${identity.testedSha}\``,
        '',
        `Pull request head commit: \`${headSha}\``,
        '',
        `For reproducible testing and bug reports, prefer \`${identity.immutableTag}\`. ` +
            `The \`${identity.movingTag}\` tag moves to the newest successful preview for this PR.`,
        '',
        '---',
        '',
        '### ⚠️ Unreviewed development preview',
        '',
        'This image contains unreviewed pull-request code. It may contain bugs, breaking changes, ' +
            'incomplete or incompatible migrations, configuration errors, and changes that damage data or runtime state.',
        '',
        '**Do not use this PR preview image with production data.**',
        '',
        'Before testing:',
        '',
        '1. Back up PostgreSQL.',
        '2. Back up the complete RentnerProxy controller/runtime state in `/var/lib/rentnerproxy`, ' +
            'including certificates, private keys, ACME state, active configuration, last-known-good state, and trusted CA material.',
        '3. Prefer a separate test database and separate Docker volumes.',
        '4. Use an isolated Docker Compose project and avoid production port bindings.',
        '',
        '### Docker',
        '',
        '```bash',
        `docker pull ${identity.immutableReference}`,
        '```',
        '',
        '### Docker Compose',
        '',
        'In a separate test copy of `docker-compose.yml`, replace the service image with:',
        '',
        '```yaml',
        `image: ${identity.immutableReference}`,
        '```',
        '',
        'Then use an isolated Compose project:',
        '',
        '```bash',
        `docker compose --project-name ${projectName} pull`,
        `docker compose --project-name ${projectName} up -d`,
        '```',
        '',
        'The repository Compose file binds ports 80, 81, and 443; change those bindings or stop the production stack before testing.',
        '',
        'This preview is intended only for testing this pull request and is not a production release.',
    ].join('\n')
}

class GitHubApi {
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
        state: stringValue(pullRequest.state, 'Pull request state'),
    }
}

function parseCheckRun(value: unknown): CheckRun {
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

function parseWorkflowRun(value: unknown): WorkflowRun {
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

function parseWorkflowArtifact(value: unknown): WorkflowArtifact {
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

async function fetchPullRequest(api: GitHubApi, number: number): Promise<PullRequestSnapshot> {
    return parsePullRequest(await api.request(`/repos/${api.repository}/pulls/${number}`))
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

function latestRequiredCheckRuns(
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

interface WorkflowRunExpectation {
    readonly event: string
    readonly headRepository?: string
    readonly headSha?: string
    readonly name?: string
    readonly path?: string
}

async function verifyWorkflowRunIdentity(
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
    // GitHub may omit this association for runs from fork pull requests. The independent
    // base..head ancestry check still prevents old head checks from crossing a base update.
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

async function verifyWorkflowFileUnchanged(
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

async function verifyGate(
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
    await verifyPullRequestBranchUpToDate(api, expected)
    const requiredChecks = await fetchRequiredChecks(api, expected.baseRef)
    let previousSummary = ''

    while (true) {
        // eslint-disable-next-line no-await-in-loop -- the gate intentionally polls current PR state
        const pullRequest = await fetchPullRequest(api, expected.number)
        const pullRequestEvaluation = evaluatePullRequest(pullRequest, expected)
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
                return pullRequest
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

function environment(name: string): string {
    return stringValue(process.env[name], name)
}

function environmentPositiveInteger(name: string, fallback?: number): number {
    const value = process.env[name]
    if ((value === undefined || value === '') && fallback !== undefined) return fallback
    return parsePositiveInteger(value, name)
}

function expectedPullRequestFromEnvironment(): ExpectedPullRequest {
    return {
        baseRef: validateRef(environment('PR_BASE_REF'), 'PR base ref'),
        baseRepository: normalizeRepository(environment('REPOSITORY')),
        baseSha: validateFullSha(environment('PR_BASE_SHA'), 'PR base SHA'),
        headRepository: normalizeRepository(environment('PR_HEAD_REPOSITORY')),
        headSha: validateFullSha(environment('PR_HEAD_SHA'), 'PR head SHA'),
        number: parsePositiveInteger(environment('PR_NUMBER'), 'PR number'),
        testedSha: validateFullSha(environment('TESTED_SHA'), 'Tested SHA'),
    }
}

async function writeOutputs(values: Readonly<Record<string, string | number>>): Promise<void> {
    const outputPath = environment('GITHUB_OUTPUT')
    const lines = Object.entries(values).map(([key, value]) => {
        if (!/^[a-z][a-z0-9_]*$/u.test(key)) throw new Error('GitHub output key is invalid.')
        const serialized = String(value)
        if (/[\r\n\0]/u.test(serialized)) throw new Error('GitHub output value is invalid.')
        return `${key}=${serialized}`
    })
    await appendFile(outputPath, `${lines.join('\n')}\n`, 'utf8')
}

function previewOutputs(
    identity: PreviewIdentity,
    expected: ExpectedPullRequest,
): Readonly<Record<string, string | number>> {
    return {
        base_ref: expected.baseRef,
        base_sha: expected.baseSha,
        head_repository: expected.headRepository,
        head_sha: expected.headSha,
        image: identity.image,
        immutable_reference: identity.immutableReference,
        immutable_tag: identity.immutableTag,
        moving_reference: identity.movingReference,
        moving_tag: identity.movingTag,
        pr_number: identity.pullRequestNumber,
        repository: identity.repository,
        short_tested_sha: identity.shortTestedSha,
        tested_sha: identity.testedSha,
    }
}

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
    assertWorkflowRunPullRequest(workflowRun.pullRequests, expected)
    await verifyWorkflowFileUnchanged(api, PREVIEW_TRIGGER_WORKFLOW_PATH, expected)
    await verifyGate(api, expected, true)
    const identity = createPreviewIdentity(
        expected.baseRepository,
        expected.number,
        expected.testedSha,
    )
    await writeOutputs({
        ...previewOutputs(identity, expected),
        trigger_run_id: workflowRun.id,
    })
}

async function resolveWorkflowPullRequest(
    api: GitHubApi,
    workflowRun: WorkflowRun,
    pullRequestNumber: number,
): Promise<PullRequestSnapshot> {
    const pullRequest = await fetchPullRequest(api, pullRequestNumber)
    if (pullRequest.number !== pullRequestNumber) {
        throw new Error('Could not resolve pull request.')
    }
    if (pullRequest.state !== 'open') throw new Error('PR no longer open.')
    if (pullRequest.headSha !== workflowRun.headSha) throw new Error('Pull request is stale.')
    if (
        pullRequest.baseRepository !== api.repository ||
        pullRequest.headRepository !== workflowRun.headRepository
    ) {
        throw new Error('Could not resolve pull request.')
    }
    return pullRequest
}

async function fetchWorkflowArtifacts(
    api: GitHubApi,
    runId: number,
): Promise<readonly WorkflowArtifact[]> {
    const artifacts: WorkflowArtifact[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = asRecord(
            // eslint-disable-next-line no-await-in-loop -- artifact pagination is deliberately sequential
            await api.request(
                `/repos/${api.repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
            ),
            'Workflow artifact response',
        )
        const pageArtifacts = asArray(response.artifacts, 'Workflow artifacts').map(
            parseWorkflowArtifact,
        )
        artifacts.push(...pageArtifacts)
        if (pageArtifacts.length < 100) return artifacts
    }
    throw new Error('Workflow artifact pagination limit exceeded.')
}

async function validateWorkflowArtifact(
    api: GitHubApi,
    runId: number,
    expectedName: string,
    maximumBytes: number,
): Promise<WorkflowArtifact> {
    const artifacts = await fetchWorkflowArtifacts(api, runId)
    if (artifacts.length !== 1) throw new Error('Expected exactly one workflow artifact.')
    const artifact = artifacts[0]!
    if (artifact.name !== expectedName) throw new Error('Expected workflow artifact is missing.')
    if (artifact.workflowRunId !== runId) throw new Error('Workflow artifact run does not match.')
    if (artifact.expired) throw new Error('Workflow artifact has expired.')
    if (artifact.sizeInBytes <= 0 || artifact.sizeInBytes > maximumBytes) {
        throw new Error('Workflow artifact size is invalid.')
    }
    return artifact
}

async function eligiblePreviewTriggerRun(
    api: GitHubApi,
    runId: number,
): Promise<{ readonly artifact: WorkflowArtifact; readonly workflowRun: WorkflowRun }> {
    const workflowRun = parseWorkflowRun(
        await api.request(`/repos/${api.repository}/actions/runs/${runId}`),
    )
    if (workflowRun.id !== runId || workflowRun.headRepository === null) {
        throw new Error('Could not resolve pull request trigger.')
    }
    await verifyWorkflowRunIdentity(api, workflowRun, {
        event: 'pull_request',
        headRepository: workflowRun.headRepository,
        headSha: workflowRun.headSha,
        name: PREVIEW_TRIGGER_WORKFLOW_NAME,
        path: PREVIEW_TRIGGER_WORKFLOW_PATH,
    })
    return {
        artifact: await validateWorkflowArtifact(
            api,
            runId,
            PREVIEW_SOURCE_ARTIFACT_NAME,
            MAX_SOURCE_ARTIFACT_BYTES,
        ),
        workflowRun,
    }
}

async function readTriggerProof(artifactDirectory: string): Promise<TriggerProof> {
    const entries = await readdir(artifactDirectory, { withFileTypes: true })
    const proofNames = new Set(['pr-number.txt', 'tested-sha.txt'])
    if (entries.length !== proofNames.size) {
        throw new Error('Pull request trigger proof artifact is invalid.')
    }
    for (const entry of entries) {
        if (!proofNames.has(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
            throw new Error('Pull request trigger proof artifact is invalid.')
        }
    }
    const pullRequestNumberPath = `${artifactDirectory}/pr-number.txt`
    const testedShaPath = `${artifactDirectory}/tested-sha.txt`
    const [pullRequestNumberStat, testedShaStat] = await Promise.all([
        lstat(pullRequestNumberPath),
        lstat(testedShaPath),
    ])
    if (
        !pullRequestNumberStat.isFile() ||
        pullRequestNumberStat.size < 2 ||
        pullRequestNumberStat.size > 17
    ) {
        throw new Error('Pull request number proof file is invalid.')
    }
    if (!testedShaStat.isFile() || testedShaStat.size !== 41) {
        throw new Error('Tested SHA proof file is invalid.')
    }
    const [pullRequestNumber, testedSha] = await Promise.all([
        readFile(pullRequestNumberPath, 'utf8').then(parsePullRequestNumberProof),
        readFile(testedShaPath, 'utf8').then(parseTestedShaProof),
    ])
    return { pullRequestNumber, testedSha }
}

async function commandTriggerPreflight(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    await eligiblePreviewTriggerRun(api, runId)
    console.log('Pull request trigger and source-proof artifact envelope are eligible.')
}

async function eligiblePreviewBuildRun(
    api: GitHubApi,
    runId: number,
): Promise<{ readonly artifact: WorkflowArtifact; readonly workflowRun: WorkflowRun }> {
    const workflowRun = parseWorkflowRun(
        await api.request(`/repos/${api.repository}/actions/runs/${runId}`),
    )
    if (workflowRun.id !== runId) {
        throw new Error('Source workflow run is not an eligible PR preview build.')
    }
    await verifyWorkflowRunIdentity(api, workflowRun, {
        event: 'workflow_run',
        name: PREVIEW_WORKFLOW_NAME,
        path: PREVIEW_WORKFLOW_PATH,
    })
    return {
        artifact: await validateWorkflowArtifact(
            api,
            runId,
            PREVIEW_ARTIFACT_NAME,
            MAX_PREVIEW_ARTIFACT_BYTES,
        ),
        workflowRun,
    }
}

async function commandPreflight(): Promise<void> {
    const repository = normalizeRepository(environment('REPOSITORY'))
    const runId = environmentPositiveInteger('SOURCE_RUN_ID')
    const api = new GitHubApi(repository, environment('GITHUB_TOKEN'))
    await eligiblePreviewBuildRun(api, runId)
    console.log('Source workflow and artifact envelope are eligible.')
}

function validateBuildArtifactMetadata(
    metadata: PreviewArtifactMetadata,
    repository: string,
    workflowRun: WorkflowRun,
): void {
    if (
        metadata.artifactName !== PREVIEW_ARTIFACT_NAME ||
        metadata.platform !== PREVIEW_PLATFORM ||
        metadata.repository !== repository ||
        metadata.runId !== workflowRun.id ||
        metadata.runAttempt !== workflowRun.runAttempt
    ) {
        throw new Error('Preview artifact does not match its source workflow run.')
    }
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
    if (pullRequestEvaluation.state !== 'success') {
        throw new Error(pullRequestEvaluation.reason)
    }
    assertWorkflowRunPullRequest(triggerRun.pullRequests, expected)
    await verifyWorkflowFileUnchanged(api, PREVIEW_TRIGGER_WORKFLOW_PATH, expected)
    await verifyGate(api, expected, true)
    const identity = createPreviewIdentity(repository, expected.number, expected.testedSha)

    await writeOutputs({
        ...previewOutputs(identity, expected),
        artifact_digest: artifact.digest,
        artifact_size: artifact.sizeInBytes,
        run_attempt: workflowRun.runAttempt,
        run_id: workflowRun.id,
        trigger_run_id: metadata.triggerRunId,
    })
}

const metadataKeys = [
    'artifactName',
    'baseSha',
    'createdAt',
    'headRepository',
    'headSha',
    'ociSha256',
    'platform',
    'pullRequestNumber',
    'repository',
    'runAttempt',
    'runId',
    'schemaVersion',
    'testedSha',
    'triggerRunId',
] as const

export function parsePreviewArtifactMetadata(value: unknown): PreviewArtifactMetadata {
    const metadata = asRecord(value, 'Preview artifact metadata')
    const actualKeys = Object.keys(metadata).toSorted()
    if (actualKeys.join('\0') !== [...metadataKeys].toSorted().join('\0')) {
        throw new Error('Preview artifact metadata fields are invalid.')
    }
    if (metadata.schemaVersion !== 1) {
        throw new Error('Preview artifact metadata schema is unsupported.')
    }
    const createdAt = stringValue(metadata.createdAt, 'Artifact creation time')
    const timestamp = Date.parse(createdAt)
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== createdAt) {
        throw new Error('Artifact creation time is invalid.')
    }

    return {
        artifactName: stringValue(metadata.artifactName, 'Artifact name'),
        baseSha: validateFullSha(metadata.baseSha, 'Artifact base SHA'),
        createdAt,
        headRepository: normalizeRepository(metadata.headRepository),
        headSha: validateFullSha(metadata.headSha, 'Artifact head SHA'),
        ociSha256: validateSha256Hex(metadata.ociSha256, 'OCI archive SHA-256'),
        platform: stringValue(metadata.platform, 'Artifact platform'),
        pullRequestNumber: parsePositiveInteger(
            metadata.pullRequestNumber,
            'Artifact pull request number',
        ),
        repository: normalizeRepository(metadata.repository),
        runAttempt: parsePositiveInteger(metadata.runAttempt, 'Artifact run attempt'),
        runId: parsePositiveInteger(metadata.runId, 'Artifact run ID'),
        schemaVersion: 1,
        testedSha: validateFullSha(metadata.testedSha, 'Artifact tested SHA'),
        triggerRunId: parsePositiveInteger(metadata.triggerRunId, 'Artifact trigger run ID'),
    }
}

async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
}

async function readArtifactDirectory(artifactDirectory: string): Promise<PreviewArtifactMetadata> {
    const entries = await readdir(artifactDirectory, { withFileTypes: true })
    const names = entries.map((entry) => entry.name).toSorted()
    if (names.join('\0') !== 'metadata.json\0preview-image.tar') {
        throw new Error('OCI artifact contains unexpected files.')
    }
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
        throw new Error('OCI artifact entries must be regular files.')
    }

    const metadataPath = `${artifactDirectory}/metadata.json`
    const archivePath = `${artifactDirectory}/preview-image.tar`
    const [metadataStat, archiveStat] = await Promise.all([lstat(metadataPath), lstat(archivePath)])
    if (!metadataStat.isFile() || metadataStat.size <= 0 || metadataStat.size > 64 * 1024) {
        throw new Error('Preview metadata size is invalid.')
    }
    if (
        !archiveStat.isFile() ||
        archiveStat.size <= 0 ||
        archiveStat.size > MAX_PREVIEW_ARTIFACT_BYTES
    ) {
        throw new Error('OCI archive size is invalid.')
    }

    const metadata = parsePreviewArtifactMetadata(
        JSON.parse(await readFile(metadataPath, 'utf8')) as unknown,
    )
    if ((await sha256File(archivePath)) !== metadata.ociSha256) {
        throw new Error('OCI archive checksum does not match metadata.')
    }
    return metadata
}

async function validateArtifactDirectory(expectation: ArtifactExpectation): Promise<void> {
    const metadata = await readArtifactDirectory(expectation.artifactDirectory)
    const expectedValues: Readonly<Record<keyof PreviewArtifactMetadata, unknown>> = {
        artifactName: PREVIEW_ARTIFACT_NAME,
        baseSha: expectation.baseSha,
        createdAt: metadata.createdAt,
        headRepository: expectation.headRepository,
        headSha: expectation.headSha,
        ociSha256: metadata.ociSha256,
        platform: PREVIEW_PLATFORM,
        pullRequestNumber: expectation.number,
        repository: expectation.baseRepository,
        runAttempt: expectation.runAttempt,
        runId: expectation.runId,
        schemaVersion: 1,
        testedSha: expectation.testedSha,
        triggerRunId: expectation.triggerRunId,
    }
    for (const key of metadataKeys) {
        if (metadata[key] !== expectedValues[key]) {
            throw new Error(`Preview artifact metadata mismatch: ${key}.`)
        }
    }
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
    const api = new GitHubApi(expected.baseRepository, environment('GITHUB_TOKEN'))
    await verifyGate(api, expected, false)
}

function parsePreviewComment(value: unknown): PreviewComment {
    const comment = asRecord(value, 'Pull request comment')
    const user = asRecord(comment.user, 'Pull request comment user')
    return {
        body: nullableString(comment.body, 'Pull request comment body'),
        id: parsePositiveInteger(comment.id, 'Pull request comment ID'),
        userLogin: stringValue(user.login, 'Pull request comment login'),
        userType: stringValue(user.type, 'Pull request comment user type'),
    }
}

async function upsertPreviewComment(
    api: GitHubApi,
    pullRequestNumber: number,
    body: string,
): Promise<void> {
    const comments = (
        await api.arrayPages(`/repos/${api.repository}/issues/${pullRequestNumber}/comments`)
    ).map(parsePreviewComment)
    const existing = selectPreviewComment(comments)
    if (existing) {
        await api.request(`/repos/${api.repository}/issues/comments/${existing.id}`, {
            body: { body },
            method: 'PATCH',
        })
        console.log(`Updated PR preview comment ${existing.id}.`)
        return
    }
    await api.request(`/repos/${api.repository}/issues/${pullRequestNumber}/comments`, {
        body: { body },
        method: 'POST',
    })
    console.log('Created PR preview comment.')
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

async function runCommand(): Promise<void> {
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
        case 'comment':
            await commandComment()
            return
        default:
            throw new Error('Unknown PR preview command.')
    }
}

if (import.meta.main) {
    runCommand().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown PR preview failure.'
        console.error(message.replace(/[\r\n\0]/gu, ' '))
        process.exitCode = 1
    })
}
