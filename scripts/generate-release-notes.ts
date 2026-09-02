import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
    filterIssues,
    findMatchingMilestone,
    findPreviousRelease,
    renderReleaseNotes,
    validateReleaseTag,
    validateRepository,
} from './release-notes'
import type {
    CurrentRelease,
    GitHubIssue,
    GitHubMilestone,
    GitHubRelease,
    ReleaseCategory,
    ReleaseChannel,
    ReleaseNotesConfig,
    RenderedReleaseNotes,
} from './release-notes'

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface GeneratedReleaseNotes extends RenderedReleaseNotes {
    issues: readonly GitHubIssue[]
    previousTag?: string
    milestoneNumber?: number
    selectionMode: 'milestone' | 'release-window'
}

export interface GenerateReleaseNotesInput {
    repository: string
    release: CurrentRelease
    channel: ReleaseChannel
    image: string
    bannerAssetName: string
    config: ReleaseNotesConfig
}

function repositoryApiPath(repository: string): string {
    validateRepository(repository)
    return repository
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
}

function hasNextPage(linkHeader: string | null): boolean {
    return linkHeader?.split(',').some((link) => /;\s*rel="next"\s*$/.test(link.trim())) ?? false
}

export class GitHubReleaseClient {
    readonly #repositoryPath: string
    readonly #token: string
    readonly #fetch: FetchImplementation

    constructor(
        repository: string,
        token: string,
        fetchImplementation: FetchImplementation = fetch,
    ) {
        if (token.trim() === '') {
            throw new Error('GITHUB_TOKEN is required')
        }
        this.#repositoryPath = repositoryApiPath(repository)
        this.#token = token
        this.#fetch = fetchImplementation
    }

    async #paginate<T>(
        endpoint: string,
        parameters: Readonly<Record<string, string>>,
    ): Promise<T[]> {
        const results: T[] = []
        let page = 1

        while (true) {
            const url = new URL(`https://api.github.com/repos/${this.#repositoryPath}/${endpoint}`)
            for (const [name, value] of Object.entries(parameters)) {
                url.searchParams.set(name, value)
            }
            url.searchParams.set('per_page', '100')
            url.searchParams.set('page', String(page))

            let response: Response
            try {
                // Pagination is serial because each response owns the next-page link.
                // eslint-disable-next-line no-await-in-loop
                response = await this.#fetch(url, {
                    headers: {
                        Accept: 'application/vnd.github+json',
                        Authorization: `Bearer ${this.#token}`,
                        'User-Agent': 'RentnerProxy-release-notes',
                        'X-GitHub-Api-Version': '2022-11-28',
                    },
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'unknown network error'
                throw new Error(`GitHub API unavailable while requesting ${endpoint}: ${message}`, {
                    cause: error,
                })
            }

            if (!response.ok) {
                const requestId = response.headers.get('x-github-request-id')
                const requestSuffix = requestId === null ? '' : ` (request ${requestId})`
                throw new Error(
                    `GitHub API request for ${endpoint} failed with HTTP ${response.status}${requestSuffix}`,
                )
            }

            // Keep parsing in the same sequential pagination transaction as its request.
            // eslint-disable-next-line no-await-in-loop
            const payload: unknown = await response.json()
            if (!Array.isArray(payload)) {
                throw new Error(`GitHub API returned invalid pagination data for ${endpoint}`)
            }
            results.push(...(payload as T[]))

            if (!hasNextPage(response.headers.get('link'))) {
                return results
            }
            page += 1
        }
    }

    listReleases(): Promise<GitHubRelease[]> {
        return this.#paginate<GitHubRelease>('releases', {})
    }

    listMilestones(): Promise<GitHubMilestone[]> {
        return this.#paginate<GitHubMilestone>('milestones', {
            direction: 'desc',
            sort: 'completeness',
            state: 'all',
        })
    }

    listClosedIssues(options: {
        milestoneNumber?: number
        since?: string
    }): Promise<GitHubIssue[]> {
        const parameters: Record<string, string> = {
            direction: 'asc',
            sort: 'updated',
            state: 'closed',
        }
        if (options.milestoneNumber !== undefined) {
            parameters.milestone = String(options.milestoneNumber)
        }
        if (options.since !== undefined) {
            parameters.since = options.since
        }
        return this.#paginate<GitHubIssue>('issues', parameters)
    }
}

export async function generateReleaseNotes(
    input: GenerateReleaseNotesInput,
    client: GitHubReleaseClient,
): Promise<GeneratedReleaseNotes> {
    validateReleaseTag(input.release.tagName, input.release.prerelease)
    validateRepository(input.repository)
    if ((input.channel === 'dev') !== input.release.prerelease) {
        throw new Error('Release channel and GitHub prerelease state do not match')
    }

    const expectedImage = `ghcr.io/${input.repository.toLowerCase()}`
    if (input.image !== expectedImage) {
        throw new Error(`Release image must be ${expectedImage}`)
    }

    const [releases, milestones] = await Promise.all([
        client.listReleases(),
        client.listMilestones(),
    ])
    const previousRelease = findPreviousRelease(releases, input.release)
    const previousPublishedAt = previousRelease?.published_at ?? undefined
    const milestone = findMatchingMilestone(milestones, input.release.tagName)
    const rawIssues =
        milestone === undefined
            ? await client.listClosedIssues(
                  previousPublishedAt === undefined ? {} : { since: previousPublishedAt },
              )
            : await client.listClosedIssues({ milestoneNumber: milestone.number })
    const issues = filterIssues(
        rawIssues,
        input.config,
        milestone === undefined
            ? previousPublishedAt === undefined
                ? { publishedAt: input.release.publishedAt }
                : { publishedAt: input.release.publishedAt, previousPublishedAt }
            : { publishedAt: input.release.publishedAt },
    )
    const previousTag = previousRelease?.tag_name
    const rendered = renderReleaseNotes({
        repository: input.repository,
        tagName: input.release.tagName,
        channel: input.channel,
        publishedAt: input.release.publishedAt,
        image: input.image,
        bannerAssetName: input.bannerAssetName,
        issues,
        config: input.config,
        ...(previousTag === undefined ? {} : { previousTag }),
        initialRelease: previousRelease === undefined,
    })

    return {
        ...rendered,
        issues,
        ...(previousTag === undefined ? {} : { previousTag }),
        ...(milestone === undefined ? {} : { milestoneNumber: milestone.number }),
        selectionMode: milestone === undefined ? 'release-window' : 'milestone',
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
        throw new Error(`${field} must be an array of strings`)
    }
    return value
}

export function parseReleaseNotesConfig(value: unknown): ReleaseNotesConfig {
    if (!isRecord(value) || !Array.isArray(value.categories)) {
        throw new Error('Release notes config must define categories')
    }

    const categories: ReleaseCategory[] = value.categories.map((category, index) => {
        if (
            !isRecord(category) ||
            typeof category.title !== 'string' ||
            category.title.trim() === ''
        ) {
            throw new Error(`categories[${index}].title must be a non-empty string`)
        }
        return {
            title: category.title,
            labels: stringArray(category.labels, `categories[${index}].labels`),
        }
    })
    if (categories.length === 0 || !categories.some((category) => category.labels.length === 0)) {
        throw new Error('Release notes config requires a fallback category with no labels')
    }

    return {
        excludedLabels: stringArray(value.excludedLabels, 'excludedLabels'),
        highlightLabels: stringArray(value.highlightLabels, 'highlightLabels'),
        categories,
    }
}

function requiredEnvironment(name: string): string {
    const value = process.env[name]
    if (value === undefined || value.trim() === '') {
        throw new Error(`${name} is required`)
    }
    return value
}

function parseBooleanEnvironment(name: string): boolean {
    const value = requiredEnvironment(name)
    if (value !== 'true' && value !== 'false') {
        throw new Error(`${name} must be true or false`)
    }
    return value === 'true'
}

function parseChannel(value: string): ReleaseChannel {
    if (value !== 'dev' && value !== 'stable') {
        throw new Error('RELEASE_CHANNEL must be dev or stable')
    }
    return value
}

function optionValue(name: string, fallback: string): string {
    const index = process.argv.indexOf(name)
    if (index === -1) {
        return fallback
    }
    const value = process.argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${name} requires a value`)
    }
    return value
}

async function main(): Promise<void> {
    const repository = requiredEnvironment('GITHUB_REPOSITORY')
    const token = requiredEnvironment('GITHUB_TOKEN')
    const tagName = requiredEnvironment('RELEASE_TAG')
    const publishedAt = requiredEnvironment('RELEASE_PUBLISHED_AT')
    const prerelease = parseBooleanEnvironment('RELEASE_PRERELEASE')
    const channel = parseChannel(requiredEnvironment('RELEASE_CHANNEL'))
    const image = requiredEnvironment('RELEASE_IMAGE')
    const releaseId = Number(requiredEnvironment('RELEASE_ID'))
    if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
        throw new Error('RELEASE_ID must be a positive integer')
    }

    const configPath = resolve(optionValue('--config', '.github/release-notes.json'))
    const outputDirectory = resolve(optionValue('--output-dir', '.release'))
    const config = parseReleaseNotesConfig(JSON.parse(await readFile(configPath, 'utf8')))
    const client = new GitHubReleaseClient(repository, token)
    const result = await generateReleaseNotes(
        {
            repository,
            release: { id: releaseId, tagName, prerelease, publishedAt },
            channel,
            image,
            bannerAssetName: 'release-banner.png',
            config,
        },
        client,
    )

    await mkdir(outputDirectory, { recursive: true })
    const changelogFilename = `RentnerProxy-${tagName}-CHANGELOG.md`
    await Promise.all([
        writeFile(resolve(outputDirectory, 'release-body.md'), result.body, 'utf8'),
        writeFile(resolve(outputDirectory, changelogFilename), result.changelog, 'utf8'),
    ])

    process.stdout.write(
        [
            `Generated release notes from ${result.issues.length} eligible issue(s).`,
            `Selection: ${result.selectionMode}${
                result.milestoneNumber === undefined ? '' : ` #${result.milestoneNumber}`
            }.`,
            `Previous release: ${result.previousTag ?? 'none (initial release)'}.`,
            '',
        ].join('\n'),
    )
}

if (import.meta.main) {
    try {
        await main()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        process.stderr.write(`Release notes generation failed: ${message}\n`)
        process.exitCode = 1
    }
}
