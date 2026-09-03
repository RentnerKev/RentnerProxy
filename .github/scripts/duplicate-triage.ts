import { readFile } from 'node:fs/promises'

export const COMMENT_MARKER = '<!-- rentnerproxy-duplicate-triage -->'
export const POSSIBLE_DUPLICATE_THRESHOLD = 0.9
export const RELATED_THRESHOLD = 0.72
export const MAX_DISPLAYED_MATCHES = 5

const OWNED_LABEL_MARKER_PREFIX = '<!-- rentnerproxy-duplicate-triage-owned-labels:'
const MAX_INPUT_CHARACTERS = 200_000
const MAX_TOKENS = 2_048
const CLOSED_CANDIDATE_DAYS = 3 * 365
const PR_FILE_PREFILTER_LIMIT = 25
const FILE_REQUEST_CONCURRENCY = 4
const TEXT_CONTAINMENT_STRENGTH = 0.7
const STRONG_TECHNICAL_ANCHOR_STRENGTH = 0.4
const AUTOMATION_LABELS = new Set(['possible-duplicate', 'related'])
const SKIP_LABELS = new Set(['no-triage', 'skip-automation', 'no-duplicate-check'])
const NON_SCORING_LABELS = new Set([...AUTOMATION_LABELS, ...SKIP_LABELS, 'duplicate'])

const STOP_WORDS = new Set([
    'a',
    'add',
    'additional',
    'an',
    'and',
    'after',
    'are',
    'as',
    'at',
    'be',
    'been',
    'bug',
    'by',
    'can',
    'change',
    'changes',
    'describe',
    'description',
    'do',
    'does',
    'feature',
    'fix',
    'for',
    'from',
    'has',
    'have',
    'how',
    'i',
    'implement',
    'in',
    'is',
    'issue',
    'it',
    'of',
    'on',
    'or',
    'please',
    'problem',
    'rentnerproxy',
    'should',
    'support',
    'that',
    'the',
    'this',
    'to',
    'was',
    'were',
    'what',
    'when',
    'with',
    'would',
    'you',
])

const TOKEN_ALIASES = new Map([
    ['certificates', 'certificate'],
    ['failed', 'fail'],
    ['failing', 'fail'],
    ['failures', 'fail'],
    ['fails', 'fail'],
    ['hosts', 'host'],
    ['redirected', 'redirect'],
    ['redirecting', 'redirect'],
    ['redirects', 'redirect'],
    ['renewal', 'renew'],
    ['renewals', 'renew'],
    ['renewed', 'renew'],
    ['renewing', 'renew'],
    ['renews', 'renew'],
    ['restarted', 'restart'],
    ['restarting', 'restart'],
    ['restarts', 'restart'],
])

const BOILERPLATE_LINES = new Set(
    [
        'Actual behavior',
        'Additional context',
        'Alternatives considered',
        'Affected area',
        'Affected component',
        'Breaking changes',
        'Browser',
        'Checklist',
        'Confirmation',
        'Contribution',
        'Deployment type',
        'Describe how the changes were tested.',
        'Description',
        'Environment',
        'Expected behavior',
        'I have added or updated tests where necessary.',
        'I have not committed secrets or sensitive data.',
        'I have not included unrelated changes.',
        'I have searched existing issues and confirmed that this has not already been reported.',
        'I have tested my changes.',
        'Documentation has been updated where necessary.',
        'Existing tests pass.',
        'Logs',
        'No response',
        'Operating system / environment',
        'Problem / motivation',
        'Proposed solution',
        'Related issue',
        'Relevant logs',
        'Reproduction steps',
        'Screenshots',
        'Steps to reproduce',
        'Summary',
        'Testing',
        'Type of change',
        'Version',
        'What changed?',
        'Willingness to contribute',
        'Why?',
    ].map((line) => boilerplateKey(line)),
)

export type TriageItemKind = 'issue' | 'pull_request'
export type TriageState = 'open' | 'closed'

export interface TriageItem {
    readonly kind: TriageItemKind
    readonly number: number
    readonly title: string
    readonly body: string
    readonly closedAt: string | null
    readonly labels: readonly string[]
    readonly state: TriageState
    readonly stateReason: string | null
    readonly merged: boolean
    readonly draft: boolean
    readonly updatedAt: string
    readonly revision: string
    readonly files: readonly string[]
    readonly linkedIssues: readonly number[]
}

export interface SimilarityBreakdown {
    readonly score: number
    readonly title: number
    readonly body: number
    readonly labels: number
    readonly fileOverlap: number
    readonly sharedLinkedIssues: readonly number[]
}

export interface CandidateMatch {
    readonly item: TriageItem
    readonly similarity: SimilarityBreakdown
}

export interface ManagedComment {
    readonly id: number
    readonly body: string
}

export interface CommentWriter {
    createComment(body: string): Promise<void>
    updateComment(commentId: number, body: string): Promise<void>
    deleteComment(commentId: number): Promise<void>
}

interface GitHubLabel {
    readonly name: string
}

interface GitHubIssue {
    readonly number: number
    readonly title: string
    readonly body: string | null
    readonly state: string
    readonly state_reason?: string | null
    readonly closed_at: string | null
    readonly updated_at: string
    readonly labels: readonly (string | GitHubLabel)[]
    readonly pull_request?: unknown
}

interface GitHubPullRequest {
    readonly number: number
    readonly title: string
    readonly body: string | null
    readonly state: string
    readonly updated_at: string
    readonly closed_at: string | null
    readonly merged_at: string | null
    readonly draft: boolean
    readonly labels: readonly (string | GitHubLabel)[]
    readonly head: { readonly sha: string }
    readonly base: { readonly sha: string }
}

interface GitHubPullRequestFile {
    readonly filename: string
}

interface GitHubIssueComment {
    readonly id: number
    readonly body: string | null
    readonly user: { readonly login: string } | null
}

interface GitHubTimelineEvent {
    readonly event?: string
    readonly created_at?: string
}

interface EventPayload {
    readonly action?: unknown
    readonly issue?: { readonly number?: unknown }
    readonly pull_request?: { readonly number?: unknown }
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function clampScore(value: number): number {
    if (!Number.isFinite(value)) {
        return 0
    }
    return Math.min(1, Math.max(0, value))
}

function boilerplateKey(value: string): string {
    return value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/^\s{0,3}#{1,6}\s*/u, '')
        .replace(/^\s*[-*]\s+\[[ x]\]\s*/u, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

function proseWithoutFencedCode(value: string): string {
    const output: string[] = []
    let insideFence = false

    for (const line of value.split(/\r?\n/u)) {
        if (/^\s*(?:`{3,}|~{3,})/u.test(line)) {
            insideFence = !insideFence
            continue
        }
        if (!insideFence) {
            output.push(line)
        }
    }

    return output.join('\n')
}

function normalizeToken(token: string): string {
    return TOKEN_ALIASES.get(token) ?? token
}

export function normalizeText(value: string | null | undefined): readonly string[] {
    if (typeof value !== 'string' || value.length === 0) {
        return []
    }

    const bounded = value.slice(0, MAX_INPUT_CHARACTERS).normalize('NFKC')
    const prose = proseWithoutFencedCode(bounded)
        .replace(/<!--[\s\S]*?-->/gu, ' ')
        .replace(/\[([^\]\r\n]{0,500})\]\([^\r\n)]{0,2048}\)/gu, '$1')
        .replace(/<https?:\/\/[^>\s]+>/giu, ' ')
        .replace(/\bhttps?:\/\/[^\s<>()]+/giu, ' ')

    const meaningfulLines = prose.split(/\r?\n/u).filter((line) => {
        if (/^\s*[-*]\s+\[[ xX]\]/u.test(line)) {
            return false
        }
        return !BOILERPLATE_LINES.has(boilerplateKey(line))
    })

    const tokens: string[] = []
    const tokenPattern = /[\p{L}\p{N}]+(?:[._+-][\p{L}\p{N}]+)*/gu
    const normalized = meaningfulLines.join(' ').toLowerCase()

    for (const match of normalized.matchAll(tokenPattern)) {
        const rawToken = match[0]
        const token = normalizeToken(rawToken)
        if (token.length < 2 || STOP_WORDS.has(token)) {
            continue
        }
        tokens.push(token)
        if (tokens.length >= MAX_TOKENS) {
            break
        }
    }

    return tokens
}

function toSet(values: Iterable<string>): Set<string> {
    return values instanceof Set ? values : new Set(values)
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
    const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left]
    let intersection = 0
    for (const value of smaller) {
        if (larger.has(value)) {
            intersection += 1
        }
    }
    return intersection
}

export function jaccardSimilarity(
    leftValues: Iterable<string>,
    rightValues: Iterable<string>,
): number {
    const left = toSet(leftValues)
    const right = toSet(rightValues)
    if (left.size === 0 || right.size === 0) {
        return 0
    }
    const intersection = intersectionSize(left, right)
    return intersection / (left.size + right.size - intersection)
}

export function diceSimilarity(
    leftValues: Iterable<string>,
    rightValues: Iterable<string>,
): number {
    const left = toSet(leftValues)
    const right = toSet(rightValues)
    if (left.size === 0 || right.size === 0) {
        return 0
    }
    return (2 * intersectionSize(left, right)) / (left.size + right.size)
}

export function textSimilarity(left: string | null, right: string | null): number {
    const leftTokens = normalizeText(left)
    const rightTokens = normalizeText(right)
    if (leftTokens.length === 0 || rightTokens.length === 0) {
        return 0
    }

    const leftSet = new Set(leftTokens)
    const rightSet = new Set(rightTokens)
    const sharedTokenCount = intersectionSize(leftSet, rightSet)
    const jaccard = jaccardSimilarity(leftSet, rightSet)
    const dice = diceSimilarity(leftSet, rightSet)
    const averageOverlap = (jaccard + dice) / 2
    const containment = sharedTokenCount / Math.min(leftSet.size, rightSet.size)
    let score = clampScore(
        averageOverlap + (1 - averageOverlap) * containment * TEXT_CONTAINMENT_STRENGTH,
    )
    if (sharedTokenCount >= 4) {
        score = clampScore(score + (1 - score) * STRONG_TECHNICAL_ANCHOR_STRENGTH)
    }
    return score
}

function scoringLabels(labels: readonly string[]): Set<string> {
    return new Set(
        labels
            .map((label) => label.trim().toLowerCase())
            .filter((label) => label !== '' && !NON_SCORING_LABELS.has(label)),
    )
}

export function labelSimilarity(left: readonly string[], right: readonly string[]): number {
    return jaccardSimilarity(scoringLabels(left), scoringLabels(right))
}

function normalizeFileSet(files: readonly string[]): Set<string> {
    return new Set(files.map((file) => file.trim()).filter((file) => file !== ''))
}

export function calculateFileOverlap(left: readonly string[], right: readonly string[]): number {
    return jaccardSimilarity(normalizeFileSet(left), normalizeFileSet(right))
}

export function extractLinkedIssueNumbers(
    body: string | null | undefined,
    repository: string,
): readonly number[] {
    if (typeof body !== 'string' || body.length === 0) {
        return []
    }

    const bounded = proseWithoutFencedCode(body.slice(0, MAX_INPUT_CHARACTERS)).replace(
        /<!--[\s\S]*?-->/gu,
        ' ',
    )
    const matches = new Set<number>()
    const pattern =
        /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?[ \t]*(?:([\w.-]+\/[\w.-]+))?#([1-9]\d*)\b/giu

    for (const match of bounded.matchAll(pattern)) {
        const qualifiedRepository = match[1]
        const issueNumber = Number(match[2])
        if (
            Number.isSafeInteger(issueNumber) &&
            issueNumber > 0 &&
            (qualifiedRepository === undefined ||
                qualifiedRepository.toLowerCase() === repository.toLowerCase())
        ) {
            matches.add(issueNumber)
        }
        if (matches.size >= 50) {
            break
        }
    }

    return [...matches].toSorted((left, right) => left - right)
}

function weightedTextSimilarity(
    left: TriageItem,
    right: TriageItem,
    titleWeight: number,
    bodyWeight: number,
): { readonly title: number; readonly body: number; readonly score: number } {
    const title = textSimilarity(left.title, right.title)
    const body = textSimilarity(left.body, right.body)
    const titleAvailable =
        normalizeText(left.title).length > 0 && normalizeText(right.title).length > 0
    const bodyAvailable =
        normalizeText(left.body).length > 0 && normalizeText(right.body).length > 0
    const activeWeight = (titleAvailable ? titleWeight : 0) + (bodyAvailable ? bodyWeight : 0)
    const score =
        activeWeight === 0
            ? 0
            : ((titleAvailable ? title * titleWeight : 0) +
                  (bodyAvailable ? body * bodyWeight : 0)) /
              activeWeight

    return { body, score: clampScore(score), title }
}

function sharedNumbers(left: readonly number[], right: readonly number[]): readonly number[] {
    const rightSet = new Set(right)
    return [...new Set(left)].filter((value) => rightSet.has(value)).toSorted((a, b) => a - b)
}

function addPositiveSignal(currentScore: number, signal: number, strength: number): number {
    return clampScore(1 - (1 - currentScore) * (1 - clampScore(signal) * strength))
}

export function calculateIssueSimilarity(
    current: TriageItem,
    candidate: TriageItem,
): SimilarityBreakdown {
    const text = weightedTextSimilarity(current, candidate, 0.7, 0.3)
    const labels = labelSimilarity(current.labels, candidate.labels)
    const score = addPositiveSignal(text.score, labels, 0.08)

    return {
        body: text.body,
        fileOverlap: 0,
        labels,
        score,
        sharedLinkedIssues: [],
        title: text.title,
    }
}

export function calculatePullRequestSimilarity(
    current: TriageItem,
    candidate: TriageItem,
): SimilarityBreakdown {
    const text = weightedTextSimilarity(current, candidate, 0.72, 0.28)
    const labels = labelSimilarity(current.labels, candidate.labels)
    const fileOverlap = calculateFileOverlap(current.files, candidate.files)
    const linkedIssues = sharedNumbers(current.linkedIssues, candidate.linkedIssues)

    let score = addPositiveSignal(text.score, labels, 0.05)
    score = addPositiveSignal(score, fileOverlap, 0.35)
    if (linkedIssues.length > 0) {
        score = addPositiveSignal(score, 1, 0.75)
    }

    return {
        body: text.body,
        fileOverlap,
        labels,
        score,
        sharedLinkedIssues: linkedIssues,
        title: text.title,
    }
}

export function classifySimilarity(score: number): 'high' | 'related' | 'none' {
    if (score >= POSSIBLE_DUPLICATE_THRESHOLD) {
        return 'high'
    }
    if (score >= RELATED_THRESHOLD) {
        return 'related'
    }
    return 'none'
}

function candidateIsOpen(match: CandidateMatch): boolean {
    return match.item.state === 'open'
}

function deduplicateCandidates(
    current: TriageItem,
    candidates: readonly TriageItem[],
): readonly TriageItem[] {
    const candidatesByNumber = new Map<number, TriageItem>()
    for (const candidate of candidates) {
        if (candidate.kind !== current.kind || candidate.number === current.number) {
            continue
        }
        const existing = candidatesByNumber.get(candidate.number)
        const candidateUpdatedAt = Date.parse(candidate.updatedAt)
        const existingUpdatedAt =
            existing === undefined ? Number.NEGATIVE_INFINITY : Date.parse(existing.updatedAt)
        if (
            existing === undefined ||
            candidateUpdatedAt > existingUpdatedAt ||
            (candidateUpdatedAt === existingUpdatedAt && candidate.state === 'open')
        ) {
            candidatesByNumber.set(candidate.number, candidate)
        }
    }
    return [...candidatesByNumber.values()]
}

export function rankCandidates(
    current: TriageItem,
    candidates: readonly TriageItem[],
    minimumScore = RELATED_THRESHOLD,
    limit = MAX_DISPLAYED_MATCHES,
): readonly CandidateMatch[] {
    return deduplicateCandidates(current, candidates)
        .map((item) => ({
            item,
            similarity:
                current.kind === 'issue'
                    ? calculateIssueSimilarity(current, item)
                    : calculatePullRequestSimilarity(current, item),
        }))
        .filter((match) => match.similarity.score >= minimumScore)
        .toSorted((left, right) => {
            const scoreDifference = right.similarity.score - left.similarity.score
            if (scoreDifference !== 0) {
                return scoreDifference
            }
            const openDifference = Number(candidateIsOpen(right)) - Number(candidateIsOpen(left))
            if (openDifference !== 0) {
                return openDifference
            }
            const updatedDifference =
                Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt)
            if (Number.isFinite(updatedDifference) && updatedDifference !== 0) {
                return updatedDifference
            }
            return right.item.number - left.item.number
        })
        .slice(0, Math.max(0, limit))
}

function escapeMarkdownText(value: string): string {
    return value
        .slice(0, 180)
        .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
        .replace(/\s{2,}/gu, ' ')
        .trim()
        .replace(/&/gu, '&amp;')
        .replace(/\\/gu, '&#92;')
        .replace(/@/gu, '&#64;')
        .replace(/\|/gu, '&#124;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/`/gu, '&#96;')
        .replace(/\*/gu, '&#42;')
        .replace(/_/gu, '&#95;')
        .replace(/~/gu, '&#126;')
        .replace(/\[/gu, '&#91;')
        .replace(/\]/gu, '&#93;')
        .replace(/\(/gu, '&#40;')
        .replace(/\)/gu, '&#41;')
}

function statusText(item: TriageItem): string {
    if (item.merged) {
        return 'MERGED'
    }
    if (item.state === 'open') {
        return 'OPEN'
    }

    const terminalLabel = item.labels.find((label) =>
        ['duplicate', 'invalid', 'wontfix'].includes(label.toLowerCase()),
    )
    const reason = item.stateReason ?? terminalLabel ?? ''
    if (reason === '') {
        return 'CLOSED'
    }
    return `CLOSED · ${reason.replaceAll('_', ' ').toUpperCase()}`
}

function repositoryWebPath(repository: string): string {
    return repository
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
}

function itemLink(repository: string, item: TriageItem): string {
    const resource = item.kind === 'issue' ? 'issues' : 'pull'
    return `https://github.com/${repositoryWebPath(repository)}/${resource}/${item.number}`
}

function linkedIssueMarkdown(repository: string, numbers: readonly number[]): string {
    if (numbers.length === 0) {
        return '—'
    }
    return numbers
        .slice(0, 3)
        .map(
            (number) =>
                `[#${number}](https://github.com/${repositoryWebPath(repository)}/issues/${number})`,
        )
        .join(', ')
}

function ownedLabelMarker(ownedLabels: ReadonlySet<string>): string {
    const labels = [...ownedLabels]
        .filter((label) => AUTOMATION_LABELS.has(label))
        .toSorted()
        .join(',')
    return `${OWNED_LABEL_MARKER_PREFIX}${labels === '' ? 'none' : labels} -->`
}

export function parseOwnedLabels(commentBody: string): ReadonlySet<string> {
    const markerPattern = /<!-- rentnerproxy-duplicate-triage-owned-labels:([^\r\n]*?) -->/u
    const marker = markerPattern.exec(commentBody)
    if (marker?.[1] === undefined || marker[1] === 'none') {
        return new Set()
    }
    return new Set(
        marker[1]
            .split(',')
            .map((label) => label.trim().toLowerCase())
            .filter((label) => AUTOMATION_LABELS.has(label)),
    )
}

export function renderDuplicateComment(
    currentKind: TriageItemKind,
    matches: readonly CandidateMatch[],
    repository: string,
    ownedLabels: ReadonlySet<string> = new Set(),
): string {
    const lines = [COMMENT_MARKER, ownedLabelMarker(ownedLabels), '']

    if (currentKind === 'issue') {
        lines.push(
            '## 🔍 Similar issues found',
            '',
            'This issue may overlap with existing reports. Please take a look at these related items.',
            '',
            '| Match | Issue | Status |',
            '| --- | --- | --- |',
        )
        for (const match of matches) {
            const matchText =
                classifySimilarity(match.similarity.score) === 'high' ? 'High' : 'Medium'
            const title = escapeMarkdownText(match.item.title)
            lines.push(
                `| ${matchText} | [#${match.item.number} – ${title}](${itemLink(repository, match.item)}) | ${statusText(match.item)} |`,
            )
        }
        lines.push(
            '',
            '> This is an automated suggestion. This issue has **not** been closed automatically.',
        )
    } else {
        lines.push(
            '## 🔍 Similar pull requests',
            '',
            'This pull request may overlap with existing work. Please take a look at these related items.',
            '',
            '| Match | Pull request | Status | File overlap | Shared linked issue |',
            '| --- | --- | --- | --- | --- |',
        )
        for (const match of matches) {
            const matchText =
                classifySimilarity(match.similarity.score) === 'high' ? 'High' : 'Medium'
            const title = escapeMarkdownText(match.item.title)
            const fileOverlap = `${Math.round(match.similarity.fileOverlap * 100)}%`
            lines.push(
                `| ${matchText} | [#${match.item.number} – ${title}](${itemLink(repository, match.item)}) | ${statusText(match.item)} | ${fileOverlap} | ${linkedIssueMarkdown(repository, match.similarity.sharedLinkedIssues)} |`,
            )
        }
        lines.push(
            '',
            '> This is an automated suggestion. No pull request has been closed or merged automatically.',
        )
    }

    return `${lines.join('\n')}\n`
}

export async function upsertManagedComment(
    writer: CommentWriter,
    comments: readonly ManagedComment[],
    body: string,
): Promise<void> {
    const sortedComments = comments.toSorted((left, right) => left.id - right.id)
    const primary = sortedComments[0]
    if (primary === undefined) {
        await writer.createComment(body)
        return
    }

    if (primary.body !== body) {
        await writer.updateComment(primary.id, body)
    }

    for (const duplicateComment of sortedComments.slice(1)) {
        // Marker-owned duplicates are safe to remove and keeping one avoids edit-event spam.
        // eslint-disable-next-line no-await-in-loop
        await writer.deleteComment(duplicateComment.id)
    }
}

export function hasActiveDuplicateTimeline(events: readonly GitHubTimelineEvent[]): boolean {
    let markedAsDuplicate = false
    const sortedEvents = events.toSorted((left, right) =>
        String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')),
    )
    for (const event of sortedEvents) {
        if (event.event === 'marked_as_duplicate') {
            markedAsDuplicate = true
        } else if (event.event === 'unmarked_as_duplicate') {
            markedAsDuplicate = false
        }
    }
    return markedAsDuplicate
}

function hasNextPage(linkHeader: string | null): boolean {
    return linkHeader?.split(',').some((link) => /;\s*rel="next"\s*$/u.test(link.trim())) ?? false
}

function validateRepository(repository: string): readonly [string, string] {
    const segments = repository.split('/')
    const owner = segments[0]
    const name = segments[1]
    const validSegment = /^[A-Za-z0-9_.-]+$/u
    if (
        segments.length !== 2 ||
        owner === undefined ||
        name === undefined ||
        !validSegment.test(owner) ||
        !validSegment.test(name)
    ) {
        throw new Error('GITHUB_REPOSITORY must contain a valid owner and repository name')
    }
    return [owner, name]
}

class GitHubTriageClient implements CommentWriter {
    readonly #repositoryPath: string
    readonly #token: string
    readonly #fetch: FetchImplementation
    readonly #apiBase: URL
    #itemNumber = 0

    constructor(
        repository: string,
        token: string,
        apiUrl: string,
        fetchImplementation: FetchImplementation = fetch,
    ) {
        if (token.trim() === '') {
            throw new Error('GITHUB_TOKEN is required')
        }
        const [owner, name] = validateRepository(repository)
        const apiBase = new URL(apiUrl)
        if (apiBase.protocol !== 'https:') {
            throw new Error('GITHUB_API_URL must use HTTPS')
        }
        this.#repositoryPath = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
        this.#token = token
        this.#fetch = fetchImplementation
        this.#apiBase = apiBase
    }

    setItemNumber(itemNumber: number): void {
        this.#itemNumber = itemNumber
    }

    #url(endpoint: string, parameters: Readonly<Record<string, string>> = {}): URL {
        const base = this.#apiBase.toString().replace(/\/$/u, '')
        const url = new URL(`${base}/repos/${this.#repositoryPath}/${endpoint}`)
        for (const [name, value] of Object.entries(parameters)) {
            url.searchParams.set(name, value)
        }
        return url
    }

    async #request<T>(
        endpoint: string,
        method = 'GET',
        body?: unknown,
        allowNotFound = false,
    ): Promise<T> {
        const url = this.#url(endpoint)
        const request: RequestInit = {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${this.#token}`,
                'User-Agent': 'RentnerProxy-duplicate-triage',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            method,
        }
        if (body !== undefined) {
            request.body = JSON.stringify(body)
            ;(request.headers as Record<string, string>)['Content-Type'] = 'application/json'
        }

        let response: Response
        try {
            response = await this.#fetch(url, request)
        } catch (error) {
            throw new Error(`GitHub API unavailable while requesting ${endpoint}`, { cause: error })
        }

        if (allowNotFound && response.status === 404) {
            return undefined as T
        }
        if (!response.ok) {
            const requestId = response.headers.get('x-github-request-id')
            const requestSuffix = requestId === null ? '' : ` (request ${requestId})`
            throw new Error(
                `GitHub API request for ${endpoint} failed with HTTP ${response.status}${requestSuffix}`,
            )
        }
        if (response.status === 204) {
            return undefined as T
        }
        const payload: unknown = await response.json()
        return payload as T
    }

    async #paginate<T>(
        endpoint: string,
        parameters: Readonly<Record<string, string>> = {},
        stopAfterPage?: (page: readonly T[]) => boolean,
    ): Promise<T[]> {
        const results: T[] = []
        let pageNumber = 1

        while (true) {
            const url = this.#url(endpoint, {
                ...parameters,
                page: String(pageNumber),
                per_page: '100',
            })
            let response: Response
            try {
                // Pagination is serial because the Link header determines completeness.
                // eslint-disable-next-line no-await-in-loop
                response = await this.#fetch(url, {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        Authorization: `Bearer ${this.#token}`,
                        'User-Agent': 'RentnerProxy-duplicate-triage',
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                })
            } catch (error) {
                throw new Error(`GitHub API unavailable while paginating ${endpoint}`, {
                    cause: error,
                })
            }
            if (!response.ok) {
                const requestId = response.headers.get('x-github-request-id')
                const requestSuffix = requestId === null ? '' : ` (request ${requestId})`
                throw new Error(
                    `GitHub API pagination for ${endpoint} failed with HTTP ${response.status}${requestSuffix}`,
                )
            }
            // eslint-disable-next-line no-await-in-loop
            const payload: unknown = await response.json()
            if (!Array.isArray(payload)) {
                throw new Error(`GitHub API returned invalid pagination data for ${endpoint}`)
            }
            const page = payload as T[]
            results.push(...page)
            if (stopAfterPage?.(page) === true || !hasNextPage(response.headers.get('link'))) {
                return results
            }
            pageNumber += 1
        }
    }

    getIssue(number: number): Promise<GitHubIssue> {
        return this.#request<GitHubIssue>(`issues/${number}`)
    }

    getPullRequest(number: number): Promise<GitHubPullRequest> {
        return this.#request<GitHubPullRequest>(`pulls/${number}`)
    }

    listIssues(state: TriageState, since?: string): Promise<GitHubIssue[]> {
        const parameters: Record<string, string> = {
            direction: 'desc',
            sort: 'updated',
            state,
        }
        if (since !== undefined) {
            parameters.since = since
        }
        return this.#paginate<GitHubIssue>('issues', parameters)
    }

    listOpenPullRequests(): Promise<GitHubPullRequest[]> {
        return this.#paginate<GitHubPullRequest>('pulls', {
            direction: 'desc',
            sort: 'updated',
            state: 'open',
        })
    }

    async listClosedPullRequestsSince(since: string): Promise<GitHubPullRequest[]> {
        const cutoff = Date.parse(since)
        const pullRequests = await this.#paginate<GitHubPullRequest>(
            'pulls',
            { direction: 'desc', sort: 'updated', state: 'closed' },
            (page) => {
                const oldest = page[page.length - 1]
                return oldest !== undefined && Date.parse(oldest.updated_at) < cutoff
            },
        )
        return pullRequests.filter((pullRequest) => Date.parse(pullRequest.updated_at) >= cutoff)
    }

    listPullRequestFiles(number: number): Promise<GitHubPullRequestFile[]> {
        return this.#paginate<GitHubPullRequestFile>(`pulls/${number}/files`)
    }

    listComments(): Promise<GitHubIssueComment[]> {
        return this.#paginate<GitHubIssueComment>(`issues/${this.#itemNumber}/comments`)
    }

    listRepositoryLabels(): Promise<GitHubLabel[]> {
        return this.#paginate<GitHubLabel>('labels')
    }

    listTimeline(): Promise<GitHubTimelineEvent[]> {
        return this.#paginate<GitHubTimelineEvent>(`issues/${this.#itemNumber}/timeline`)
    }

    async createComment(body: string): Promise<void> {
        await this.#request(`issues/${this.#itemNumber}/comments`, 'POST', { body })
    }

    async updateComment(commentId: number, body: string): Promise<void> {
        await this.#request(`issues/comments/${commentId}`, 'PATCH', { body })
    }

    async deleteComment(commentId: number): Promise<void> {
        await this.#request(`issues/comments/${commentId}`, 'DELETE', undefined, true)
    }

    async addLabel(label: string): Promise<void> {
        await this.#request(`issues/${this.#itemNumber}/labels`, 'POST', { labels: [label] })
    }

    async removeLabel(label: string): Promise<void> {
        await this.#request(
            `issues/${this.#itemNumber}/labels/${encodeURIComponent(label)}`,
            'DELETE',
            undefined,
            true,
        )
    }
}

function labelsFromApi(labels: readonly (string | GitHubLabel)[]): readonly string[] {
    return labels
        .map((label) => (typeof label === 'string' ? label : label.name))
        .filter((label) => typeof label === 'string' && label.trim() !== '')
}

function boundedText(value: string | null): string {
    return typeof value === 'string' ? value.slice(0, MAX_INPUT_CHARACTERS) : ''
}

function issueToTriageItem(issue: GitHubIssue): TriageItem {
    return {
        body: boundedText(issue.body),
        closedAt: issue.closed_at,
        draft: false,
        files: [],
        kind: 'issue',
        labels: labelsFromApi(issue.labels),
        linkedIssues: [],
        merged: false,
        number: issue.number,
        revision: '',
        state: issue.state === 'open' ? 'open' : 'closed',
        stateReason: issue.state_reason ?? null,
        title: boundedText(issue.title),
        updatedAt: issue.updated_at,
    }
}

function pullRequestToTriageItem(
    pullRequest: GitHubPullRequest,
    repository: string,
    files: readonly string[] = [],
): TriageItem {
    const body = boundedText(pullRequest.body)
    return {
        body,
        closedAt: pullRequest.closed_at,
        draft: pullRequest.draft,
        files,
        kind: 'pull_request',
        labels: labelsFromApi(pullRequest.labels),
        linkedIssues: extractLinkedIssueNumbers(body, repository),
        merged: pullRequest.merged_at !== null,
        number: pullRequest.number,
        revision: `${pullRequest.base.sha}:${pullRequest.head.sha}`,
        state: pullRequest.state === 'open' ? 'open' : 'closed',
        stateReason: null,
        title: boundedText(pullRequest.title),
        updatedAt: pullRequest.updated_at,
    }
}

function itemFingerprint(item: TriageItem): string {
    return JSON.stringify({
        body: item.body,
        closedAt: item.closedAt,
        draft: item.draft,
        labels: item.labels.map((label) => label.toLowerCase()).toSorted(),
        merged: item.merged,
        revision: item.revision,
        state: item.state,
        stateReason: item.stateReason,
        title: item.title,
    })
}

function managedComments(comments: readonly GitHubIssueComment[]): readonly ManagedComment[] {
    return comments
        .filter(
            (comment) =>
                comment.user?.login === 'github-actions[bot]' &&
                (comment.body ?? '').startsWith(`${COMMENT_MARKER}\n${OWNED_LABEL_MARKER_PREFIX}`),
        )
        .map((comment) => ({ body: comment.body ?? '', id: comment.id }))
}

function ownedLabelsFromComments(comments: readonly ManagedComment[]): ReadonlySet<string> {
    const labels = new Set<string>()
    for (const comment of comments) {
        for (const label of parseOwnedLabels(comment.body)) {
            labels.add(label)
        }
    }
    return labels
}

function labelMap(labels: readonly string[]): Map<string, string> {
    return new Map(labels.map((label) => [label.toLowerCase(), label]))
}

function shouldSkipAutomation(item: TriageItem, timeline: readonly GitHubTimelineEvent[]): boolean {
    const labels = new Set(item.labels.map((label) => label.toLowerCase()))
    return (
        labels.has('duplicate') ||
        [...SKIP_LABELS].some((label) => labels.has(label)) ||
        hasActiveDuplicateTimeline(timeline)
    )
}

async function cleanupManagedState(
    client: GitHubTriageClient,
    current: TriageItem,
    comments: readonly ManagedComment[],
): Promise<void> {
    const currentLabels = labelMap(current.labels)
    for (const ownedLabel of ownedLabelsFromComments(comments)) {
        const actualLabel = currentLabels.get(ownedLabel)
        if (actualLabel !== undefined) {
            // Only labels recorded as workflow-owned in its own bot comment are removed.
            // eslint-disable-next-line no-await-in-loop
            await client.removeLabel(actualLabel)
        }
    }
    for (const comment of comments) {
        // Only github-actions[bot] comments with the exact marker reach this function.
        // eslint-disable-next-line no-await-in-loop
        await client.deleteComment(comment.id)
    }
}

function candidateCutoff(now = Date.now()): string {
    return new Date(now - CLOSED_CANDIDATE_DAYS * 24 * 60 * 60 * 1_000).toISOString()
}

async function mapWithConcurrency<T, Result>(
    values: readonly T[],
    concurrency: number,
    mapper: (value: T) => Promise<Result>,
): Promise<Result[]> {
    const results: Result[] = []
    let nextIndex = 0
    const workers = Array.from(
        { length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) },
        async () => {
            while (true) {
                const index = nextIndex
                nextIndex += 1
                if (index >= values.length) {
                    return
                }
                const value = values[index]
                if (value === undefined) {
                    return
                }
                // The bounded worker pool deliberately awaits one API request at a time.
                // eslint-disable-next-line no-await-in-loop
                results[index] = await mapper(value)
            }
        },
    )
    await Promise.all(workers)
    return results
}

async function loadCurrentItem(
    client: GitHubTriageClient,
    kind: TriageItemKind,
    number: number,
    repository: string,
): Promise<TriageItem> {
    if (kind === 'issue') {
        return issueToTriageItem(await client.getIssue(number))
    }
    return pullRequestToTriageItem(await client.getPullRequest(number), repository)
}

async function findIssueCandidates(
    client: GitHubTriageClient,
    cutoff: string,
): Promise<readonly TriageItem[]> {
    const [openIssues, closedIssues] = await Promise.all([
        client.listIssues('open'),
        client.listIssues('closed', cutoff),
    ])
    return [...openIssues, ...closedIssues]
        .filter((issue) => issue.pull_request === undefined)
        .filter(
            (issue) =>
                issue.state === 'open' ||
                (issue.closed_at !== null && Date.parse(issue.closed_at) >= Date.parse(cutoff)),
        )
        .map((issue) => issueToTriageItem(issue))
}

async function findPullRequestCandidates(
    client: GitHubTriageClient,
    cutoff: string,
    repository: string,
): Promise<readonly TriageItem[]> {
    const [openPullRequests, closedPullRequests] = await Promise.all([
        client.listOpenPullRequests(),
        client.listClosedPullRequestsSince(cutoff),
    ])
    return [...openPullRequests, ...closedPullRequests]
        .filter(
            (pullRequest) =>
                pullRequest.state === 'open' ||
                (pullRequest.closed_at !== null &&
                    Date.parse(pullRequest.closed_at) >= Date.parse(cutoff)),
        )
        .map((pullRequest) => pullRequestToTriageItem(pullRequest, repository))
}

async function scorePullRequestCandidates(
    client: GitHubTriageClient,
    current: TriageItem,
    candidates: readonly TriageItem[],
): Promise<readonly CandidateMatch[]> {
    const preliminary = rankCandidates(current, candidates, 0, PR_FILE_PREFILTER_LIMIT)
    const currentFiles = (await client.listPullRequestFiles(current.number)).map(
        (file) => file.filename,
    )
    const currentWithFiles: TriageItem = { ...current, files: currentFiles }
    const candidatesWithFiles = await mapWithConcurrency(
        preliminary.map((match) => match.item),
        FILE_REQUEST_CONCURRENCY,
        async (candidate) => {
            const files = (await client.listPullRequestFiles(candidate.number)).map(
                (file) => file.filename,
            )
            return { ...candidate, files }
        },
    )
    return rankCandidates(currentWithFiles, candidatesWithFiles)
}

function eventItemNumber(payload: EventPayload, kind: TriageItemKind): number {
    const value = kind === 'issue' ? payload.issue?.number : payload.pull_request?.number
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error('GitHub event payload does not contain a valid item number')
    }
    return value
}

function availableLabelMap(labels: readonly GitHubLabel[]): Map<string, string> {
    return new Map(labels.map((label) => [label.name.toLowerCase(), label.name]))
}

function desiredAutomationLabel(
    matches: readonly CandidateMatch[],
    availableLabels: ReadonlyMap<string, string>,
): string | null {
    const hasHighMatch = matches.some(
        (match) => match.similarity.score >= POSSIBLE_DUPLICATE_THRESHOLD,
    )
    if (hasHighMatch) {
        return availableLabels.get('possible-duplicate') ?? availableLabels.get('related') ?? null
    }
    return availableLabels.get('related') ?? null
}

async function reconcileMatches(
    client: GitHubTriageClient,
    current: TriageItem,
    matches: readonly CandidateMatch[],
    comments: readonly ManagedComment[],
    repositoryLabels: readonly GitHubLabel[],
    repository: string,
): Promise<void> {
    if (matches.length === 0) {
        await cleanupManagedState(client, current, comments)
        return
    }

    const availableLabels = availableLabelMap(repositoryLabels)
    const desiredLabel = desiredAutomationLabel(matches, availableLabels)
    const currentLabels = labelMap(current.labels)
    const previouslyOwned = ownedLabelsFromComments(comments)
    const nextOwned = new Set<string>()

    if (desiredLabel !== null) {
        const normalizedDesired = desiredLabel.toLowerCase()
        if (previouslyOwned.has(normalizedDesired) || !currentLabels.has(normalizedDesired)) {
            nextOwned.add(normalizedDesired)
        }
    }

    for (const oldOwnedLabel of previouslyOwned) {
        if (desiredLabel?.toLowerCase() !== oldOwnedLabel) {
            const actualLabel = currentLabels.get(oldOwnedLabel)
            if (actualLabel !== undefined) {
                // eslint-disable-next-line no-await-in-loop
                await client.removeLabel(actualLabel)
            }
        }
    }

    if (desiredLabel !== null && !currentLabels.has(desiredLabel.toLowerCase())) {
        await client.addLabel(desiredLabel)
    }

    const body = renderDuplicateComment(current.kind, matches, repository, nextOwned)
    await upsertManagedComment(client, comments, body)
}

async function runDuplicateTriage(): Promise<void> {
    const eventName = process.env.GITHUB_EVENT_NAME
    const repository = process.env.GITHUB_REPOSITORY ?? ''
    const token = process.env.GITHUB_TOKEN ?? ''
    const eventPath = process.env.GITHUB_EVENT_PATH ?? ''
    const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com'
    validateRepository(repository)

    if (eventPath === '') {
        throw new Error('GITHUB_EVENT_PATH is required')
    }
    const rawPayload: unknown = JSON.parse(await readFile(eventPath, 'utf8'))
    if (typeof rawPayload !== 'object' || rawPayload === null) {
        throw new Error('GitHub event payload must be an object')
    }
    const payload = rawPayload as EventPayload
    const kind: TriageItemKind =
        eventName === 'issues'
            ? 'issue'
            : eventName === 'pull_request_target'
              ? 'pull_request'
              : (() => {
                    throw new Error(`Unsupported GitHub event: ${String(eventName)}`)
                })()
    const number = eventItemNumber(payload, kind)
    const client = new GitHubTriageClient(repository, token, apiUrl)
    client.setItemNumber(number)

    const [initialCurrent, initialTimeline] = await Promise.all([
        loadCurrentItem(client, kind, number, repository),
        client.listTimeline(),
    ])
    if (
        initialCurrent.state === 'closed' ||
        shouldSkipAutomation(initialCurrent, initialTimeline)
    ) {
        const comments = managedComments(await client.listComments())
        await cleanupManagedState(client, initialCurrent, comments)
        console.info(`${kind} #${number}: closed, manual duplicate, or skip decision detected`)
        return
    }

    const cutoff = candidateCutoff()
    let matches: readonly CandidateMatch[]
    if (kind === 'issue') {
        const candidates = await findIssueCandidates(client, cutoff)
        matches = rankCandidates(initialCurrent, candidates)
    } else {
        const candidates = await findPullRequestCandidates(client, cutoff, repository)
        matches = await scorePullRequestCandidates(client, initialCurrent, candidates)
        if (initialCurrent.draft) {
            matches = matches.filter(
                (match) => match.similarity.score >= POSSIBLE_DUPLICATE_THRESHOLD,
            )
        }
    }

    for (const match of matches) {
        console.info(
            `${kind} #${number}: candidate #${match.item.number} score ${match.similarity.score.toFixed(2)}`,
        )
    }

    const [freshCurrent, freshTimeline, rawComments, repositoryLabels] = await Promise.all([
        loadCurrentItem(client, kind, number, repository),
        client.listTimeline(),
        client.listComments(),
        client.listRepositoryLabels(),
    ])
    const comments = managedComments(rawComments)
    if (freshCurrent.state === 'closed' || shouldSkipAutomation(freshCurrent, freshTimeline)) {
        await cleanupManagedState(client, freshCurrent, comments)
        console.info(`${kind} #${number}: closed, manual duplicate, or skip decision detected`)
        return
    }
    if (itemFingerprint(initialCurrent) !== itemFingerprint(freshCurrent)) {
        console.info(
            `${kind} #${number}: metadata changed during analysis; leaving state unchanged`,
        )
        return
    }

    await reconcileMatches(client, freshCurrent, matches, comments, repositoryLabels, repository)
    console.info(`${kind} #${number}: triage completed with ${matches.length} displayed matches`)
}

if (import.meta.main) {
    try {
        await runDuplicateTriage()
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Duplicate triage failed')
        process.exitCode = 1
    }
}
