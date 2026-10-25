// oxlint-disable no-await-in-loop -- Bounded release pages, redirects and source identity checks are sequential and fail closed.
import { z } from 'zod'
import {
    CURRENT_COMPATIBILITY_PROFILE,
    READINESS_ASSET,
    RELEASE_IMAGE,
    RELEASE_REPOSITORY,
} from '../../web/src/config/compatibility.config.ts'
import {
    compareReleaseVersions,
    parseReleaseVersion,
} from '../../web/src/lib/ApplicationVersion/releaseVersion.ts'
import {
    isSupportedUpgradeSource,
    isSupportedUpgradeTarget,
} from '../../web/src/lib/ApplicationVersion/upgradeCompatibility.ts'
import { isReleaseMetadataCompatible } from '../../web/src/lib/ApplicationVersion/releaseMetadata.ts'
import { parseReleaseReadiness } from '../../web/src/server/Updates/readiness.ts'
import { readBoundedText } from '../../web/src/server/Updates/http.ts'
import { publishedRelease } from './published-releases.ts'
import type { CompatibilitySource, PublishedRelease } from './Types/published-releases.types.ts'

const api = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`
const releaseSchema = z.object({
    id: z.number().int().positive().safe(),
    tag_name: z.string().max(128),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.iso.datetime().nullable(),
    assets: z
        .array(
            z.object({
                id: z.number().int().positive().safe(),
                name: z.string().max(256),
                state: z.string().max(32),
                size: z.number().int().nonnegative().safe(),
            }),
        )
        .max(100),
})
type Release = z.infer<typeof releaseSchema>
const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'RentnerProxy-Compatibility',
    'X-GitHub-Api-Version': '2022-11-28',
}
const redirectHosts = new Set([
    'api.github.com',
    'github.com',
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
])

export interface SourceDiscoveryOptions {
    readonly token?: string | undefined
    readonly signal?: AbortSignal
}
export type SourceFetcher = (url: string, options: RequestInit) => Promise<Response>

function apiHeaders(token?: string): Record<string, string> {
    return { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

function uniqueReleases(releases: Release[]): Release[] {
    const ids = new Set<number>()
    const tags = new Set<string>()
    for (const release of releases) {
        const tag = parseReleaseVersion(release.tag_name)?.version ?? release.tag_name
        if (ids.has(release.id) || tags.has(tag))
            throw new Error('Ambiguous published source version or release identity')
        ids.add(release.id)
        tags.add(tag)
    }
    return releases
}

export async function discoverPublishedReleases(
    fetcher: SourceFetcher = fetch,
    options: SourceDiscoveryOptions = {},
): Promise<Release[]> {
    const releases: Release[] = []
    const deadline = options.signal ?? AbortSignal.timeout(120_000)
    for (let page = 1; page <= 10; page++) {
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(10_000)])
        signal.throwIfAborted()
        const response = await fetcher(`${api}?per_page=100&page=${page}`, {
            headers: apiHeaders(options.token),
            redirect: 'error',
            cache: 'no-store',
            signal,
        })
        if (!response.ok) throw new Error('Published release discovery unavailable')
        const entries = z
            .array(releaseSchema)
            .max(100)
            .parse(JSON.parse(await readBoundedText(response, 4 * 1024 * 1024, signal)))
        releases.push(...entries)
        if (entries.length < 100) return uniqueReleases(releases)
    }
    throw new Error('Published release pagination incomplete')
}

export async function loadPublishedSource(
    release: Release,
    fetcher: SourceFetcher = fetch,
    options: SourceDiscoveryOptions = {},
): Promise<PublishedRelease> {
    const assets = release.assets.filter((asset) => asset.name === READINESS_ASSET)
    const asset = assets[0]
    if (
        assets.length !== 1 ||
        !asset ||
        asset.state !== 'uploaded' ||
        asset.size < 1 ||
        asset.size > 32_768
    )
        throw new Error(`Required source readiness asset missing or invalid: ${release.tag_name}`)
    let url = `${api}/assets/${asset.id}`
    const deadline = options.signal ?? AbortSignal.timeout(40_000)
    for (let redirects = 0; redirects <= 3; redirects++) {
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(10_000)])
        signal.throwIfAborted()
        const response = await fetcher(url, {
            headers: {
                ...apiHeaders(redirects === 0 ? options.token : undefined),
                Accept: 'application/octet-stream',
            },
            redirect: 'manual',
            cache: 'no-store',
            signal,
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            if (!location) throw new Error('Source readiness redirect missing')
            const next = new URL(location, url)
            if (
                next.protocol !== 'https:' ||
                !redirectHosts.has(next.hostname) ||
                next.username ||
                next.password ||
                (next.port && next.port !== '443')
            )
                throw new Error('Unsafe source readiness redirect')
            void response.body?.cancel().catch(() => {})
            url = next.href
            continue
        }
        if (!response.ok)
            throw new Error(`Required source readiness unavailable: ${release.tag_name}`)
        const version = parseReleaseVersion(release.tag_name)!
        const raw: unknown = JSON.parse(await readBoundedText(response, 32_768, signal))
        const readiness = parseReleaseReadiness(raw, {
            id: release.id,
            tag: release.tag_name,
            version: version.version,
            channel: version.channel,
            publishedAt: release.published_at!,
            notes: null,
            readinessAssetId: asset.id,
        })
        if (
            !readiness ||
            readiness.upgrade.policy === 'manual-review' ||
            !readiness.image.platforms.includes('linux/amd64')
        )
            throw new Error(
                `Invalid source readiness identity or compatibility: ${release.tag_name}`,
            )
        return {
            version: release.tag_name,
            revision: readiness.revision,
            digest: readiness.image.digest,
            image: `${RELEASE_IMAGE}:${release.tag_name}@${readiness.image.digest}`,
        }
    }
    throw new Error('Source readiness redirect limit reached')
}

interface SelectionOptions {
    readonly releases: unknown
    readonly targetVersion: string
    readonly sourceRevision: (tag: string) => Promise<{
        readonly revision: string
        readonly ancestor: boolean
        readonly isTarget?: boolean
    }>
    readonly loadSource?: (release: Release) => Promise<PublishedRelease>
    readonly signal?: AbortSignal
}

function sourceCandidates(raw: unknown, targetVersion: string): Release[] {
    const releases = uniqueReleases(z.array(releaseSchema).max(1000).parse(raw))
    const target = targetVersion === '0.0.0' ? null : parseReleaseVersion(targetVersion)
    if (targetVersion !== '0.0.0' && (!target || !isSupportedUpgradeTarget(targetVersion)))
        throw new Error('Unsupported compatibility target version')
    return releases
        .filter((release) => {
            const version = parseReleaseVersion(release.tag_name)
            return (
                !release.draft &&
                release.published_at !== null &&
                version &&
                isSupportedUpgradeSource(release.tag_name) &&
                isReleaseMetadataCompatible(version.channel, release.prerelease) &&
                (!target ||
                    (compareReleaseVersions(version.version, target.version) < 0 &&
                        !(target.channel === 'beta' && version.channel === 'stable')))
            )
        })
        .toSorted((a, b) => compareReleaseVersions(a.tag_name, b.tag_name))
}

export async function verifyCompatibilitySource(
    source: PublishedRelease,
    options: SelectionOptions,
): Promise<void> {
    options.signal?.throwIfAborted()
    const release = sourceCandidates(options.releases, options.targetVersion).find(
        (entry) => entry.tag_name === source.version,
    )
    if (!release)
        throw new Error('Bound source is no longer an eligible official published release')
    const bootstrap = publishedRelease('beta.1')
    const immutable =
        source.version === bootstrap.version
            ? bootstrap
            : await (options.loadSource ?? loadPublishedSource)(release)
    const identity = await options.sourceRevision(release.tag_name)
    if (
        !identity.ancestor ||
        identity.revision !== immutable.revision ||
        immutable.version !== source.version ||
        immutable.revision !== source.revision ||
        immutable.digest !== source.digest ||
        immutable.image !== source.image
    )
        throw new Error('Published source tag and immutable identity disagree')
}

export async function selectCompatibilitySources(
    options: SelectionOptions,
): Promise<CompatibilitySource[]> {
    const candidates = sourceCandidates(options.releases, options.targetVersion)
    const eligible: { release: Release; revision: string }[] = []
    const versions = new Set<string>()
    for (const release of candidates) {
        options.signal?.throwIfAborted()
        const version = parseReleaseVersion(release.tag_name)!.version
        if (versions.has(version)) throw new Error('Ambiguous published source version')
        versions.add(version)
        const identity = await options.sourceRevision(release.tag_name)
        if (!/^[a-f0-9]{40}$/u.test(identity.revision))
            throw new Error('Invalid published source revision')
        // A new target may not have readiness until this gate succeeds. Existing evidence
        // must still agree, so reassigning a published source tag cannot erase a baseline.
        if (identity.isTarget) {
            const bootstrap = publishedRelease('beta.1')
            if (
                release.tag_name === bootstrap.version ||
                release.assets.some((asset) => asset.name === READINESS_ASSET)
            ) {
                const immutable =
                    release.tag_name === bootstrap.version
                        ? bootstrap
                        : await (options.loadSource ?? loadPublishedSource)(release)
                if (
                    immutable.version !== release.tag_name ||
                    immutable.revision !== identity.revision
                )
                    throw new Error('Published source tag and immutable revision disagree')
            }
            continue
        }
        if (!identity.ancestor) {
            const bootstrap = publishedRelease('beta.1')
            const immutable =
                release.tag_name === bootstrap.version
                    ? bootstrap
                    : await (options.loadSource ?? loadPublishedSource)(release)
            if (immutable.version !== release.tag_name || immutable.revision !== identity.revision)
                throw new Error('Published source tag and immutable revision disagree')
        }
        if (identity.ancestor) eligible.push({ release, revision: identity.revision })
    }
    const minimum = CURRENT_COMPATIBILITY_PROFILE.minimumSourceVersion
    const oldest = eligible.find(
        ({ release }) => compareReleaseVersions(release.tag_name, minimum) === 0,
    )
    const previous = eligible.at(-1)
    if (!oldest || !previous)
        throw new Error('Required supported published source unavailable in target history')
    const selected: CompatibilitySource[] = [{ role: 'fresh', release: null }]
    for (const [role, candidate] of [
        ['oldest', oldest],
        ['previous', previous],
    ] as const) {
        if (role === 'previous' && candidate === oldest) continue
        const bootstrap = publishedRelease('beta.1')
        // Beta 1 predates readiness metadata; its immutable pin is the only bootstrap exception.
        const release =
            compareReleaseVersions(candidate.release.tag_name, bootstrap.version) === 0
                ? bootstrap
                : await (options.loadSource ?? loadPublishedSource)(candidate.release)
        if (
            release.version !== candidate.release.tag_name ||
            release.revision !== candidate.revision
        )
            throw new Error('Published source tag and immutable revision disagree')
        selected.push({ role, release })
    }
    return selected
}

export function requestedCompatibilitySources(
    sources: readonly CompatibilitySource[],
    event: string,
    requested: string,
): CompatibilitySource[] {
    if (
        event === 'push' ||
        event === 'pull_request' ||
        (event === 'workflow_dispatch' && requested === 'all')
    )
        return [...sources]
    if (event !== 'workflow_dispatch' || !['fresh', 'oldest', 'previous'].includes(requested))
        throw new Error('Unsupported compatibility source request')
    const source =
        sources.find((entry) => entry.role === requested) ??
        (requested === 'previous' ? sources.find((entry) => entry.role === 'oldest') : undefined)
    if (!source) throw new Error('Requested compatibility source unavailable')
    return [{ ...source, role: requested as CompatibilitySource['role'] }]
}

export function parseCompatibilitySource(raw: string): CompatibilitySource {
    const release = z
        .object({
            version: z.string().max(128),
            revision: z.string().regex(/^[a-f0-9]{40}$/),
            digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
            image: z.string().max(512),
        })
        .strict()
    const source = z
        .object({ role: z.enum(['fresh', 'oldest', 'previous']), release: release.nullable() })
        .strict()
        .parse(JSON.parse(raw))
    if ((source.role === 'fresh') !== (source.release === null))
        throw new Error('Invalid source role binding')
    if (
        source.release &&
        (source.release.version !== `v${parseReleaseVersion(source.release.version)?.version}` ||
            !isSupportedUpgradeSource(source.release.version) ||
            source.release.image !==
                `${RELEASE_IMAGE}:${source.release.version}@${source.release.digest}`)
    )
        throw new Error('Invalid immutable compatibility source')
    return source
}
