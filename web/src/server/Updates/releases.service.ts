import { z } from 'zod'

import type {
    ApplicationUpdate,
    ApplicationUpdateResult,
} from '@/features/ApplicationVersion/Types/application-update.types.ts'
import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import { isReleaseMetadataCompatible } from '@/lib/ApplicationVersion/releaseMetadata.ts'
import { READINESS_ASSET, RELEASE_REPOSITORY } from '@/config/compatibility.config.ts'
import { getUpgradeCompatibility } from '@/lib/ApplicationVersion/upgradeCompatibility.ts'
import {
    compareReleaseVersions,
    isNewerEligibleRelease,
    parseReleaseVersion,
} from '@/lib/ApplicationVersion/releaseVersion.ts'
import type {
    CachedUpdate,
    PublishedUpdateRelease,
    UpdateCheckerDependencies,
} from './Types/releases.types.ts'
import { readBoundedText } from './http.ts'
import { verifyReleaseImage } from './image.service.ts'
import { parseReleaseReadiness, RELEASE_API } from './readiness.ts'

const releaseSummarySchema = z.object({
    tag_name: z.string().max(128),
    draft: z.boolean(),
    prerelease: z.boolean(),
})
const releasesSchema = z
    .array(
        releaseSummarySchema.extend({
            id: z.number().int().positive().safe(),
            published_at: z.iso.datetime().nullable(),
            body: z.string().max(200_000).nullable(),
            assets: z
                .array(
                    z.object({
                        id: z.number().int().positive().safe(),
                        name: z.string().max(256),
                        state: z.string().max(32),
                        size: z.number().int().nonnegative(),
                    }),
                )
                .max(100),
        }),
    )
    .max(100)
const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'RentnerProxy',
    'X-GitHub-Api-Version': '2022-11-28',
}
const successCacheMs = 60 * 60 * 1000
const retryCacheMs = 5 * 60 * 1000
const releasePageLimit = 5
const readinessRedirectHosts = new Set([
    'api.github.com',
    'github.com',
    'release-assets.githubusercontent.com',
    'objects.githubusercontent.com',
])

export function findAvailableUpdate(currentVersion: string, releases: unknown): string | null {
    const current = parseReleaseVersion(currentVersion)
    const parsed = z.array(releaseSummarySchema).safeParse(releases)
    if (!current || !parsed.success) return null
    let latest: string | null = null
    for (const release of parsed.data) {
        const target = parseReleaseVersion(release.tag_name)
        if (
            release.draft ||
            !target ||
            !isReleaseMetadataCompatible(target.channel, release.prerelease) ||
            !isNewerEligibleRelease(current, target)
        )
            continue
        if (latest === null || compareReleaseVersions(target.version, latest) > 0)
            latest = target.version
    }
    return latest
}

async function newestPublishedRelease(
    currentVersion: string,
    fetcher: typeof fetch,
    signal: AbortSignal,
): Promise<PublishedUpdateRelease | null> {
    let latest: PublishedUpdateRelease | null = null
    // Release lists are ordered by publication, not SemVer; inspect every bounded page.
    for (let page = 1; page <= releasePageLimit; page++) {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
        // oxlint-disable-next-line no-await-in-loop -- GitHub pagination is sequential and bounded.
        const response = await fetcher(`${RELEASE_API}?per_page=100&page=${page}`, {
            headers,
            cache: 'no-store',
            redirect: 'error',
            signal: requestSignal,
        })
        if (!response.ok) throw new Error('Release lookup unavailable')
        const raw: unknown = JSON.parse(
            // oxlint-disable-next-line no-await-in-loop -- Bound each page before parsing remote JSON.
            await readBoundedText(response, 4 * 1024 * 1024, requestSignal),
        )
        const releases = releasesSchema.parse(raw)
        const version = findAvailableUpdate(
            currentVersion,
            releases.filter((entry) => entry.published_at !== null),
        )
        const release = version
            ? releases.find(
                  (entry) =>
                      !entry.draft &&
                      entry.published_at !== null &&
                      parseReleaseVersion(entry.tag_name)?.version === version &&
                      isReleaseMetadataCompatible(
                          parseReleaseVersion(entry.tag_name)!.channel,
                          entry.prerelease,
                      ),
              )
            : undefined
        if (release && (latest === null || compareReleaseVersions(version!, latest.version) > 0)) {
            const readinessAssets = release.assets.filter((asset) => asset.name === READINESS_ASSET)
            const asset = readinessAssets.length === 1 ? readinessAssets[0] : undefined
            latest = {
                id: release.id,
                tag: release.tag_name,
                version: version!,
                channel: parseReleaseVersion(release.tag_name)!.channel,
                publishedAt: release.published_at!,
                notes: release.body?.slice(0, 60_000) || null,
                readinessAssetId:
                    asset?.state === 'uploaded' && asset.size > 0 && asset.size <= 32_768
                        ? asset.id
                        : null,
            }
        }
        if (releases.length < 100) return latest
    }
    // An incomplete list cannot establish the newest version or "up to date".
    throw new Error('Release pagination limit reached')
}

async function loadReadiness(
    release: PublishedUpdateRelease,
    fetcher: typeof fetch,
    signal: AbortSignal,
): Promise<{
    readonly readiness: ReleaseReadiness | null
    readonly status: 'pending' | 'invalid' | 'unavailable'
}> {
    if (release.readinessAssetId === null) return { readiness: null, status: 'pending' }
    let url = `${RELEASE_API}/assets/${release.readinessAssetId}`
    for (let redirects = 0; redirects <= 3; redirects++) {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)])
        // oxlint-disable-next-line no-await-in-loop -- Follow at most three validated asset redirects.
        const response = await fetcher(url, {
            headers: { ...headers, Accept: 'application/octet-stream' },
            cache: 'no-store',
            redirect: 'manual',
            signal: requestSignal,
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            if (!location) return { readiness: null, status: 'invalid' }
            const next = new URL(location, url)
            if (
                next.protocol !== 'https:' ||
                !readinessRedirectHosts.has(next.hostname) ||
                next.username ||
                next.password ||
                (next.port && next.port !== '443')
            )
                return { readiness: null, status: 'invalid' }
            void response.body?.cancel().catch(() => {})
            url = next.href
            continue
        }
        if (response.status === 404) return { readiness: null, status: 'pending' }
        if (!response.ok) return { readiness: null, status: 'unavailable' }
        // oxlint-disable-next-line no-await-in-loop -- The final asset body is small and bounded.
        const text = await readBoundedText(response, 32_768, requestSignal)
        let raw: unknown
        try {
            raw = JSON.parse(text)
        } catch {
            return { readiness: null, status: 'invalid' }
        }
        const readiness = parseReleaseReadiness(raw, release)
        return { readiness, status: readiness ? 'pending' : 'invalid' }
    }
    return { readiness: null, status: 'invalid' }
}

function runtimePlatform(): string {
    const architecture = process.arch === 'x64' ? 'amd64' : process.arch
    return `${process.platform}/${architecture}`
}

export function createUpdateChecker({
    fetcher = fetch,
    now = Date.now,
    platform = runtimePlatform(),
}: UpdateCheckerDependencies = {}): (currentVersion: string) => Promise<ApplicationUpdateResult> {
    let cached: CachedUpdate | undefined
    let pending:
        { readonly version: string; readonly promise: Promise<ApplicationUpdateResult> } | undefined

    async function check(currentVersion: string): Promise<ApplicationUpdateResult> {
        const current = parseReleaseVersion(currentVersion)!
        const signal = AbortSignal.timeout(20_000)
        const resultBase = {
            currentChannel: current.channel,
            checkedAt: new Date(now()).toISOString(),
        }
        try {
            const release = await newestPublishedRelease(currentVersion, fetcher, signal)
            if (!release) return { ...resultBase, status: 'current', latest: null }
            let readiness: ReleaseReadiness | null = null
            let image: ApplicationUpdate['image'] = {
                status: 'unavailable',
                reference: null,
                digest: null,
                platform,
            }
            try {
                const loaded = await loadReadiness(release, fetcher, signal)
                readiness = loaded.readiness
                image = readiness
                    ? await verifyReleaseImage(readiness, platform, fetcher, signal)
                    : { ...image, status: loaded.status }
            } catch {
                // Retain the known published release, but never retain a stale verification.
            }
            return {
                ...resultBase,
                status: 'available',
                latest: {
                    version: release.version,
                    tag: release.tag,
                    channel: release.channel,
                    url: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${encodeURIComponent(release.tag)}`,
                    notes: release.notes,
                    image,
                    compatibility: getUpgradeCompatibility(
                        currentVersion,
                        release.version,
                        readiness,
                    ),
                },
            }
        } catch {
            return { ...resultBase, status: 'unavailable', latest: null }
        }
    }

    return async (currentVersion) => {
        const current = parseReleaseVersion(currentVersion)
        if (!current)
            return { status: 'disabled', checkedAt: null, currentChannel: null, latest: null }
        if (cached?.version === currentVersion && now() < cached.expiresAt) return cached.result
        if (pending?.version === currentVersion) return pending.promise
        const promise = check(currentVersion).then((result) => {
            const complete =
                result.status === 'current' || result.latest?.image.status === 'verified'
            cached = {
                version: currentVersion,
                result,
                expiresAt: now() + (complete ? successCacheMs : retryCacheMs),
            }
            return result
        })
        pending = { version: currentVersion, promise }
        try {
            return await promise
        } finally {
            if (pending?.promise === promise) pending = undefined
        }
    }
}

export const getAvailableUpdateService = createUpdateChecker()
