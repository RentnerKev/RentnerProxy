import { semver } from 'bun'
import { z } from 'zod'

const releasesSchema = z.array(
    z.object({
        tag_name: z.string().max(128),
        draft: z.boolean(),
        prerelease: z.boolean(),
    }),
)
const versionPattern =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
let cached: unknown = []
let expiresAt = 0
let pending: Promise<void> | undefined

export function findAvailableUpdate(currentVersion: string, releases: unknown): string | null {
    if (!versionPattern.test(currentVersion) || currentVersion.includes('-dev')) return null
    const parsed = releasesSchema.safeParse(releases)
    if (!parsed.success) return null
    const current = currentVersion.replace(/^v/, '')
    const allowsPrerelease = current.split('+')[0]!.includes('-')
    return (
        parsed.data
            .filter((release) => !release.draft && versionPattern.test(release.tag_name))
            .map((release) => ({
                prerelease: release.prerelease,
                version: release.tag_name.replace(/^v/, ''),
            }))
            .filter(
                (release) =>
                    (allowsPrerelease ||
                        (!release.prerelease && !release.version.split('+')[0]!.includes('-'))) &&
                    semver.order(release.version, current) > 0,
            )
            .toSorted((a, b) => semver.order(b.version, a.version))[0]?.version ?? null
    )
}

export async function getAvailableUpdate(currentVersion: string): Promise<string | null> {
    if (currentVersion.includes('-dev') || !versionPattern.test(currentVersion)) return null
    if (Date.now() >= expiresAt) {
        pending ??= (async () => {
            try {
                const response = await fetch(
                    'https://api.github.com/repos/RentnerKev/RentnerProxy/releases?per_page=100',
                    {
                        headers: {
                            Accept: 'application/vnd.github+json',
                            'User-Agent': 'RentnerProxy',
                        },
                        signal: AbortSignal.timeout(5000),
                    },
                )
                if (!response.ok) throw new Error('Release check failed')
                cached = releasesSchema.parse(await response.json())
                expiresAt = Date.now() + 60 * 60 * 1000
            } catch {
                expiresAt = Date.now() + 5 * 60 * 1000
            } finally {
                pending = undefined
            }
        })()
        await pending
    }
    return findAvailableUpdate(currentVersion, cached)
}
