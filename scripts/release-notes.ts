export type ReleaseChannel = 'dev' | 'stable'

export interface ReleaseCategory {
    title: string
    labels: readonly string[]
}

export interface ReleaseNotesConfig {
    excludedLabels: readonly string[]
    highlightLabels: readonly string[]
    categories: readonly ReleaseCategory[]
}

export interface GitHubRelease {
    id: number
    tag_name: string
    published_at: string | null
    prerelease: boolean
    draft: boolean
}

export interface GitHubMilestone {
    number: number
    title: string
}

export interface GitHubIssue {
    number: number
    title: string
    closed_at: string | null
    state_reason?: string | null
    labels: readonly (string | { name?: string | null })[]
    pull_request?: unknown
    user?: {
        login: string
        type?: string
    } | null
}

export interface CurrentRelease {
    id: number
    tagName: string
    prerelease: boolean
    publishedAt: string
}

export interface IssueWindow {
    publishedAt: string
    previousPublishedAt?: string
}

export interface ReleaseNotesDocumentInput {
    repository: string
    tagName: string
    channel: ReleaseChannel
    publishedAt: string
    image: string
    bannerAssetName: string
    issues: readonly GitHubIssue[]
    config: ReleaseNotesConfig
    previousTag?: string
    initialRelease: boolean
}

export interface RenderedReleaseNotes {
    body: string
    changelog: string
}

const VERSION_CORE = String.raw`(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)`
const PRERELEASE = String.raw`([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)`
const RELEASE_TAG_REGEXP = new RegExp(`^v${VERSION_CORE}(?:-${PRERELEASE})?$`)

function parseTimestamp(value: string, field: string): number {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) {
        throw new Error(`${field} must be a valid ISO 8601 timestamp`)
    }
    return timestamp
}

export function validateReleaseTag(tagName: string, prerelease: boolean): void {
    if (tagName.length > 128) {
        throw new Error("Release tag exceeds Docker's 128-character tag limit")
    }

    const match = RELEASE_TAG_REGEXP.exec(tagName)
    if (match === null) {
        throw new Error(
            'Release tag must be Docker-compatible SemVer with a leading v (for example v1.2.3 or v1.2.3-rc.1)',
        )
    }

    const prereleasePart = match[4]
    if (prereleasePart !== undefined) {
        for (const identifier of prereleasePart.split('.')) {
            if (
                /^[0-9]+$/.test(identifier) &&
                identifier.length > 1 &&
                identifier.startsWith('0')
            ) {
                throw new Error(
                    'Numeric SemVer prerelease identifiers must not contain leading zeroes',
                )
            }
        }
    }

    if (prerelease && prereleasePart === undefined) {
        throw new Error('A GitHub pre-release must use a SemVer prerelease tag')
    }
    if (!prerelease && prereleasePart !== undefined) {
        throw new Error('A stable GitHub release must not use a SemVer prerelease tag')
    }
}

export function validateRepository(repository: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)) {
        throw new Error('GITHUB_REPOSITORY must contain a valid owner/repository pair')
    }
}

export function findPreviousRelease(
    releases: readonly GitHubRelease[],
    current: CurrentRelease,
): GitHubRelease | undefined {
    const currentPublishedAt = parseTimestamp(current.publishedAt, 'Current release published_at')

    return releases
        .filter((release) => {
            if (
                release.draft ||
                release.id === current.id ||
                release.tag_name === current.tagName ||
                release.published_at === null
            ) {
                return false
            }
            if (!current.prerelease && release.prerelease) {
                return false
            }
            return parseTimestamp(release.published_at, 'Release published_at') < currentPublishedAt
        })
        .toSorted((left, right) => {
            const byDate =
                parseTimestamp(right.published_at ?? '', 'Release published_at') -
                parseTimestamp(left.published_at ?? '', 'Release published_at')
            return byDate === 0 ? right.id - left.id : byDate
        })[0]
}

function normalizeVersionTitle(value: string): string {
    return value.trim().replace(/^v/i, '').toLowerCase()
}

export function findMatchingMilestone(
    milestones: readonly GitHubMilestone[],
    tagName: string,
): GitHubMilestone | undefined {
    const exact = milestones.find((milestone) => milestone.title === tagName)
    if (exact !== undefined) {
        return exact
    }

    const normalizedTag = normalizeVersionTitle(tagName)
    return milestones.find((milestone) => normalizeVersionTitle(milestone.title) === normalizedTag)
}

function issueLabelNames(issue: GitHubIssue): string[] {
    return issue.labels
        .map((label) => (typeof label === 'string' ? label : label.name))
        .filter((label): label is string => typeof label === 'string')
        .map((label) => label.trim().toLowerCase())
}

function issueClosedTimestamp(issue: GitHubIssue): number | undefined {
    if (issue.closed_at === null) {
        return undefined
    }
    const timestamp = Date.parse(issue.closed_at)
    return Number.isFinite(timestamp) ? timestamp : undefined
}

export function filterIssues(
    issues: readonly GitHubIssue[],
    config: ReleaseNotesConfig,
    window: IssueWindow,
): GitHubIssue[] {
    const excludedLabels = new Set(config.excludedLabels.map((label) => label.trim().toLowerCase()))
    const publishedAt = parseTimestamp(window.publishedAt, 'published_at')
    const previousPublishedAt =
        window?.previousPublishedAt === undefined
            ? undefined
            : parseTimestamp(window.previousPublishedAt, 'previous published_at')
    const selected = new Map<number, GitHubIssue>()

    for (const issue of issues) {
        const closedAt = issueClosedTimestamp(issue)
        if (
            !Number.isInteger(issue.number) ||
            issue.number <= 0 ||
            closedAt === undefined ||
            'pull_request' in issue ||
            issue.state_reason?.toLowerCase() === 'not_planned'
        ) {
            continue
        }

        const labels = issueLabelNames(issue)
        if (labels.some((label) => excludedLabels.has(label))) {
            continue
        }
        if (
            closedAt > publishedAt ||
            (previousPublishedAt !== undefined && closedAt <= previousPublishedAt)
        ) {
            continue
        }

        selected.set(issue.number, issue)
    }

    return [...selected.values()].toSorted((left, right) => {
        const byClosedAt =
            (issueClosedTimestamp(left) ?? Number.MAX_SAFE_INTEGER) -
            (issueClosedTimestamp(right) ?? Number.MAX_SAFE_INTEGER)
        return byClosedAt === 0 ? left.number - right.number : byClosedAt
    })
}

function escapeMarkdownInline(value: string): string {
    const singleLine = value.replace(/\s+/g, ' ').trim() || 'Untitled issue'
    return singleLine.replace(/([\\`*_[\]<>|])/g, '\\$1')
}

function repositoryWebUrl(repository: string): string {
    validateRepository(repository)
    return `https://github.com/${repository
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`
}

function issueMarkdown(issue: GitHubIssue, repository: string): string {
    const url = `${repositoryWebUrl(repository)}/issues/${issue.number}`
    return `- **${escapeMarkdownInline(issue.title)}** [#${issue.number}](${url})`
}

function categorizedIssues(
    issues: readonly GitHubIssue[],
    config: ReleaseNotesConfig,
): Map<string, GitHubIssue[]> {
    const categories = new Map<string, GitHubIssue[]>(
        config.categories.map((category) => [category.title, []]),
    )
    const fallback = config.categories.find((category) => category.labels.length === 0)
    if (fallback === undefined) {
        throw new Error('Release notes config must contain a fallback category with no labels')
    }

    for (const issue of issues) {
        const labels = new Set(issueLabelNames(issue))
        const category =
            config.categories.find(
                (candidate) =>
                    candidate.labels.length > 0 &&
                    candidate.labels.some((label) => labels.has(label.trim().toLowerCase())),
            ) ?? fallback
        categories.get(category.title)?.push(issue)
    }

    return categories
}

function contributorLogins(issues: readonly GitHubIssue[]): string[] {
    const contributors = new Map<string, string>()
    for (const issue of issues) {
        const user = issue.user
        if (
            user === null ||
            user === undefined ||
            user.login.trim() === '' ||
            user.type?.toLowerCase() === 'bot' ||
            /\[bot\]$/i.test(user.login)
        ) {
            continue
        }
        const login = user.login.trim()
        contributors.set(login.toLowerCase(), login)
    }
    return [...contributors.values()].toSorted((left, right) =>
        left.localeCompare(right, 'en', { sensitivity: 'base' }),
    )
}

function fullChangelogMarkdown(
    repository: string,
    previousTag: string | undefined,
    tagName: string,
): string {
    const repositoryUrl = repositoryWebUrl(repository)
    if (previousTag === undefined) {
        const url = `${repositoryUrl}/commits/${encodeURIComponent(tagName)}`
        return `**Full Changelog:** [commits for ${escapeMarkdownInline(tagName)}](${url})`
    }

    const range = `${escapeMarkdownInline(previousTag)}...${escapeMarkdownInline(tagName)}`
    const url = `${repositoryUrl}/compare/${encodeURIComponent(
        previousTag,
    )}...${encodeURIComponent(tagName)}`
    return `**Full Changelog:** [${range}](${url})`
}

export function renderIssueChangelog(input: ReleaseNotesDocumentInput): string {
    const sections: string[] = []
    const highlightLabels = new Set(
        input.config.highlightLabels.map((label) => label.trim().toLowerCase()),
    )
    const highlights = input.issues
        .filter((issue) => issueLabelNames(issue).some((label) => highlightLabels.has(label)))
        .slice(0, 5)

    if (highlights.length > 0) {
        sections.push(
            [
                '## 🌟 Highlights',
                '',
                ...highlights.map((issue) => issueMarkdown(issue, input.repository)),
            ].join('\n'),
        )
    }

    if (input.initialRelease) {
        sections.push(
            [
                '## 📝 Initial Release',
                '',
                'No earlier published release exists for this channel, so this changelog uses all eligible closed issues up to the publication date.',
            ].join('\n'),
        )
    }

    if (input.issues.length === 0) {
        sections.push(
            ['## 🛠 Changes', '', 'No tracked issues were completed in this release window.'].join(
                '\n',
            ),
        )
    } else {
        for (const [title, issues] of categorizedIssues(input.issues, input.config)) {
            if (issues.length === 0) {
                continue
            }
            sections.push(
                [
                    `## ${title}`,
                    '',
                    ...issues.map((issue) => issueMarkdown(issue, input.repository)),
                ].join('\n'),
            )
        }
    }

    const contributors = contributorLogins(input.issues)
    if (contributors.length > 0) {
        sections.push(
            [
                '## 🙌 Contributors',
                '',
                ...contributors.map(
                    (login) =>
                        `- [@${escapeMarkdownInline(login)}](https://github.com/${encodeURIComponent(login)})`,
                ),
            ].join('\n'),
        )
    }

    sections.push(fullChangelogMarkdown(input.repository, input.previousTag, input.tagName))
    return `${sections.join('\n\n')}\n`
}

export function formatReleaseDate(value: string): string {
    const timestamp = parseTimestamp(value, 'published_at')
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(timestamp))
}

export function renderReleaseNotes(input: ReleaseNotesDocumentInput): RenderedReleaseNotes {
    validateReleaseTag(input.tagName, input.channel === 'dev')
    validateRepository(input.repository)
    const date = formatReleaseDate(input.publishedAt)
    const releaseType = input.channel === 'dev' ? 'Development Pre-Release' : 'Stable Release'
    const bannerAlt =
        input.channel === 'dev' ? 'RentnerProxy Development Release' : 'RentnerProxy Release'
    const icon = input.channel === 'dev' ? '🧪' : '🚀'
    const channelLabel = input.channel === 'dev' ? 'Development' : 'Latest'
    const channelTag = input.channel === 'dev' ? 'dev' : 'latest'
    const disclaimer =
        input.channel === 'dev'
            ? [
                  `> **${releaseType}** · Published **${date}**`,
                  '>',
                  '> Early testing build. Not intended as the stable channel.',
              ]
            : [
                  `> **${releaseType}** · Published **${date}**`,
                  '>',
                  '> Stable RentnerProxy release.',
              ]
    const issueChangelog = renderIssueChangelog(input)
    const bannerUrl = `${repositoryWebUrl(input.repository)}/releases/download/${encodeURIComponent(
        input.tagName,
    )}/${encodeURIComponent(input.bannerAssetName)}`
    const channelImage = `${input.image}:${channelTag}`
    const immutableImage = `${input.image}:${input.tagName}`
    const codeFence = String.fromCharCode(96).repeat(3)

    const body = [
        `![${bannerAlt}](${bannerUrl})`,
        '',
        `# ${icon} RentnerProxy \`${input.tagName}\``,
        '',
        ...disclaimer,
        '',
        '---',
        '',
        '## 📦 Docker',
        '',
        '| Channel | Image |',
        '| --- | --- |',
        `| ${channelLabel} | \`${channelImage}\` |`,
        `| Immutable | \`${immutableImage}\` |`,
        '',
        codeFence + 'bash',
        `docker pull ${channelImage}`,
        codeFence,
        '',
        issueChangelog.trimEnd(),
        '',
    ].join('\n')

    const changelog = [
        `# RentnerProxy ${input.tagName} Changelog`,
        '',
        `> **${releaseType}** · Published **${date}**`,
        '',
        issueChangelog.trimEnd(),
        '',
    ].join('\n')

    return { body, changelog }
}
