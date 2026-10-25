import { z } from 'zod'

import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import { RELEASE_IMAGE, RELEASE_REPOSITORY } from '../../config/compatibility.config.ts'
import { LEGACY_UPGRADE_CONTRACT } from '../../lib/ApplicationVersion/legacyUpgradeContract.ts'
import { parseReleaseVersion } from '../../lib/ApplicationVersion/releaseVersion.ts'
import { isSupportedUpgradeTarget } from '../../lib/ApplicationVersion/upgradeCompatibility.ts'
import type { PublishedUpdateRelease } from './Types/releases.types.ts'

export const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`

const readinessSchema = z.strictObject({
    schemaVersion: z.literal(LEGACY_UPGRADE_CONTRACT.schemaVersion),
    releaseId: z.number().int().positive().safe(),
    tag: z.string().max(128),
    channel: z.enum(['alpha', 'beta', 'stable']),
    publishedAt: z.iso.datetime(),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    image: z.strictObject({
        repository: z.literal(RELEASE_IMAGE),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        platforms: z
            .array(z.string().regex(/^linux\/(?:amd64|arm64)(?:\/v[0-9]+)?$/))
            .min(1)
            .max(8),
    }),
    upgrade: z.discriminatedUnion('policy', [
        z.strictObject({
            policy: z.literal(LEGACY_UPGRADE_CONTRACT.policy),
            minimumVersion: z.literal(LEGACY_UPGRADE_CONTRACT.profile.minimumSourceVersion),
        }),
        z.strictObject({ policy: z.literal('manual-review'), minimumVersion: z.null() }),
    ]),
})

export function parseReleaseReadiness(
    raw: unknown,
    release: PublishedUpdateRelease,
): ReleaseReadiness | null {
    const parsed = readinessSchema.safeParse(raw)
    if (!parsed.success) return null
    const data = parsed.data
    if (
        data.releaseId !== release.id ||
        data.tag !== release.tag ||
        data.channel !== release.channel ||
        data.publishedAt !== release.publishedAt
    )
        return null
    const target = parseReleaseVersion(data.tag)
    if (!target || target.channel !== data.channel) return null
    if (
        data.upgrade.policy === LEGACY_UPGRADE_CONTRACT.policy &&
        !isSupportedUpgradeTarget(target.version)
    )
        return null
    return data
}
