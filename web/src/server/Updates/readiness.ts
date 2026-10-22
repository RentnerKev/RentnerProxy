import { z } from 'zod'

import type { ApplicationUpdate } from '@/features/ApplicationVersion/Types/application-update.types.ts'
import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import type { PublishedUpdateRelease } from './Types/releases.types.ts'
import { compareReleaseVersions, parseReleaseVersion } from './version.ts'

export const RELEASE_REPOSITORY = 'RentnerKev/RentnerProxy'
export const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases`
export const READINESS_ASSET = 'rentnerproxy-update.json'
const MINIMUM_UPGRADE_SOURCE = 'v1.0.0-beta.1'

const readinessSchema = z.object({
    schemaVersion: z.literal(1),
    releaseId: z.number().int().positive().safe(),
    tag: z.string().max(128),
    channel: z.enum(['alpha', 'beta', 'stable']),
    publishedAt: z.iso.datetime(),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    image: z.object({
        repository: z.literal('ghcr.io/rentnerkev/rentnerproxy'),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        platforms: z
            .array(z.string().regex(/^linux\/(?:amd64|arm64)(?:\/v[0-9]+)?$/))
            .min(1)
            .max(8),
    }),
    upgrade: z.discriminatedUnion('policy', [
        z.object({
            policy: z.literal('beta1-appliance-v1'),
            minimumVersion: z.literal(MINIMUM_UPGRADE_SOURCE),
        }),
        z.object({ policy: z.literal('manual-review'), minimumVersion: z.null() }),
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
        data.upgrade.policy === 'beta1-appliance-v1' &&
        (target.major !== '1' ||
            target.channel === 'alpha' ||
            compareReleaseVersions(target.version, '1.0.0-beta.2') < 0)
    )
        return null
    return data
}

export function getUpgradeCompatibility(
    currentVersion: string,
    targetVersion: string,
    readiness: ReleaseReadiness | null,
): ApplicationUpdate['compatibility'] {
    const source = parseReleaseVersion(currentVersion)
    const target = parseReleaseVersion(targetVersion)
    if (
        source?.channel === 'alpha' &&
        target &&
        target.major === '1' &&
        target.channel !== 'alpha' &&
        compareReleaseVersions(source.version, MINIMUM_UPGRADE_SOURCE) < 0 &&
        (readiness === null || readiness.upgrade.policy === 'beta1-appliance-v1') &&
        compareReleaseVersions(target.version, '1.0.0-beta.2') >= 0
    ) {
        return {
            status: 'requires-beta1',
            minimumVersion: MINIMUM_UPGRADE_SOURCE,
            intermediateVersion: MINIMUM_UPGRADE_SOURCE,
        }
    }
    if (
        source &&
        target &&
        readiness?.upgrade.policy === 'beta1-appliance-v1' &&
        source.major === '1' &&
        target.major === '1' &&
        source.channel !== 'alpha' &&
        compareReleaseVersions(source.version, MINIMUM_UPGRADE_SOURCE) >= 0 &&
        compareReleaseVersions(target.version, source.version) > 0
    ) {
        return {
            status: 'supported',
            minimumVersion: MINIMUM_UPGRADE_SOURCE,
            intermediateVersion: null,
        }
    }
    return { status: 'unsupported', minimumVersion: null, intermediateVersion: null }
}
